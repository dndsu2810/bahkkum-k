"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { Game } from "@/lib/games";
import { saveGameResult } from "@/lib/records";
import { playCorrect, playBeep, setMuted as setSoundMuted } from "@/lib/sound";

const CW = 960;
const CH = 540;
const GAME_SECONDS = 30;
const WIPE_RADIUS = 75; // 손이 한 번에 닦는 영역 반지름

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const P1_COLOR = "#06B6D4"; // 청록
const P2_COLOR = "#EC4899"; // 핑크

type Phase = "intro" | "setup" | "playing" | "result" | "error";

type HandPos = { x: number; y: number };

export default function WindowWashGame({ game }: { game: Game }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dirtCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);

  const gameStartRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const lastSampleRef = useRef(0);

  // 각 사람 손 위치 (커서 표시용)
  const p1HandsRef = useRef<HandPos[]>([]);
  const p2HandsRef = useRef<HandPos[]>([]);

  // 진행도
  const p1ProgressRef = useRef(0);
  const p2ProgressRef = useRef(0);

  // 이름
  const [p1Name, setP1Name] = useState("1번");
  const [p2Name, setP2Name] = useState("2번");

  const [phase, setPhase] = useState<Phase>("intro");
  const [muted, setMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [view, setView] = useState({
    timeLeft: GAME_SECONDS,
    p1: 0,
    p2: 0,
    detected: true,
  });
  const viewKeyRef = useRef("");

  const [result, setResult] = useState<{
    p1: number;
    p2: number;
    winner: string;
    score: number;
    isNewRecord: boolean;
  } | null>(null);

  // ── 더러운 마스크 초기화 ─────────────────────────
  const initDirtCanvas = useCallback(() => {
    if (!dirtCanvasRef.current) {
      const c = document.createElement("canvas");
      c.width = CW;
      c.height = CH;
      dirtCanvasRef.current = c;
    }
    const ctx = dirtCanvasRef.current.getContext("2d");
    if (!ctx) return;
    // 갈색 더러움 + 얼룩
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = "rgba(120, 90, 60, 0.88)";
    ctx.fillRect(0, 0, CW, CH);
    // 얼룩 점들
    ctx.fillStyle = "rgba(70, 50, 30, 0.55)";
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * CW;
      const y = Math.random() * CH;
      const r = 12 + Math.random() * 28;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 빗자국
    ctx.strokeStyle = "rgba(90, 65, 40, 0.45)";
    ctx.lineWidth = 4;
    for (let i = 0; i < 28; i++) {
      ctx.beginPath();
      const x = Math.random() * CW;
      const y = Math.random() * CH;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 120);
      ctx.stroke();
    }
    p1ProgressRef.current = 0;
    p2ProgressRef.current = 0;
  }, []);

  // ── 닦기 ─────────────────────────────────────────
  const wipeAt = useCallback((x: number, y: number, halfStart: number, halfEnd: number) => {
    const dirt = dirtCanvasRef.current;
    if (!dirt) return;
    const ctx = dirt.getContext("2d");
    if (!ctx) return;
    ctx.save();
    // 자기 영역만 닦기 (반대편 침범 방지)
    ctx.beginPath();
    ctx.rect(halfStart, 0, halfEnd - halfStart, CH);
    ctx.clip();
    ctx.globalCompositeOperation = "destination-out";
    const r = WIPE_RADIUS;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.6, "rgba(0,0,0,0.7)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    ctx.restore();
  }, []);

  // ── 진행도 샘플링 ───────────────────────────────
  const sampleProgress = useCallback(() => {
    const dirt = dirtCanvasRef.current;
    if (!dirt) return;
    const ctx = dirt.getContext("2d");
    if (!ctx) return;
    const halfW = CW / 2;
    const STEP = 18;
    try {
      const dataL = ctx.getImageData(0, 0, halfW, CH).data;
      const dataR = ctx.getImageData(halfW, 0, halfW, CH).data;
      let cleanedL = 0;
      let cleanedR = 0;
      let total = 0;
      for (let y = 0; y < CH; y += STEP) {
        for (let x = 0; x < halfW; x += STEP) {
          const i = (y * halfW + x) * 4 + 3;
          total++;
          if (dataL[i] < 60) cleanedL++;
          if (dataR[i] < 60) cleanedR++;
        }
      }
      p1ProgressRef.current = (cleanedL / total) * 100;
      p2ProgressRef.current = (cleanedR / total) * 100;
    } catch {
      // 무시
    }
  }, []);

  // ── 끝내기 ───────────────────────────────────────
  const endGame = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    sampleProgress();
    const p1 = Math.round(p1ProgressRef.current);
    const p2 = Math.round(p2ProgressRef.current);
    const winner = p1 > p2 ? p1Name : p2 > p1 ? p2Name : "무승부";
    const score = Math.max(p1, p2);
    const { isNewRecord } = saveGameResult({
      gameId: game.id,
      score,
      metadata: { p1Name, p2Name, p1Progress: p1, p2Progress: p2 },
    });
    if (winner === "무승부") playCorrect();
    else playCorrect();
    setResult({ p1, p2, winner, score, isNewRecord });
    setPhase("result");
  }, [game.id, p1Name, p2Name, sampleProgress]);

  // ── 그리기 ───────────────────────────────────────
  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    const video = videoRef.current;
    const dirt = dirtCanvasRef.current;
    if (!ctx) return;
    // 배경
    ctx.fillStyle = "#0F172A";
    ctx.fillRect(0, 0, CW, CH);

    // 웹캠 (거울 모드) — 닦은 곳에 보이게
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      ctx.save();
      ctx.translate(CW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, CW, CH);
      ctx.restore();
    }

    // 더러움 마스크 위에
    if (dirt) ctx.drawImage(dirt, 0, 0);

    // 분리선
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.setLineDash([12, 8]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CW / 2, 0);
    ctx.lineTo(CW / 2, CH);
    ctx.stroke();
    ctx.setLineDash([]);

    // 손 커서
    for (const h of p1HandsRef.current) {
      ctx.fillStyle = P1_COLOR + "55";
      ctx.beginPath();
      ctx.arc(h.x, h.y, WIPE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = P1_COLOR;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(h.x, h.y, WIPE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const h of p2HandsRef.current) {
      ctx.fillStyle = P2_COLOR + "55";
      ctx.beginPath();
      ctx.arc(h.x, h.y, WIPE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = P2_COLOR;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(h.x, h.y, WIPE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 이름 라벨
    ctx.fillStyle = P1_COLOR;
    ctx.font = "bold 26px Inter, Pretendard, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(p1Name, 20, 16);
    ctx.fillStyle = P2_COLOR;
    ctx.textAlign = "right";
    ctx.fillText(p2Name, CW - 20, 16);
  }, [p1Name, p2Name]);

  // ── 루프 ──────────────────────────────────────────
  const tick = useCallback(
    (now: number) => {
      if (!runningRef.current) return;
      const elapsed = (now - gameStartRef.current) / 1000;
      const timeLeft = Math.max(0, GAME_SECONDS - elapsed);

      // 손 인식
      const video = videoRef.current;
      const lm = landmarkerRef.current;
      let detected = false;
      if (video && lm && video.readyState >= 2 && video.videoWidth > 0) {
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          try {
            const res = lm.detectForVideo(video, now);
            const p1: HandPos[] = [];
            const p2: HandPos[] = [];
            for (const hand of res.landmarks) {
              // 손바닥 중심: 손목(0) + 손가락 시작점들(5,9,13,17) 평균
              const pts = [0, 5, 9, 13, 17].map((i) => hand[i]).filter(Boolean);
              if (pts.length === 0) continue;
              let sx = 0;
              let sy = 0;
              for (const p of pts) {
                sx += p.x;
                sy += p.y;
              }
              sx /= pts.length;
              sy /= pts.length;
              // 거울 좌표
              const dispX = (1 - sx) * CW;
              const dispY = sy * CH;
              if (dispX < CW / 2) {
                p1.push({ x: dispX, y: dispY });
                wipeAt(dispX, dispY, 0, CW / 2);
              } else {
                p2.push({ x: dispX, y: dispY });
                wipeAt(dispX, dispY, CW / 2, CW);
              }
            }
            p1HandsRef.current = p1;
            p2HandsRef.current = p2;
            detected = p1.length + p2.length > 0;
          } catch {
            // 무시
          }
        } else {
          detected = p1HandsRef.current.length + p2HandsRef.current.length > 0;
        }
      }

      // 주기 샘플링 (300ms마다)
      if (now - lastSampleRef.current > 300) {
        lastSampleRef.current = now;
        sampleProgress();
      }

      draw();

      // HUD
      const tF = Math.ceil(timeLeft);
      const p1Pct = Math.round(p1ProgressRef.current);
      const p2Pct = Math.round(p2ProgressRef.current);
      const key = `${tF}|${p1Pct}|${p2Pct}|${detected}`;
      if (key !== viewKeyRef.current) {
        viewKeyRef.current = key;
        setView({ timeLeft: tF, p1: p1Pct, p2: p2Pct, detected });
      }

      if (timeLeft <= 0) {
        endGame();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [draw, endGame, sampleProgress, wipeAt]
  );

  // ── 준비 ──────────────────────────────────────────
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
    initDirtCanvas();
    p1HandsRef.current = [];
    p2HandsRef.current = [];
    viewKeyRef.current = "";
    runningRef.current = true;
    setPhase("playing");
    const now = performance.now();
    gameStartRef.current = now;
    lastSampleRef.current = 0;
    playBeep();
    rafRef.current = requestAnimationFrame(tick);
  }, [initDirtCanvas, tick]);

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
                  손으로 창문을 닦아 더 많이 깨끗하게 만든 사람이 승리!
                </p>
              </div>
            </div>

            <p className="mt-6 text-sm font-semibold text-gray-700">이름</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-400">왼쪽 (청록)</label>
                <input
                  value={p1Name}
                  maxLength={6}
                  onChange={(e) => setP1Name(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand"
                  placeholder="1번"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">오른쪽 (핑크)</label>
                <input
                  value={p2Name}
                  maxLength={6}
                  onChange={(e) => setP2Name(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand"
                  placeholder="2번"
                />
              </div>
            </div>

            <ul className="mt-6 space-y-1.5 text-sm text-gray-600">
              <li>· 카메라 앞에 두 명이 <b>나란히</b> 서기 (왼쪽·오른쪽)</li>
              <li>· 손을 휘저어서 화면의 더러운 부분을 닦아요 (양손 OK)</li>
              <li>· 자기 영역만 닦혀요 (왼쪽은 왼쪽 사람만, 오른쪽은 오른쪽 사람만)</li>
              <li>· 30초 후 <b>더 많이 닦은 사람이 승리</b>!</li>
            </ul>

            <p className="mt-6 rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-500">
              온몸이 아니어도 돼요. 손이 화면에 잘 보이면 됨. 1.5~2m 거리에서 카메라 정면으로 서주세요.
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
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div
                className="rounded-lg px-3 py-1 text-sm font-bold text-white"
                style={{ background: P1_COLOR }}
              >
                {p1Name} · {view.p1}%
              </div>
              <span className="text-sm text-gray-400">VS</span>
              <div
                className="rounded-lg px-3 py-1 text-sm font-bold text-white"
                style={{ background: P2_COLOR }}
              >
                {p2Name} · {view.p2}%
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs text-gray-400">남은</div>
                <div className="font-num text-2xl font-extrabold text-brand">
                  {view.timeLeft}초
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

          {/* 진행도 막대 */}
          <div className="mb-3 flex gap-2">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full transition-[width] duration-200"
                style={{ width: `${view.p1}%`, background: P1_COLOR }}
              />
            </div>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full transition-[width] duration-200"
                style={{ width: `${view.p2}%`, background: P2_COLOR }}
              />
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
            손을 휘저어 자기 영역을 깨끗하게!
            {!view.detected && (
              <span className="ml-2 text-amber-600">(손이 안 보여요)</span>
            )}
          </p>
        </main>
      )}

      {phase === "result" && result && (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
          <div className="rounded-card bg-white p-8 shadow-card">
            <p className="text-sm text-gray-400">30초 닦기 결과</p>
            <h2 className="text-2xl font-extrabold text-navy">
              {result.winner === "무승부"
                ? "🤝 무승부!"
                : `🏆 ${result.winner} 우승!`}
            </h2>
            {result.isNewRecord && (
              <p className="mt-1 text-sm font-bold text-amber-500">
                기록 신기록!
              </p>
            )}

            <div className="mt-5 space-y-3">
              <div
                className="flex items-center justify-between rounded-xl border-2 px-4 py-3"
                style={{ borderColor: P1_COLOR }}
              >
                <span className="text-lg font-bold" style={{ color: P1_COLOR }}>
                  {p1Name}
                </span>
                <span className="font-num text-2xl font-extrabold">{result.p1}%</span>
              </div>
              <div
                className="flex items-center justify-between rounded-xl border-2 px-4 py-3"
                style={{ borderColor: P2_COLOR }}
              >
                <span className="text-lg font-bold" style={{ color: P2_COLOR }}>
                  {p2Name}
                </span>
                <span className="font-num text-2xl font-extrabold">{result.p2}%</span>
              </div>
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
