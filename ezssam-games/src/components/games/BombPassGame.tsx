"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Game } from "@/lib/games";
import { saveGameResult } from "@/lib/records";
import {
  playCorrect,
  playWrong,
  playCombo,
  playTick,
  playBoom,
  setMuted as setSoundMuted,
} from "@/lib/sound";
import ResultScreen from "@/components/ResultScreen";
import { generateBombProblem, type BombProblem } from "@/lib/bomb";

const CW = 960;
const CH = 540;
// 한 게임 = 폭탄 한 번. 20초 ~ 2분 30초(150초) 사이 랜덤으로 터짐.
const BOMB_MIN_SEC = 20;
const BOMB_MAX_SEC = 150;

function randomBombTime(): number {
  return BOMB_MIN_SEC + Math.random() * (BOMB_MAX_SEC - BOMB_MIN_SEC);
}

type Phase = "intro" | "playing" | "result";
type Mode = "solo" | "multi";

type ChoiceRect = {
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

const CHOICE_W = 200;
const CHOICE_H = 140;
const CHOICE_PAD = 28;

function makeChoiceRects(values: number[]): ChoiceRect[] {
  const topY = 150;
  const botY = CH - CHOICE_H - CHOICE_PAD;
  return [
    { value: values[0], x: CHOICE_PAD, y: topY, w: CHOICE_W, h: CHOICE_H },
    {
      value: values[1],
      x: CW - CHOICE_W - CHOICE_PAD,
      y: topY,
      w: CHOICE_W,
      h: CHOICE_H,
    },
    { value: values[2], x: CHOICE_PAD, y: botY, w: CHOICE_W, h: CHOICE_H },
    {
      value: values[3],
      x: CW - CHOICE_W - CHOICE_PAD,
      y: botY,
      w: CHOICE_W,
      h: CHOICE_H,
    },
  ];
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

type PlayerStats = { name: string; passed: number };

export default function BombPassGame({ game }: { game: Game }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);

  // 게임 설정
  const modeRef = useRef<Mode>("solo");
  const playersRef = useRef<PlayerStats[]>([
    { name: "나", passed: 0 },
  ]);
  const currentIdxRef = useRef(0);

  // 게임 상태
  const gameStartRef = useRef(0);
  const problemRef = useRef<BombProblem>(generateBombProblem());
  const choicesRef = useRef<ChoiceRect[]>(
    makeChoiceRects(problemRef.current.choices)
  );
  const bombStartRef = useRef(0);
  const bombDurationRef = useRef(randomBombTime()); // 이번 라운드 폭발 시간 (숨김)
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);

  // 마우스
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const hoverIdxRef = useRef<number>(-1);

  const flashRef = useRef<{
    kind: "boom" | "correct" | "wrong" | "turn";
    until: number;
  } | null>(null);
  const lastTickSoundRef = useRef(0);
  const gameOverPendingRef = useRef<number | null>(null); // 폭발 후 결과 화면까지 잠깐 BOOM 보여주기 위해

  // UI 입력
  const [mode, setMode] = useState<Mode>("solo");
  const [numPlayers, setNumPlayers] = useState(2);
  const [playerNames, setPlayerNames] = useState<string[]>([
    "1번",
    "2번",
    "3번",
    "4번",
  ]);

  const [phase, setPhase] = useState<Phase>("intro");
  const [muted, setMuted] = useState(false);
  const [view, setView] = useState({
    score: 0,
    combo: 0,
    currentName: "나",
    players: playersRef.current,
  });
  const [result, setResult] = useState<
    | {
        kind: "solo";
        score: number;
        isNewRecord: boolean;
        passed: number;
        maxCombo: number;
        elapsedSec: number;
      }
    | {
        kind: "multi";
        score: number;
        isNewRecord: boolean;
        loserName: string;
        ranked: PlayerStats[];
        elapsedSec: number;
      }
    | null
  >(null);
  const viewKeyRef = useRef("");

  // ── 다음 플레이어 ──────────────────────────────────
  const advanceToNext = useCallback(() => {
    if (modeRef.current === "solo") return;
    const n = playersRef.current.length;
    currentIdxRef.current = (currentIdxRef.current + 1) % n;
  }, []);

  // ── 새 문제 ────────────────────────────────────────
  // 새 문제만 — 폭탄 타이머는 안 건드림 (러시안 룰렛: 폭탄은 계속 째깍)
  const nextProblem = useCallback(() => {
    problemRef.current = generateBombProblem();
    choicesRef.current = makeChoiceRects(problemRef.current.choices);
    hoverIdxRef.current = -1;
  }, []);

  // 폭탄 새로 장전 — 폭발 직후 또는 게임 시작 시에만
  const resetBomb = useCallback((now: number) => {
    bombStartRef.current = now;
    bombDurationRef.current = randomBombTime();
  }, []);

  // ── 끝내기 ─────────────────────────────────────────
  const endGame = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    const score = scoreRef.current;
    const { isNewRecord } = saveGameResult({
      gameId: game.id,
      score,
      metadata: {
        mode: modeRef.current,
        players: playersRef.current,
        maxCombo: maxComboRef.current,
      },
    });
    const elapsedSec =
      Math.round(((performance.now() - gameStartRef.current) / 1000) * 10) / 10;
    if (modeRef.current === "solo") {
      setResult({
        kind: "solo",
        score,
        isNewRecord,
        passed: playersRef.current[0].passed,
        maxCombo: maxComboRef.current,
        elapsedSec,
      });
    } else {
      const loserName = playersRef.current[currentIdxRef.current]?.name ?? "?";
      // 폭탄 안 맞은 사람들 → 통과 수 내림차순, 폭탄 맞은 사람은 맨 끝
      const ranked = playersRef.current
        .slice()
        .sort((a, b) => {
          if (a.name === loserName) return 1;
          if (b.name === loserName) return -1;
          return b.passed - a.passed;
        });
      setResult({
        kind: "multi",
        score,
        isNewRecord,
        loserName,
        ranked,
        elapsedSec,
      });
    }
    setPhase("result");
  }, [game.id]);

  // ── 정답 제출 ───────────────────────────────────────
  const submit = useCallback(
    (value: number, now: number) => {
      const correct = value === problemRef.current.answer;
      const p = playersRef.current[currentIdxRef.current];
      if (correct) {
        let gain = 10;
        if (comboRef.current >= 3) gain += 5;
        scoreRef.current += gain;
        comboRef.current += 1;
        p.passed += 1;
        maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
        if (comboRef.current === 3 || comboRef.current % 5 === 0) playCombo();
        else playCorrect();
        flashRef.current = { kind: "correct", until: now + 350 };
        if (modeRef.current === "multi") {
          advanceToNext();
          flashRef.current = { kind: "turn", until: now + 700 };
        }
        // 정답=폭탄 패스. 새 문제만, 폭탄 타이머는 계속 째깍.
        nextProblem();
      } else {
        comboRef.current = 0;
        playWrong();
        flashRef.current = { kind: "wrong", until: now + 350 };
        hoverIdxRef.current = -1;
      }
    },
    [advanceToNext, nextProblem]
  );

  // 폭탄 폭발 → 한 게임 끝 (현재 차례 학생이 패배)
  const explode = useCallback((now: number) => {
    playBoom();
    flashRef.current = { kind: "boom", until: now + 1300 };
    gameOverPendingRef.current = now;
  }, []);

  // ── 그리기 ─────────────────────────────────────────
  const draw = useCallback((now: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const bg = ctx.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, "#1E1B4B");
    bg.addColorStop(1, "#0F172A");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CW, CH);

    const fl = flashRef.current;
    if (fl && now < fl.until) {
      if (fl.kind === "boom") ctx.fillStyle = "rgba(239,68,68,0.35)";
      else if (fl.kind === "correct") ctx.fillStyle = "rgba(16,185,129,0.25)";
      else if (fl.kind === "wrong") ctx.fillStyle = "rgba(239,68,68,0.18)";
      else ctx.fillStyle = "rgba(252,211,77,0.15)";
      ctx.fillRect(0, 0, CW, CH);
    }

    if (modeRef.current === "multi") {
      const cur = playersRef.current[currentIdxRef.current];
      ctx.fillStyle = "#FCD34D";
      ctx.font = "bold 28px Inter, Pretendard, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${cur.name} 차례!`, CW / 2, 28);
    }

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 60px Inter, Pretendard, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${problemRef.current.text} = ?`, CW / 2, 80);

    const cx = CW / 2;
    const cy = CH / 2;
    // 폭탄에 살짝 일정한 흔들림 (남은 시간 정보는 노출 X — 언제 터질지 모르게)
    const shake = Math.sin(now / 180) * 2.5;
    const bombSize = 110;
    ctx.save();
    ctx.translate(cx + shake, cy);
    ctx.font = `${bombSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("💣", 0, 0);
    ctx.restore();

    // 아래에 안내문 (시간 숫자 대신)
    ctx.fillStyle = "rgba(252,211,77,0.7)";
    ctx.font = "bold 22px Inter, sans-serif";
    ctx.fillText("째깍… 째깍…", cx + shake, cy + bombSize * 0.7 + 14);

    choicesRef.current.forEach((r, i) => {
      const hovered = hoverIdxRef.current === i;
      ctx.fillStyle = hovered
        ? "rgba(252,211,77,0.35)"
        : "rgba(255,255,255,0.10)";
      ctx.strokeStyle = hovered ? "#FCD34D" : "rgba(255,255,255,0.4)";
      ctx.lineWidth = hovered ? 4 : 3;
      roundRect(ctx, r.x, r.y, r.w, r.h, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 72px Inter, Pretendard, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(r.value), r.x + r.w / 2, r.y + r.h / 2);
    });

    if (fl && fl.kind === "boom" && now < fl.until) {
      ctx.fillStyle = "#FCA5A5";
      ctx.font = "bold 96px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("쾅!", CW / 2, CH / 2 - 30);
    }
    if (fl && fl.kind === "turn" && now < fl.until) {
      const cur = playersRef.current[currentIdxRef.current];
      ctx.fillStyle = "#FCD34D";
      ctx.font = "bold 56px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`→ ${cur.name}!`, CW / 2, CH / 2 - 30);
    }
  }, []);

  const tick = useCallback(
    (now: number) => {
      if (!runningRef.current) return;
      // 폭발 후 BOOM 연출 → 1.2초 뒤 결과 화면
      if (gameOverPendingRef.current !== null) {
        draw(now);
        if (now - gameOverPendingRef.current >= 1200) {
          endGame();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const bombElapsed = (now - bombStartRef.current) / 1000;
      const bombLeft = Math.max(0, bombDurationRef.current - bombElapsed);

      if (
        Math.floor(bombElapsed) !== Math.floor(lastTickSoundRef.current) &&
        bombElapsed > 0.2
      ) {
        if (!muted) playTick();
      }
      lastTickSoundRef.current = bombElapsed;

      if (bombLeft <= 0) {
        explode(now);
      }

      draw(now);

      const cur = playersRef.current[currentIdxRef.current];
      const passedKey = playersRef.current.map((p) => p.passed).join(",");
      const key = `${scoreRef.current}|${comboRef.current}|${passedKey}|${currentIdxRef.current}`;
      if (key !== viewKeyRef.current) {
        viewKeyRef.current = key;
        setView({
          score: scoreRef.current,
          combo: comboRef.current,
          currentName: cur.name,
          players: playersRef.current.map((p) => ({ ...p })),
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [draw, endGame, explode, muted]
  );

  // ── 마우스 이벤트 ───────────────────────────────────
  const canvasMouseEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (phase !== "playing") return;
    const p = canvasMouseEvent(e);
    if (!p) return;
    mousePosRef.current = p;
    let hit = -1;
    choicesRef.current.forEach((r, i) => {
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)
        hit = i;
    });
    hoverIdxRef.current = hit;
  };

  const handleMouseLeave = () => {
    hoverIdxRef.current = -1;
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!runningRef.current) return;
    const p = canvasMouseEvent(e);
    if (!p) return;
    for (const r of choicesRef.current) {
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        submit(r.value, performance.now());
        return;
      }
    }
  };

  const beginGame = useCallback(() => {
    modeRef.current = mode;
    if (mode === "solo") {
      playersRef.current = [{ name: "나", passed: 0 }];
    } else {
      playersRef.current = playerNames
        .slice(0, numPlayers)
        .map((n) => ({
          name: n.trim() || "이름없음",
          passed: 0,
        }));
    }
    currentIdxRef.current = 0;
    scoreRef.current = 0;
    comboRef.current = 0;
    maxComboRef.current = 0;
    viewKeyRef.current = "";
    flashRef.current = null;
    runningRef.current = true;
    setPhase("playing");
    const now = performance.now();
    gameStartRef.current = now;
    resetBomb(now);
    nextProblem();
    lastTickSoundRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);
  }, [mode, numPlayers, playerNames, nextProblem, resetBomb, tick]);

  const handleStart = () => beginGame();

  const handleRetry = useCallback(() => {
    setResult(null);
    beginGame();
  }, [beginGame]);

  const toggleMute = () => {
    setMuted((m) => {
      setSoundMuted(!m);
      return !m;
    });
  };

  useEffect(() => {
    return () => {
      runningRef.current = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <>
      {phase === "intro" && (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
          <div className="rounded-card bg-white p-8 shadow-card">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${game.gradient} text-3xl`}
              >
                {game.emoji}
              </span>
              <div>
                <h1 className="text-2xl font-extrabold text-navy">{game.name}</h1>
                <p className="text-sm text-gray-500">
                  폭탄이 터지기 전에 답을 클릭하세요!
                </p>
              </div>
            </div>

            <p className="mt-6 text-sm font-semibold text-gray-700">모드</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["solo", "multi"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={
                    "rounded-xl border px-3 py-3 text-center transition " +
                    (mode === m
                      ? "border-brand bg-brand/10 text-brand-dark"
                      : "border-gray-200 text-gray-500 hover:bg-gray-50")
                  }
                >
                  <div className="font-bold">
                    {m === "solo" ? "혼자 도전" : "여러 명 (돌리기)"}
                  </div>
                  <div className="text-xs">
                    {m === "solo" ? "1인 도전" : "2~4명, 돌아가며"}
                  </div>
                </button>
              ))}
            </div>

            {mode === "multi" && (
              <>
                <p className="mt-4 text-sm font-semibold text-gray-700">인원</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => setNumPlayers(n)}
                      className={
                        "rounded-xl border px-3 py-2 text-center font-bold transition " +
                        (numPlayers === n
                          ? "border-brand bg-brand/10 text-brand-dark"
                          : "border-gray-200 text-gray-500 hover:bg-gray-50")
                      }
                    >
                      {n}명
                    </button>
                  ))}
                </div>

                <p className="mt-4 text-sm font-semibold text-gray-700">이름(선택)</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {playerNames.slice(0, numPlayers).map((n, i) => (
                    <input
                      key={i}
                      value={n}
                      maxLength={6}
                      onChange={(e) => {
                        const arr = playerNames.slice();
                        arr[i] = e.target.value;
                        setPlayerNames(arr);
                      }}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand"
                      placeholder={`${i + 1}번`}
                    />
                  ))}
                </div>
              </>
            )}

            <ul className="mt-6 space-y-1.5 text-sm text-gray-600">
              <li>
                · 🚨 <b>러시안 룰렛 폭탄!</b> 폭탄은 한 번 시작되면 <b>계속 째깍</b>
                (20초~2분 30초 사이 랜덤으로 폭발)
              </li>
              <li>· 정답을 빨리 클릭해서 폭탄을 다음으로 떠넘기는 게 핵심</li>
              {mode === "solo" ? (
                <>
                  <li>· 정답 +10점, 콤보 3+면 +5</li>
                  <li>· 폭탄이 터지면 <b>한 게임 끝</b> — 결과 보고 다시 시작</li>
                </>
              ) : (
                <>
                  <li>· 정답이면 폭탄이 <b>다음 사람</b>에게 패스! (마우스도 옆 사람에게)</li>
                  <li>
                    · 폭탄이 자기 차례에 펑 터지면 그 사람 <b>패배</b>, 나머지는 승리
                  </li>
                  <li>· 통과 수 많은 사람부터 순위 (패배자는 마지막)</li>
                </>
              )}
              <li>· 문제: 한 자리 덧셈·뺄셈 / 구구단 / 작은 나눗셈</li>
            </ul>

            <div className="mt-6 flex gap-2">
              <Link
                href="/"
                className="rounded-xl border border-gray-200 px-5 py-3 font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                허브로
              </Link>
              <button
                onClick={handleStart}
                className="flex-1 rounded-xl bg-brand py-3 text-lg font-bold text-white transition hover:bg-brand-dark"
              >
                시작하기
              </button>
            </div>
          </div>
        </main>
      )}

      {phase === "playing" && (
        <main className="mx-auto max-w-5xl px-3 py-4 sm:py-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            {modeRef.current === "solo" ? (
              <div className="text-sm text-gray-400">
                통과:{" "}
                <span className="font-num font-bold text-navy">
                  {view.players[0]?.passed ?? 0}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {view.players.map((p, i) => {
                  const isCur = i === currentIdxRef.current;
                  return (
                    <div
                      key={i}
                      className={
                        "rounded-lg px-2 py-1 text-xs " +
                        (isCur
                          ? "bg-amber-100 text-amber-700 font-bold ring-2 ring-amber-400"
                          : "bg-gray-100 text-gray-600")
                      }
                    >
                      <span>{p.name}</span>{" "}
                      <span className="font-num">({p.passed})</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-gray-400">점수</div>
                <div className="font-num text-2xl font-extrabold text-amber-500">
                  {view.score}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">콤보</div>
                <div className="font-num text-2xl font-extrabold text-mint">
                  {view.combo}
                </div>
              </div>
              <button
                onClick={toggleMute}
                className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-500 transition hover:bg-gray-200"
              >
                {muted ? "🔇" : "🔊"}
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-card shadow-card">
            <canvas
              ref={canvasRef}
              width={CW}
              height={CH}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onClick={handleCanvasClick}
              className="block w-full cursor-pointer"
            />
          </div>

          <p className="mt-3 text-center text-sm text-gray-400">
            {modeRef.current === "multi"
              ? `${view.currentName} 차례 — 정답을 클릭!`
              : "정답을 클릭하세요!"}
          </p>
        </main>
      )}

      {phase === "result" && result && result.kind === "solo" && (
        <ResultScreen
          game={game}
          score={result.score}
          isNewRecord={result.isNewRecord}
          stats={[
            { label: "버틴 시간", value: `${result.elapsedSec}초` },
            { label: "통과한 문제", value: `${result.passed}` },
            { label: "최대 콤보", value: `${result.maxCombo}` },
          ]}
          note="폭탄이 터졌어요!"
          onRetry={handleRetry}
        />
      )}

      {phase === "result" && result && result.kind === "multi" && (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
          <div className="rounded-card bg-white p-8 shadow-card">
            <p className="text-sm text-gray-400">
              {result.elapsedSec}초 만에 폭탄 폭발!
            </p>
            <h2 className="text-2xl font-extrabold text-red-500">
              💥 {result.loserName} 패배!
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              나머지는 모두 승리 — 통과 수 순위는 아래.
            </p>
            {result.isNewRecord && (
              <p className="mt-1 text-sm font-bold text-amber-500">
                팀 통과 신기록!
              </p>
            )}

            <div className="mt-5 space-y-2">
              {result.ranked.map((p, i) => {
                const isLoser = p.name === result.loserName;
                return (
                  <div
                    key={i}
                    className={
                      "flex items-center justify-between rounded-xl border px-4 py-3 " +
                      (isLoser
                        ? "border-red-300 bg-red-50"
                        : i === 0
                          ? "border-amber-300 bg-amber-50"
                          : "border-gray-200 bg-white")
                    }
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-num text-xl font-extrabold text-navy">
                        {isLoser ? "💥" : `${i + 1}위`}
                      </span>
                      <span
                        className={
                          "text-lg font-bold " +
                          (isLoser ? "text-red-600 line-through" : "")
                        }
                      >
                        {p.name}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500">
                      {p.passed}문제 통과
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex gap-2">
              <Link
                href="/"
                className="flex-1 rounded-xl border border-gray-200 py-3 text-center font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                허브로
              </Link>
              <button
                onClick={handleRetry}
                className="flex-1 rounded-xl bg-brand py-3 font-bold text-white transition hover:bg-brand-dark"
              >
                다시 도전
              </button>
            </div>
          </div>
        </main>
      )}
    </>
  );
}
