"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { Game } from "@/lib/games";
import { saveGameResult } from "@/lib/records";
import {
  playCorrect,
  playWrong,
  playBeep,
  playCombo,
  setMuted as setSoundMuted,
} from "@/lib/sound";
import ResultScreen from "@/components/ResultScreen";
import { generateBombProblem, type BombProblem } from "@/lib/bomb";

const CW = 960;
const CH = 540;
const BOMB_SEC = 5;
const PICK_HOLD_SEC = 0.4;
const GAME_SECONDS = 60;
const LIVES_START = 3;

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

type Phase = "intro" | "setup" | "playing" | "result" | "error";
type Mode = "solo" | "multi";

type ChoiceRect = {
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

const CHOICE_W = 180;
const CHOICE_H = 130;
const CHOICE_PAD = 24;

function makeChoiceRects(values: number[]): ChoiceRect[] {
  const topY = 140;
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

type PlayerStats = { name: string; lives: number; passed: number };

export default function BombPassGame({ game }: { game: Game }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);

  // 게임 설정
  const modeRef = useRef<Mode>("solo");
  const playersRef = useRef<PlayerStats[]>([
    { name: "나", lives: LIVES_START, passed: 0 },
  ]);
  const currentIdxRef = useRef(0);

  // 게임 상태
  const gameStartRef = useRef(0);
  const problemRef = useRef<BombProblem>(generateBombProblem());
  const choicesRef = useRef<ChoiceRect[]>(
    makeChoiceRects(problemRef.current.choices)
  );
  const bombStartRef = useRef(0);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);

  const fingerPosRef = useRef<{ x: number; y: number } | null>(null);
  const hoverIdxRef = useRef<number>(-1);
  const hoverStartRef = useRef<number>(0);
  const lastVideoTimeRef = useRef(-1);

  const flashRef = useRef<{
    kind: "boom" | "correct" | "wrong" | "turn";
    until: number;
  } | null>(null);
  const lastTickSoundRef = useRef(0);

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
  const [errorMsg, setErrorMsg] = useState("");
  const [view, setView] = useState({
    score: 0,
    combo: 0,
    timeLeft: GAME_SECONDS,
    detected: true,
    currentName: "나",
    players: playersRef.current,
  });
  const [result, setResult] = useState<
    | { kind: "solo"; score: number; isNewRecord: boolean; passed: number; maxCombo: number }
    | { kind: "multi"; score: number; isNewRecord: boolean; ranked: PlayerStats[] }
    | null
  >(null);
  const viewKeyRef = useRef("");

  // ── 다음 플레이어 (살아있는) ────────────────────────
  const advanceToNextAlive = useCallback(() => {
    if (modeRef.current === "solo") return;
    const ps = playersRef.current;
    const n = ps.length;
    let next = currentIdxRef.current;
    for (let i = 0; i < n; i++) {
      next = (next + 1) % n;
      if (ps[next].lives > 0) {
        currentIdxRef.current = next;
        return;
      }
    }
  }, []);

  // ── 새 문제 ────────────────────────────────────────
  const nextProblem = useCallback((now: number) => {
    problemRef.current = generateBombProblem();
    choicesRef.current = makeChoiceRects(problemRef.current.choices);
    bombStartRef.current = now;
    hoverIdxRef.current = -1;
    hoverStartRef.current = 0;
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
    if (modeRef.current === "solo") {
      setResult({
        kind: "solo",
        score,
        isNewRecord,
        passed: playersRef.current[0].passed,
        maxCombo: maxComboRef.current,
      });
    } else {
      const ranked = playersRef.current
        .slice()
        .sort((a, b) =>
          a.lives !== b.lives ? b.lives - a.lives : b.passed - a.passed
        );
      setResult({ kind: "multi", score, isNewRecord, ranked });
    }
    setPhase("result");
  }, [game.id]);

  // ── 게임 종료 판단 ──────────────────────────────────
  const checkGameOver = useCallback((): boolean => {
    const ps = playersRef.current;
    if (modeRef.current === "solo") {
      if (ps[0].lives <= 0) {
        endGame();
        return true;
      }
      return false;
    }
    const alive = ps.filter((p) => p.lives > 0).length;
    if (alive <= 1) {
      endGame();
      return true;
    }
    return false;
  }, [endGame]);

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
        // 다음 플레이어
        if (modeRef.current === "multi") {
          advanceToNextAlive();
          flashRef.current = { kind: "turn", until: now + 700 };
        }
        nextProblem(now);
      } else {
        comboRef.current = 0;
        playWrong();
        flashRef.current = { kind: "wrong", until: now + 350 };
        hoverIdxRef.current = -1;
        hoverStartRef.current = 0;
      }
    },
    [advanceToNextAlive, nextProblem]
  );

  // ── 폭탄 폭발 ───────────────────────────────────────
  const explode = useCallback(
    (now: number) => {
      const p = playersRef.current[currentIdxRef.current];
      p.lives -= 1;
      comboRef.current = 0;
      playWrong();
      flashRef.current = { kind: "boom", until: now + 700 };
      if (checkGameOver()) return;
      // 다음 사람으로 폭탄 전달
      if (modeRef.current === "multi") advanceToNextAlive();
      nextProblem(now);
    },
    [advanceToNextAlive, checkGameOver, nextProblem]
  );

  // ── 그리기 ─────────────────────────────────────────
  const draw = useCallback((now: number, bombLeft: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const urgent = bombLeft < 2;
    const bg = ctx.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, urgent ? "#7F1D1D" : "#1E1B4B");
    bg.addColorStop(1, urgent ? "#450A0A" : "#0F172A");
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

    // 다인 모드: 현재 차례 표시 (상단)
    if (modeRef.current === "multi") {
      const cur = playersRef.current[currentIdxRef.current];
      ctx.fillStyle = "#FCD34D";
      ctx.font = "bold 28px Inter, Pretendard, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${cur.name} 차례!`, CW / 2, 28);
    }

    // 문제
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 60px Inter, Pretendard, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${problemRef.current.text} = ?`, CW / 2, 80);

    // 폭탄 + 도화선
    const cx = CW / 2;
    const cy = CH / 2;
    const shake = urgent ? Math.sin(now / 40) * 8 : 0;
    const bombSize = 96;
    ctx.save();
    ctx.translate(cx + shake, cy);
    ctx.font = `${bombSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("💣", 0, 0);
    ctx.restore();

    const fuseR = bombSize * 0.85;
    const prog = Math.max(0, bombLeft / BOMB_SEC);
    ctx.strokeStyle = urgent ? "#FCA5A5" : "#FCD34D";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.shadowColor = urgent ? "#EF4444" : "#F59E0B";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(cx + shake, cy, fuseR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = urgent ? "#FCA5A5" : "#FCD34D";
    ctx.font = "bold 28px Inter, sans-serif";
    ctx.fillText(`${bombLeft.toFixed(1)}초`, cx + shake, cy + bombSize + 14);

    // 4지 선택지
    choicesRef.current.forEach((r, i) => {
      const hovered = hoverIdxRef.current === i;
      const hoverProg = hovered
        ? Math.min(1, (now - hoverStartRef.current) / 1000 / PICK_HOLD_SEC)
        : 0;
      ctx.fillStyle = hovered ? "rgba(252,211,77,0.35)" : "rgba(255,255,255,0.10)";
      ctx.strokeStyle = hovered ? "#FCD34D" : "rgba(255,255,255,0.4)";
      ctx.lineWidth = 3;
      roundRect(ctx, r.x, r.y, r.w, r.h, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 64px Inter, Pretendard, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(r.value), r.x + r.w / 2, r.y + r.h / 2);
      if (hoverProg > 0) {
        ctx.strokeStyle = "#10B981";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(
          r.x + r.w / 2,
          r.y + r.h / 2,
          r.w / 2 - 6,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * hoverProg
        );
        ctx.stroke();
      }
    });

    // 손끝
    if (fingerPosRef.current) {
      const fp = fingerPosRef.current;
      ctx.shadowColor = "#FCD34D";
      ctx.shadowBlur = 22;
      ctx.fillStyle = "rgba(252,211,77,0.55)";
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, 10, 0, Math.PI * 2);
      ctx.fill();
    }

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

  // ── 루프 ────────────────────────────────────────────
  const tick = useCallback(
    (now: number) => {
      if (!runningRef.current) return;
      const survival = (now - gameStartRef.current) / 1000;
      const timeLeft = Math.max(0, GAME_SECONDS - survival);

      // 손 인식
      const video = videoRef.current;
      const lm = landmarkerRef.current;
      let fingerNow: { x: number; y: number } | null = null;
      if (video && lm && video.readyState >= 2 && video.videoWidth > 0) {
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          try {
            const res = lm.detectForVideo(video, now);
            const hand = res.landmarks?.[0];
            const tip = hand?.[8];
            if (tip) fingerNow = { x: (1 - tip.x) * CW, y: tip.y * CH };
          } catch {
            // 무시
          }
        } else if (fingerPosRef.current) {
          fingerNow = fingerPosRef.current;
        }
      }
      if (fingerNow) fingerPosRef.current = fingerNow;

      const bombElapsed = (now - bombStartRef.current) / 1000;
      const bombLeft = Math.max(0, BOMB_SEC - bombElapsed);

      // 째깍
      if (
        Math.floor(bombElapsed) !== Math.floor(lastTickSoundRef.current) &&
        bombElapsed > 0.2
      ) {
        if (!muted) playBeep();
      }
      lastTickSoundRef.current = bombElapsed;

      if (bombLeft <= 0 && (!flashRef.current || now >= flashRef.current.until)) {
        explode(now);
      } else if (fingerNow) {
        let hit = -1;
        choicesRef.current.forEach((r, i) => {
          if (
            fingerNow!.x >= r.x &&
            fingerNow!.x <= r.x + r.w &&
            fingerNow!.y >= r.y &&
            fingerNow!.y <= r.y + r.h
          )
            hit = i;
        });
        if (hit !== hoverIdxRef.current) {
          hoverIdxRef.current = hit;
          hoverStartRef.current = now;
        } else if (hit !== -1) {
          const held = (now - hoverStartRef.current) / 1000;
          if (held >= PICK_HOLD_SEC) {
            submit(choicesRef.current[hit].value, now);
          }
        }
      }

      draw(now, bombLeft);

      // HUD
      const tF = Math.ceil(timeLeft);
      const detected = !!fingerNow;
      const cur = playersRef.current[currentIdxRef.current];
      const livesKey = playersRef.current.map((p) => p.lives).join(",");
      const key = `${tF}|${scoreRef.current}|${comboRef.current}|${livesKey}|${currentIdxRef.current}|${detected}`;
      if (key !== viewKeyRef.current) {
        viewKeyRef.current = key;
        setView({
          score: scoreRef.current,
          combo: comboRef.current,
          timeLeft: tF,
          detected,
          currentName: cur.name,
          players: playersRef.current.map((p) => ({ ...p })),
        });
      }

      if (timeLeft <= 0) {
        endGame();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [draw, endGame, explode, muted, submit]
  );

  // ── 준비 ───────────────────────────────────────────
  const ensureLandmarker = useCallback(async () => {
    if (landmarkerRef.current) return;
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const make = (delegate: "GPU" | "CPU") =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: 1,
      });
    try {
      landmarkerRef.current = await make("GPU");
    } catch {
      landmarkerRef.current = await make("CPU");
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (streamRef.current) {
      if (videoRef.current && !videoRef.current.srcObject) {
        videoRef.current.srcObject = streamRef.current;
        await videoRef.current.play().catch(() => {});
      }
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});
    }
  }, []);

  const beginGame = useCallback(() => {
    // 플레이어 셋업
    modeRef.current = mode;
    if (mode === "solo") {
      playersRef.current = [{ name: "나", lives: LIVES_START, passed: 0 }];
    } else {
      playersRef.current = playerNames
        .slice(0, numPlayers)
        .map((n) => ({ name: n.trim() || "이름없음", lives: LIVES_START, passed: 0 }));
    }
    currentIdxRef.current = 0;
    scoreRef.current = 0;
    comboRef.current = 0;
    maxComboRef.current = 0;
    viewKeyRef.current = "";
    runningRef.current = true;
    setPhase("playing");
    const now = performance.now();
    gameStartRef.current = now;
    nextProblem(now);
    lastTickSoundRef.current = 0;
    flashRef.current = null;
    rafRef.current = requestAnimationFrame(tick);
  }, [mode, numPlayers, playerNames, nextProblem, tick]);

  const handleStart = useCallback(async () => {
    setPhase("setup");
    setErrorMsg("");
    try {
      await ensureLandmarker();
      await startCamera();
      beginGame();
    } catch (e) {
      setErrorMsg(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "카메라 권한이 거부됐어요. 브라우저 주소창의 카메라 아이콘에서 허용해 주세요."
          : "카메라 또는 손 인식 준비 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요."
      );
      setPhase("error");
    }
  }, [ensureLandmarker, startCamera, beginGame]);

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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
    };
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        playsInline
        muted
        className="pointer-events-none absolute h-px w-px opacity-0"
      />

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
                  폭탄이 터지기 전에 답을 골라요!
                </p>
              </div>
            </div>

            {/* 모드 */}
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
                    {m === "solo" ? "1인, 생명 3개" : "2~4명, 돌아가며"}
                  </div>
                </button>
              ))}
            </div>

            {/* 인원 + 이름 */}
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
              <li>· 문제마다 <b>5초</b> 안에 답 4개 중 정답에 손가락 0.4초 머무름</li>
              {mode === "solo" ? (
                <>
                  <li>· 정답 +10점, 콤보 3+면 +5</li>
                  <li>· 못 풀면 펑! 생명 -1, 생명 0이거나 60초 다 되면 끝</li>
                </>
              ) : (
                <>
                  <li>· 정답이면 폭탄이 <b>다음 사람</b>에게 패스!</li>
                  <li>· 못 풀면 펑! 현재 차례인 사람 생명 -1, 다음 사람으로 폭탄 전달</li>
                  <li>· 끝까지 생존한 사람이 승리 (또는 60초 후 생명·통과 수 순위)</li>
                </>
              )}
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

      {phase === "setup" && (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand/30 border-t-brand" />
          <p className="font-semibold text-gray-600">
            카메라랑 손 인식을 준비하고 있어요…
          </p>
        </main>
      )}

      {phase === "error" && (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-4xl">📷</p>
          <p className="max-w-md font-semibold text-gray-700">{errorMsg}</p>
          <div className="mt-2 flex gap-2">
            <Link
              href="/"
              className="rounded-xl border border-gray-200 px-5 py-3 font-semibold text-gray-600 transition hover:bg-gray-50"
            >
              허브로
            </Link>
            <button
              onClick={handleStart}
              className="rounded-xl bg-brand px-5 py-3 font-bold text-white transition hover:bg-brand-dark"
            >
              다시 시도
            </button>
          </div>
        </main>
      )}

      {phase === "playing" && (
        <main className="mx-auto max-w-5xl px-3 py-4 sm:py-6">
          {/* HUD */}
          <div className="mb-3 flex items-center justify-between gap-3">
            {modeRef.current === "solo" ? (
              <div className="text-lg">
                {"❤️".repeat(view.players[0]?.lives ?? 0)}
                <span className="text-gray-300">
                  {"♡".repeat(LIVES_START - (view.players[0]?.lives ?? 0))}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {view.players.map((p, i) => {
                  const isCur =
                    i ===
                    (playersRef.current.indexOf(
                      playersRef.current[currentIdxRef.current]
                    ));
                  const dead = p.lives <= 0;
                  return (
                    <div
                      key={i}
                      className={
                        "rounded-lg px-2 py-1 text-xs " +
                        (dead
                          ? "bg-gray-100 text-gray-400 line-through"
                          : isCur
                            ? "bg-amber-100 text-amber-700 font-bold ring-2 ring-amber-400"
                            : "bg-gray-100 text-gray-600")
                      }
                    >
                      <span>{p.name}</span>{" "}
                      <span>{"❤️".repeat(p.lives)}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-gray-400">남은</div>
                <div className="font-num text-2xl font-extrabold text-brand">
                  {view.timeLeft}초
                </div>
              </div>
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
              className="block w-full"
            />
          </div>

          <p className="mt-3 text-center text-sm text-gray-400">
            {modeRef.current === "multi"
              ? `${view.currentName} 차례 — 정답에 손가락 0.4초 머무르기!`
              : "폭탄이 터지기 전에 정답에 손가락을 0.4초 머무르세요!"}
            {!view.detected && (
              <span className="ml-2 text-amber-600">(손이 안 보여요)</span>
            )}
          </p>
        </main>
      )}

      {phase === "result" && result && result.kind === "solo" && (
        <ResultScreen
          game={game}
          score={result.score}
          isNewRecord={result.isNewRecord}
          stats={[
            { label: "통과한 문제", value: `${result.passed}` },
            { label: "최대 콤보", value: `${result.maxCombo}` },
          ]}
          onRetry={handleRetry}
        />
      )}

      {phase === "result" && result && result.kind === "multi" && (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
          <div className="rounded-card bg-white p-8 shadow-card">
            <p className="text-sm text-gray-400">최종 순위</p>
            <h2 className="text-2xl font-extrabold text-navy">
              🏆 {result.ranked[0].name} 우승!
            </h2>
            {result.isNewRecord && (
              <p className="mt-1 text-sm font-bold text-amber-500">
                팀 통과 신기록!
              </p>
            )}

            <div className="mt-5 space-y-2">
              {result.ranked.map((p, i) => (
                <div
                  key={i}
                  className={
                    "flex items-center justify-between rounded-xl border px-4 py-3 " +
                    (i === 0
                      ? "border-amber-300 bg-amber-50"
                      : "border-gray-200 bg-white")
                  }
                >
                  <div className="flex items-center gap-3">
                    <span className="font-num text-xl font-extrabold text-navy">
                      {i + 1}위
                    </span>
                    <span className="text-lg font-bold">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span>
                      {p.lives > 0 ? "❤️".repeat(p.lives) : "💀"}{" "}
                    </span>
                    <span className="text-gray-500">{p.passed}문제 통과</span>
                  </div>
                </div>
              ))}
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
