"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { Game } from "@/lib/games";
import { saveGameResult } from "@/lib/records";
import {
  generateMissionSet,
  type MissionSet,
} from "@/lib/missions";
import {
  playBeep,
  playCorrect,
  playWrong,
  playCombo,
  setMuted as setSoundMuted,
} from "@/lib/sound";
import ResultScreen from "@/components/ResultScreen";

// ── 상수 ──────────────────────────────────────────────
const CW = 960;
const CH = 540;
const BALLOON_R = 58; // 풍선을 좀 더 크게 (잡기 편하게)
const HIT_FACTOR = 0.95; // 풍선 거의 전체 영역에서 인식 (인식 너그럽게)
const GAME_SECONDS = 60;
const MISSION_SWITCH_AT = 30; // 30초 지나면 미션 자동 전환
const WARN_BEFORE = 2;

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const COLORS = ["#FF6B6B", "#5DADE2", "#FCD34D", "#34D399", "#A78BFA"];

type DifficultyKey = "쉬움" | "보통" | "어려움";
const DIFFICULTIES: Record<
  DifficultyKey,
  { max: number; count: number; speed: number; sway: number; desc: string }
> = {
  쉬움: { max: 30, count: 8, speed: 70, sway: 14, desc: "숫자 1~30" },
  보통: { max: 50, count: 12, speed: 95, sway: 20, desc: "숫자 1~50" },
  어려움: { max: 100, count: 15, speed: 130, sway: 26, desc: "숫자 1~100" },
};

type Balloon = {
  id: number;
  num: number;
  correct: boolean;
  baseX: number;
  x: number;
  y: number;
  color: string;
  sway: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};

type Cursor = { x: number; y: number };
type Phase = "intro" | "setup" | "countdown" | "playing" | "result" | "error";

export default function YaksuBalloonGame({ game }: { game: Game }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);

  const balloonsRef = useRef<Balloon[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const cursorsRef = useRef<Cursor[]>([]);
  const nextIdRef = useRef(1);

  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const missedRef = useRef<Map<number, number>>(new Map());
  const missionSetRef = useRef<MissionSet>(generateMissionSet(50));

  const startRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const switchedRef = useRef(false);
  const diffKeyRef = useRef<DifficultyKey>("보통");

  const [phase, setPhase] = useState<Phase>("intro");
  const [difficulty, setDifficulty] = useState<DifficultyKey>("보통");
  const [muted, setMuted] = useState(false);
  const [countNum, setCountNum] = useState(3);
  const [errorMsg, setErrorMsg] = useState("");
  const [hud, setHud] = useState({
    score: 0,
    combo: 0,
    time: GAME_SECONDS,
    warn: false,
    mission: "",
  });
  const [result, setResult] = useState<{
    score: number;
    isNewRecord: boolean;
    maxCombo: number;
    note?: string;
  } | null>(null);

  const hudCacheRef = useRef({ score: -1, combo: -1, time: -1, warn: false });

  // ── 풍선/파티클 ─────────────────────────────────────
  const countCorrect = () =>
    balloonsRef.current.reduce((a, b) => a + (b.correct ? 1 : 0), 0);

  const spawnBalloon = useCallback((initial: boolean) => {
    const diff = DIFFICULTIES[diffKeyRef.current];
    const { corrects, wrongs } = missionSetRef.current;

    let correct: boolean;
    if (corrects.length === 0) correct = false;
    else if (wrongs.length === 0) correct = true;
    else if (countCorrect() < 3) correct = true;
    else correct = Math.random() < 0.42;

    const pool = correct ? corrects : wrongs;
    const num = pool[Math.floor(Math.random() * pool.length)];
    const baseX = BALLOON_R + 20 + Math.random() * (CW - 2 * (BALLOON_R + 20));
    const y = initial
      ? CH * 0.25 + Math.random() * CH * 0.8
      : CH + BALLOON_R + Math.random() * 80;

    balloonsRef.current.push({
      id: nextIdRef.current++,
      num,
      correct,
      baseX,
      x: baseX,
      y,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      sway: Math.random() * Math.PI * 2,
    });
  }, []);

  const spawnParticles = (x: number, y: number, color: string) => {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 160;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5,
        color,
      });
    }
  };

  // ── 그리기 ──────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const video = videoRef.current;
    if (!ctx) return;

    // 배경 (하늘)
    const bg = ctx.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, "#AED6F1");
    bg.addColorStop(1, "#EBF5FB");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CW, CH);

    // 웹캠 (거울 모드, 반투명)
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.translate(CW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, CW, CH);
      ctx.restore();
    }

    // 풍선
    for (const b of balloonsRef.current) {
      const grad = ctx.createRadialGradient(
        b.x - 14,
        b.y - 16,
        6,
        b.x,
        b.y,
        BALLOON_R
      );
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.25, b.color);
      grad.addColorStop(1, b.color);
      // 끈
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + BALLOON_R);
      ctx.lineTo(b.x, b.y + BALLOON_R + 22);
      ctx.stroke();
      // 몸체
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALLOON_R, 0, Math.PI * 2);
      ctx.fill();
      // 숫자
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 34px Inter, Pretendard, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.strokeText(String(b.num), b.x, b.y);
      ctx.fillText(String(b.num), b.x, b.y);
    }

    // 파티클
    for (const p of particlesRef.current) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 손끝 커서
    for (const c of cursorsRef.current) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(93,173,226,0.35)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#3498C8";
      ctx.stroke();
    }
  }, []);

  // ── 게임 루프 ───────────────────────────────────────
  const endGame = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);

    const score = Math.round(scoreRef.current);
    const maxCombo = maxComboRef.current;
    const missedTop = Array.from(missedRef.current.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n]) => n);
    const note =
      missedTop.length > 0
        ? `이번엔 ${missedTop.join(", ")} 같은 정답 풍선을 자주 놓쳤어요!`
        : undefined;

    const { isNewRecord } = saveGameResult({
      gameId: game.id,
      score,
      metadata: { maxCombo, missedNumbers: missedTop },
    });
    setResult({ score, isNewRecord, maxCombo, note });
    setPhase("result");
  }, [game.id]);

  const tick = useCallback(
    (now: number) => {
      if (!runningRef.current) return;
      const diff = DIFFICULTIES[diffKeyRef.current];
      let dt = (now - lastFrameRef.current) / 1000;
      if (dt > 0.05) dt = 0.05;
      lastFrameRef.current = now;

      const elapsed = (now - startRef.current) / 1000;
      const timeLeft = Math.max(0, GAME_SECONDS - elapsed);

      // 미션 자동 전환
      let warn = false;
      if (!switchedRef.current) {
        if (elapsed >= MISSION_SWITCH_AT) {
          missionSetRef.current = generateMissionSet(diff.max);
          switchedRef.current = true;
          // 화면의 풍선들 정답 여부 재평가
          for (const b of balloonsRef.current) {
            b.correct = missionSetRef.current.mission.isCorrect(b.num);
          }
        } else if (elapsed >= MISSION_SWITCH_AT - WARN_BEFORE) {
          warn = true;
        }
      }

      // 손 인식
      const video = videoRef.current;
      const lm = landmarkerRef.current;
      if (video && lm && video.readyState >= 2 && video.videoWidth > 0) {
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          try {
            const res = lm.detectForVideo(video, now);
            const cursors: Cursor[] = [];
            // 손마다 여러 손가락 끝을 모두 커서로 — 잡기 쉬워짐
            const TIP_IDX = [4, 8, 12, 16, 20]; // 엄지·검지·중지·약지·새끼
            for (const hand of res.landmarks) {
              for (const idx of TIP_IDX) {
                const tip = hand[idx];
                if (tip) cursors.push({ x: (1 - tip.x) * CW, y: tip.y * CH });
              }
            }
            cursorsRef.current = cursors;
          } catch {
            // 인식 실패 프레임은 무시
          }
        }
      }

      // 풍선 이동 + 화면 밖 처리
      const survivors: Balloon[] = [];
      for (const b of balloonsRef.current) {
        b.sway += dt * 2;
        b.x = b.baseX + Math.sin(b.sway) * diff.sway;
        b.y -= diff.speed * dt;
        if (b.y < -BALLOON_R) {
          if (b.correct) {
            missedRef.current.set(b.num, (missedRef.current.get(b.num) ?? 0) + 1);
          }
        } else {
          survivors.push(b);
        }
      }
      balloonsRef.current = survivors;

      // 충돌 판정 (커서당 한 풍선)
      const removed = new Set<number>();
      for (const c of cursorsRef.current) {
        for (const b of balloonsRef.current) {
          if (removed.has(b.id)) continue;
          const dx = c.x - b.x;
          const dy = c.y - b.y;
          if (dx * dx + dy * dy < (BALLOON_R * HIT_FACTOR) ** 2) {
            removed.add(b.id);
            spawnParticles(b.x, b.y, b.color);
            if (b.correct) {
              const bonus = comboRef.current >= 3 ? 5 : 0;
              scoreRef.current += 10 + bonus;
              comboRef.current += 1;
              maxComboRef.current = Math.max(
                maxComboRef.current,
                comboRef.current
              );
              if (comboRef.current === 3 || comboRef.current % 5 === 0)
                playCombo();
              else playCorrect();
            } else {
              scoreRef.current = Math.max(0, scoreRef.current - 5);
              comboRef.current = 0;
              playWrong();
            }
            break;
          }
        }
      }
      if (removed.size > 0) {
        balloonsRef.current = balloonsRef.current.filter(
          (b) => !removed.has(b.id)
        );
      }

      // 풍선 보충
      while (balloonsRef.current.length < diff.count) spawnBalloon(false);

      // 파티클 갱신
      const ps: Particle[] = [];
      for (const p of particlesRef.current) {
        p.life -= dt;
        if (p.life > 0) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 200 * dt;
          ps.push(p);
        }
      }
      particlesRef.current = ps;

      draw();

      // HUD 갱신 (값 바뀔 때만)
      const cache = hudCacheRef.current;
      const t = Math.ceil(timeLeft);
      if (
        cache.score !== scoreRef.current ||
        cache.combo !== comboRef.current ||
        cache.time !== t ||
        cache.warn !== warn
      ) {
        hudCacheRef.current = {
          score: scoreRef.current,
          combo: comboRef.current,
          time: t,
          warn,
        };
        setHud({
          score: scoreRef.current,
          combo: comboRef.current,
          time: t,
          warn,
          mission: missionSetRef.current.mission.text,
        });
      }

      if (timeLeft <= 0) {
        endGame();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [draw, endGame, spawnBalloon]
  );

  // ── 시작/준비 ───────────────────────────────────────
  const ensureLandmarker = useCallback(async () => {
    if (landmarkerRef.current) return;
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const make = (delegate: "GPU" | "CPU") =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: 2,
      });
    try {
      landmarkerRef.current = await make("GPU");
    } catch {
      landmarkerRef.current = await make("CPU");
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (streamRef.current) {
      // 이미 켜져 있으면 재사용
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

  const beginCountdown = useCallback(() => {
    diffKeyRef.current = difficulty;
    const diff = DIFFICULTIES[difficulty];
    // 게임 상태 초기화
    scoreRef.current = 0;
    comboRef.current = 0;
    maxComboRef.current = 0;
    missedRef.current = new Map();
    balloonsRef.current = [];
    particlesRef.current = [];
    cursorsRef.current = [];
    switchedRef.current = false;
    missionSetRef.current = generateMissionSet(diff.max);
    for (let i = 0; i < diff.count; i++) spawnBalloon(true);
    hudCacheRef.current = { score: -1, combo: -1, time: -1, warn: false };

    setPhase("countdown");
    setCountNum(3);
    playBeep();
    let n = 3;
    const iv = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCountNum(n);
        playBeep();
      } else {
        clearInterval(iv);
        // 시작!
        runningRef.current = true;
        startRef.current = performance.now();
        lastFrameRef.current = startRef.current;
        lastSpawnRef.current = startRef.current;
        setPhase("playing");
        rafRef.current = requestAnimationFrame(tick);
      }
    }, 800);
  }, [difficulty, spawnBalloon, tick]);

  const handleStart = useCallback(async () => {
    setPhase("setup");
    setErrorMsg("");
    try {
      await ensureLandmarker();
      await startCamera();
      beginCountdown();
    } catch (e) {
      setErrorMsg(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "카메라 권한이 거부됐어요. 브라우저 주소창의 카메라 아이콘에서 허용해 주세요."
          : "카메라 또는 손 인식 준비 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요."
      );
      setPhase("error");
    }
  }, [ensureLandmarker, startCamera, beginCountdown]);

  const handleRetry = useCallback(() => {
    setResult(null);
    beginCountdown();
  }, [beginCountdown]);

  const toggleMute = () => {
    setMuted((m) => {
      setSoundMuted(!m);
      return !m;
    });
  };

  // 정리
  useEffect(() => {
    return () => {
      runningRef.current = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
    };
  }, []);

  // ── 화면 ────────────────────────────────────────────
  return (
    <>
      {/* 웹캠 (숨김, canvas 가 그려줌) */}
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
                <h1 className="text-2xl font-extrabold text-navy">
                  {game.name}
                </h1>
                <p className="text-sm text-gray-500">
                  미션에 맞는 숫자 풍선만 손으로 터뜨려요!
                </p>
              </div>
            </div>

            <ul className="mt-6 space-y-1.5 text-sm text-gray-600">
              <li>· 60초 동안 미션(예: &quot;18의 약수&quot;)에 맞는 풍선만 잡아요.</li>
              <li>· 양손 모두 쓸 수 있어요. 정답 +10점, 오답 -5점.</li>
              <li>· 30초가 지나면 미션이 한 번 바뀌어요.</li>
            </ul>

            <p className="mt-6 text-sm font-semibold text-gray-700">난이도</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(Object.keys(DIFFICULTIES) as DifficultyKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setDifficulty(k)}
                  className={
                    "rounded-xl border px-3 py-3 text-center transition " +
                    (difficulty === k
                      ? "border-brand bg-brand/10 text-brand-dark"
                      : "border-gray-200 text-gray-500 hover:bg-gray-50")
                  }
                >
                  <div className="font-bold">{k}</div>
                  <div className="text-xs">{DIFFICULTIES[k].desc}</div>
                </button>
              ))}
            </div>

            <p className="mt-6 rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-500">
              수업용 게임이라 카메라가 필요해요. &quot;시작&quot;을 누르면 카메라 권한을
              물어봐요. 안심하고 허용해 주세요. (영상은 저장되지 않아요.)
            </p>

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
          <p className="text-sm text-gray-400">
            처음엔 몇 초 걸릴 수 있어요. 카메라 허용 창이 뜨면 눌러주세요.
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

      {(phase === "countdown" || phase === "playing") && (
        <main className="mx-auto max-w-5xl px-3 py-4 sm:py-6">
          {/* HUD */}
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-gray-400">미션</div>
              <div className="truncate text-lg font-extrabold text-navy">
                {hud.mission || missionSetRef.current.mission.text}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-gray-400">점수</div>
                <div className="font-num text-2xl font-extrabold text-brand">
                  {hud.score}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">콤보</div>
                <div className="font-num text-2xl font-extrabold text-amber-500">
                  {hud.combo}
                </div>
              </div>
              <button
                onClick={toggleMute}
                className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-500 transition hover:bg-gray-200"
                title="소리 켜기/끄기"
              >
                {muted ? "🔇" : "🔊"}
              </button>
            </div>
          </div>

          {/* 타이머 바 */}
          <div className="mb-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-200"
              style={{ width: `${(hud.time / GAME_SECONDS) * 100}%` }}
            />
          </div>

          {/* 게임 화면 */}
          <div className="relative overflow-hidden rounded-card shadow-card">
            <canvas
              ref={canvasRef}
              width={CW}
              height={CH}
              className="block w-full"
            />

            {hud.warn && phase === "playing" && (
              <div className="absolute left-1/2 top-4 -translate-x-1/2 animate-pulse rounded-full bg-amber-400 px-4 py-1.5 text-sm font-bold text-white shadow">
                곧 미션이 바뀌어요!
              </div>
            )}

            {phase === "countdown" && (
              <div className="absolute inset-0 flex items-center justify-center bg-navy/30">
                <div className="font-num text-8xl font-extrabold text-white drop-shadow-lg">
                  {countNum}
                </div>
              </div>
            )}
          </div>

          <p className="mt-3 text-center text-sm text-gray-400">
            손끝을 풍선 가운데로 가져가면 터져요. 화면에서 1~2걸음 떨어져 손이 잘
            보이게 해주세요.
          </p>
        </main>
      )}

      {phase === "result" && result && (
        <ResultScreen
          game={game}
          score={result.score}
          isNewRecord={result.isNewRecord}
          stats={[{ label: "최대 콤보", value: `${result.maxCombo}` }]}
          note={result.note}
          onRetry={handleRetry}
        />
      )}
    </>
  );
}
