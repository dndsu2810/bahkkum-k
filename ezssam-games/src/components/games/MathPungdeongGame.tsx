"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Game } from "@/lib/games";
import { saveGameResult } from "@/lib/records";
import { generateProblem, generateWrong } from "@/lib/diveProblems";
import {
  computeFeatures,
  drawPoseFigure,
  pickTwoPoses,
  type Features,
  type LM,
  type PoseSpec,
} from "@/lib/poses";
import { playCorrect, playWrong, playBeep, setMuted as setSoundMuted } from "@/lib/sound";
import ResultScreen from "@/components/ResultScreen";

const CW = 960;
const CH = 540;
const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

type Phase = "intro" | "setup" | "countdown" | "playing" | "result" | "error";

type Round = {
  problem: { text: string; answer: number };
  wrong: number;
  correctSide: "left" | "right";
  leftPose: PoseSpec;
  rightPose: PoseSpec;
  leftAnswer: number;
  rightAnswer: number;
  wallTime: number;
  golden: boolean;
};

function wallTimeByTime(t: number): number {
  if (t < 15) return 5;
  if (t < 30) return 4;
  if (t < 45) return 3;
  if (t < 60) return 2.5;
  return 2;
}
function stageLabel(t: number): string {
  if (t < 10) return "구구단";
  if (t < 25) return "두 자리 곱셈";
  if (t < 45) return "혼합 계산";
  if (t < 60) return "괄호 혼합";
  return "어려운 혼합";
}

const SKELETON: [number, number][] = [
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 12],
  [23, 24],
  [11, 23],
  [12, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

export default function MathPungdeongGame({ game }: { game: Game }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const poseRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);

  const gameStartRef = useRef(0);
  const roundRef = useRef<Round | null>(null);
  const roundStartRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const passedRef = useRef(0);
  const featuresRef = useRef<Features | null>(null);
  const lmRef = useRef<LM[] | null>(null);
  const detectedRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);

  const [phase, setPhase] = useState<Phase>("intro");
  const [muted, setMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [countNum, setCountNum] = useState(3);
  const [view, setView] = useState({
    survival: 0,
    combo: 0,
    passed: 0,
    stage: "구구단",
    problem: "",
    detected: true,
    golden: false,
  });
  const [result, setResult] = useState<{
    score: number;
    isNewRecord: boolean;
    passed: number;
    maxCombo: number;
  } | null>(null);

  const viewKeyRef = useRef("");

  const startRound = useCallback((now: number) => {
    const t = (now - gameStartRef.current) / 1000;
    const problem = generateProblem(t);
    let wrong = generateWrong(problem.answer);
    const [pa, pb] = pickTwoPoses(t);
    const correctSide: "left" | "right" =
      Math.random() < 0.5 ? "left" : "right";

    // 황금 벽: 10문제마다 확률 — 두 벽 같은 답 + 아무 포즈 OK + 2초 보너스
    const golden = passedRef.current > 0 && passedRef.current % 10 === 0 && Math.random() < 0.5;
    if (golden) wrong = problem.answer;

    roundRef.current = {
      problem,
      wrong,
      correctSide,
      leftPose: pa,
      rightPose: pb,
      leftAnswer: correctSide === "left" ? problem.answer : wrong,
      rightAnswer: correctSide === "right" ? problem.answer : wrong,
      wallTime: wallTimeByTime(t),
      golden,
    };
    roundStartRef.current = now;
  }, []);

  const endGame = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    const score = Math.round(((performance.now() - gameStartRef.current) / 1000) * 10) / 10;
    const { isNewRecord } = saveGameResult({
      gameId: game.id,
      score,
      metadata: { passed: passedRef.current, maxCombo: maxComboRef.current },
    });
    setResult({
      score,
      isNewRecord,
      passed: passedRef.current,
      maxCombo: maxComboRef.current,
    });
    setPhase("result");
  }, [game.id]);

  const draw = useCallback((p: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    const video = videoRef.current;
    const round = roundRef.current;
    if (!ctx || !round) return;

    // 트로피컬 배경
    const bg = ctx.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, "#7FD8E8");
    bg.addColorStop(0.7, "#BDEAF0");
    bg.addColorStop(0.7, "#F6E2B3");
    bg.addColorStop(1, "#EBD49A");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CW, CH);

    // 웹캠 (거울, 반투명)
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.translate(CW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, CW, CH);
      ctx.restore();
    }

    // 학생 스켈레톤
    const lm = lmRef.current;
    if (lm) {
      ctx.save();
      ctx.strokeStyle = "rgba(52,152,200,0.9)";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      for (const [a, b] of SKELETON) {
        const pa = lm[a];
        const pb = lm[b];
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo((1 - pa.x) * CW, pa.y * CH);
        ctx.lineTo((1 - pb.x) * CW, pb.y * CH);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 벽 두 개 (다가옴)
    const drawWall = (
      centerX: number,
      pose: PoseSpec,
      answer: number,
      isCorrect: boolean
    ) => {
      const w = 70 + p * (CW * 0.42 - 70);
      const h = 100 + p * (CH * 0.8 - 100);
      const x = centerX - w / 2;
      const y = CH * 0.46 - h / 2;

      ctx.save();
      ctx.globalAlpha = 0.92;
      // 벽 몸체
      ctx.fillStyle = "#9CA3AF";
      ctx.strokeStyle = "#4B5563";
      ctx.lineWidth = Math.max(2, 0.03 * w);
      const r = 0.08 * w;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
      ctx.stroke();
      // 포즈 구멍 (밝게)
      ctx.fillStyle = "#E5E7EB";
      ctx.beginPath();
      ctx.roundRect(x + w * 0.12, y + h * 0.08, w * 0.76, h * 0.56, r);
      ctx.fill();
      // 포즈 스틱피겨
      drawPoseFigure(
        ctx,
        centerX,
        y + h * 0.34,
        h * 0.44,
        pose,
        isCorrect ? "#1F2937" : "#374151"
      );
      // 답 숫자
      ctx.fillStyle = "#1F2937";
      ctx.font = `bold ${Math.max(16, h * 0.18)}px Inter, Pretendard, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(answer), centerX, y + h * 0.8);
      ctx.restore();
    };

    drawWall(
      CW * 0.27,
      round.leftPose,
      round.leftAnswer,
      round.correctSide === "left"
    );
    drawWall(
      CW * 0.73,
      round.rightPose,
      round.rightAnswer,
      round.correctSide === "right"
    );
  }, []);

  const tick = useCallback(
    (now: number) => {
      if (!runningRef.current) return;
      const round = roundRef.current;
      if (!round) return;

      // 포즈 인식
      const video = videoRef.current;
      const pose = poseRef.current;
      if (video && pose && video.readyState >= 2 && video.videoWidth > 0) {
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          try {
            const res = pose.detectForVideo(video, now);
            const lmArr = res.landmarks?.[0];
            if (lmArr) {
              lmRef.current = lmArr as LM[];
              featuresRef.current = computeFeatures(lmArr as LM[]);
              detectedRef.current = true;
            } else {
              detectedRef.current = false;
              featuresRef.current = null;
              lmRef.current = null;
            }
          } catch {
            // 무시
          }
        }
      }

      const p = Math.min(1, (now - roundStartRef.current) / (round.wallTime * 1000));
      draw(p);

      // 벽 도착 → 판정
      if (p >= 1) {
        const target =
          round.correctSide === "left" ? round.leftPose : round.rightPose;
        const f = featuresRef.current;
        const pass = round.golden ? true : !!f && target.match(f);
        if (pass) {
          passedRef.current += 1;
          comboRef.current += 1;
          maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
          if (round.golden) gameStartRef.current -= 2000; // 2초 보너스
          playCorrect();
          startRound(now);
        } else {
          playWrong();
          endGame();
          return;
        }
      }

      // HUD
      const survival = (now - gameStartRef.current) / 1000;
      const key = `${Math.floor(survival * 10)}|${comboRef.current}|${passedRef.current}|${detectedRef.current}|${round.golden}`;
      if (key !== viewKeyRef.current) {
        viewKeyRef.current = key;
        setView({
          survival: Math.round(survival * 10) / 10,
          combo: comboRef.current,
          passed: passedRef.current,
          stage: stageLabel(survival),
          problem: round.problem.text,
          detected: detectedRef.current,
          golden: round.golden,
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [draw, endGame, startRound]
  );

  const ensurePose = useCallback(async () => {
    if (poseRef.current) return;
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const make = (delegate: "GPU" | "CPU") =>
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    try {
      poseRef.current = await make("GPU");
    } catch {
      poseRef.current = await make("CPU");
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
    comboRef.current = 0;
    maxComboRef.current = 0;
    passedRef.current = 0;
    viewKeyRef.current = "";
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
        const now = performance.now();
        gameStartRef.current = now;
        runningRef.current = true;
        startRound(now);
        setPhase("playing");
        rafRef.current = requestAnimationFrame(tick);
      }
    }, 800);
  }, [startRound, tick]);

  const handleStart = useCallback(async () => {
    setPhase("setup");
    setErrorMsg("");
    try {
      await ensurePose();
      await startCamera();
      beginGame();
    } catch (e) {
      setErrorMsg(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "카메라 권한이 거부됐어요. 브라우저 주소창의 카메라 아이콘에서 허용해 주세요."
          : "카메라 또는 자세 인식 준비 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요."
      );
      setPhase("error");
    }
  }, [ensurePose, startCamera, beginGame]);

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
      poseRef.current?.close();
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
                  정답 벽의 포즈를 따라하고 벽을 통과해라!
                </p>
              </div>
            </div>

            <ul className="mt-6 space-y-1.5 text-sm text-gray-600">
              <li>· 문제를 풀고, 정답이 적힌 벽의 포즈를 몸으로 따라해요.</li>
              <li>· 벽이 도착하는 순간 포즈가 맞으면 통과, 틀리면 풍덩!</li>
              <li>· 오래 버틸수록 점수가 올라가요 (점수 = 버틴 시간).</li>
              <li>· 시간이 지날수록 문제도 어려워지고 벽도 빨라져요.</li>
            </ul>

            <p className="mt-6 rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-500">
              수업용 게임이라 카메라가 필요해요. 온몸이 보이게 1.5~2m 떨어져 서
              주세요. (영상은 저장되지 않아요.)
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
            카메라랑 자세 인식을 준비하고 있어요…
          </p>
          <p className="text-sm text-gray-400">온몸이 보이게 뒤로 서주세요.</p>
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
              <div className="text-xs text-gray-400">
                {view.stage}
                {view.golden && (
                  <span className="ml-2 font-bold text-amber-500">
                    ✨ 황금 벽! 아무 포즈나 OK
                  </span>
                )}
              </div>
              <div className="truncate font-num text-2xl font-extrabold text-navy">
                {view.problem || "준비"} {view.problem && "= ?"}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-gray-400">생존</div>
                <div className="font-num text-2xl font-extrabold text-brand">
                  {view.survival.toFixed(1)}초
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">콤보</div>
                <div className="font-num text-2xl font-extrabold text-amber-500">
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

          <div className="relative overflow-hidden rounded-card shadow-card">
            <canvas
              ref={canvasRef}
              width={CW}
              height={CH}
              className="block w-full"
            />
            {phase === "countdown" && (
              <div className="absolute inset-0 flex items-center justify-center bg-navy/30">
                <div className="font-num text-8xl font-extrabold text-white drop-shadow-lg">
                  {countNum}
                </div>
              </div>
            )}
          </div>

          <p className="mt-3 text-center text-sm text-gray-400">
            정답이 적힌 벽의 포즈를 따라하세요!
            {!view.detected && (
              <span className="ml-2 text-amber-600">
                (온몸이 보이게 뒤로 서주세요)
              </span>
            )}
          </p>
        </main>
      )}

      {phase === "result" && result && (
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
    </>
  );
}
