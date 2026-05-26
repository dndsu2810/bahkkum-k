"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
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
import {
  generateAngleMission,
  angleBetween,
  angleCategory,
  type AngleMission,
} from "@/lib/angles";

const CW = 960;
const CH = 540;
const HOLD_SEC = 0.8; // 미션 각도 유지 시간
const GAME_SECONDS = 60;
const MISS_TIMEOUT_SEC = 14; // 한 미션에 14초 못 풀면 자동 패스 (다음으로)

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

type LM = { x: number; y: number; visibility?: number };
type Phase = "intro" | "setup" | "playing" | "result" | "error";

export default function AngleHunterGame({ game }: { game: Game }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const poseRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);

  // 게임 상태
  const missionRef = useRef<AngleMission>(generateAngleMission());
  const missionStartRef = useRef(0);
  const gameStartRef = useRef(0);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const passedRef = useRef(0);
  const holdStartRef = useRef<number | null>(null); // 미션 유지 시작 시각
  const lastVideoTimeRef = useRef(-1);
  const lmRef = useRef<LM[] | null>(null);
  const currentAngleRef = useRef(0);
  const detectedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("intro");
  const [muted, setMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [view, setView] = useState({
    timeLeft: GAME_SECONDS,
    score: 0,
    combo: 0,
    angle: 0,
    mission: "",
    inRange: false,
    holdProgress: 0,
    detected: true,
  });
  const [result, setResult] = useState<{
    score: number;
    isNewRecord: boolean;
    passed: number;
    maxCombo: number;
  } | null>(null);
  const viewKeyRef = useRef("");

  // ── 새 미션 ────────────────────────────────────────
  const startMission = useCallback((now: number) => {
    missionRef.current = generateAngleMission();
    missionStartRef.current = now;
    holdStartRef.current = null;
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

  // ── 그리기 ─────────────────────────────────────────
  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    const video = videoRef.current;
    if (!ctx) return;

    // 배경
    const bg = ctx.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, "#EDE9FE");
    bg.addColorStop(1, "#DDD6FE");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CW, CH);

    // 웹캠 (거울)
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.translate(CW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, CW, CH);
      ctx.restore();
    }

    const lm = lmRef.current;
    if (lm) {
      const lsh = lm[11];
      const rsh = lm[12];
      const lwr = lm[15];
      const rwr = lm[16];
      if (lsh && rsh && lwr && rwr) {
        const cx = ((lsh.x + rsh.x) / 2);
        const cy = ((lsh.y + rsh.y) / 2);
        // 화면 좌표 (거울 변환)
        const toCx = (1 - cx) * CW;
        const toCy = cy * CH;
        const toLx = (1 - lwr.x) * CW;
        const toLy = lwr.y * CH;
        const toRx = (1 - rwr.x) * CW;
        const toRy = rwr.y * CH;

        // V자 두 선
        const inRange = missionRef.current.isMatch(currentAngleRef.current);
        const color = inRange ? "#10B981" : "#7C3AED";
        ctx.strokeStyle = color;
        ctx.lineWidth = 8;
        ctx.lineCap = "round";
        ctx.shadowColor = color;
        ctx.shadowBlur = inRange ? 30 : 12;
        ctx.beginPath();
        ctx.moveTo(toLx, toLy);
        ctx.lineTo(toCx, toCy);
        ctx.lineTo(toRx, toRy);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 어깨중심 점
        ctx.fillStyle = "#1F2937";
        ctx.beginPath();
        ctx.arc(toCx, toCy, 10, 0, Math.PI * 2);
        ctx.fill();

        // 호 + 각도 숫자
        const lAng = Math.atan2(toLy - toCy, toLx - toCx);
        const rAng = Math.atan2(toRy - toCy, toRx - toCx);
        // 작은 각으로 그리기
        let a1 = lAng;
        let a2 = rAng;
        let diff = a2 - a1;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const sweep = diff;
        ctx.strokeStyle = inRange ? "#10B981" : "#7C3AED";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(toCx, toCy, 80, a1, a1 + sweep, sweep < 0);
        ctx.stroke();

        // 각도 숫자
        const arcMid = a1 + sweep / 2;
        const labelX = toCx + Math.cos(arcMid) * 120;
        const labelY = toCy + Math.sin(arcMid) * 120;
        ctx.fillStyle = inRange ? "#065F46" : "#5B21B6";
        ctx.font = "bold 36px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${Math.round(currentAngleRef.current)}°`, labelX, labelY);

        // 손목 점
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(toLx, toLy, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(toRx, toRy, 12, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, []);

  // ── 메인 루프 ───────────────────────────────────────
  const tick = useCallback(
    (now: number) => {
      if (!runningRef.current) return;
      const survival = (now - gameStartRef.current) / 1000;
      const timeLeft = Math.max(0, GAME_SECONDS - survival);

      // 자세 인식
      const video = videoRef.current;
      const pose = poseRef.current;
      if (video && pose && video.readyState >= 2 && video.videoWidth > 0) {
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          try {
            const res = pose.detectForVideo(video, now);
            const lm = res.landmarks?.[0];
            if (lm) {
              lmRef.current = lm as LM[];
              detectedRef.current = true;
              const lsh = (lm as LM[])[11];
              const rsh = (lm as LM[])[12];
              const lwr = (lm as LM[])[15];
              const rwr = (lm as LM[])[16];
              if (lsh && rsh && lwr && rwr) {
                const cx = (lsh.x + rsh.x) / 2;
                const cy = (lsh.y + rsh.y) / 2;
                currentAngleRef.current = angleBetween(
                  cx,
                  cy,
                  lwr.x,
                  lwr.y,
                  rwr.x,
                  rwr.y
                );
              }
            } else {
              detectedRef.current = false;
              lmRef.current = null;
            }
          } catch {
            // 무시
          }
        }
      }

      // 미션 매칭 + 유지 시간
      const mission = missionRef.current;
      const inRange = mission.isMatch(currentAngleRef.current);
      let holdProgress = 0;
      if (inRange) {
        if (holdStartRef.current === null) holdStartRef.current = now;
        const held = (now - holdStartRef.current) / 1000;
        holdProgress = Math.min(1, held / HOLD_SEC);
        if (held >= HOLD_SEC) {
          // 정답
          let gain = 10;
          if (comboRef.current >= 3) gain += 5;
          scoreRef.current += gain;
          comboRef.current += 1;
          passedRef.current += 1;
          maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
          if (comboRef.current === 3 || comboRef.current % 5 === 0) playCombo();
          else playCorrect();
          startMission(now);
        }
      } else {
        holdStartRef.current = null;
      }

      // 미션 타임아웃 (자동 패스)
      const missionAge = (now - missionStartRef.current) / 1000;
      if (missionAge > MISS_TIMEOUT_SEC) {
        comboRef.current = 0;
        playWrong();
        startMission(now);
      }

      draw();

      // HUD 갱신
      const tF = Math.ceil(timeLeft);
      const angleF = Math.round(currentAngleRef.current);
      const key = `${tF}|${scoreRef.current}|${comboRef.current}|${angleF}|${inRange}|${Math.round(holdProgress * 10)}|${detectedRef.current}|${mission.text}`;
      if (key !== viewKeyRef.current) {
        viewKeyRef.current = key;
        setView({
          timeLeft: tF,
          score: scoreRef.current,
          combo: comboRef.current,
          angle: angleF,
          mission: mission.text,
          inRange,
          holdProgress,
          detected: detectedRef.current,
        });
      }

      if (timeLeft <= 0) {
        endGame();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [draw, endGame, startMission]
  );

  // ── 준비 ───────────────────────────────────────────
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
    scoreRef.current = 0;
    comboRef.current = 0;
    maxComboRef.current = 0;
    passedRef.current = 0;
    viewKeyRef.current = "";
    runningRef.current = true;
    setPhase("playing");
    const now = performance.now();
    gameStartRef.current = now;
    startMission(now);
    playBeep();
    rafRef.current = requestAnimationFrame(tick);
  }, [startMission, tick]);

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
                <h1 className="text-2xl font-extrabold text-navy">
                  {game.name}
                </h1>
                <p className="text-sm text-gray-500">
                  양팔로 V자를 만들어 미션 각도를 맞추기
                </p>
              </div>
            </div>

            <ul className="mt-6 space-y-1.5 text-sm text-gray-600">
              <li>· 60초 동안 미션 각도를 양팔 V자로 만들어요</li>
              <li>· 정확한 각도(예: 90°)일 때도, 카테고리(예: 예각)일 때도 있어요</li>
              <li>· 0.8초 유지하면 정답 +10 (콤보 3+이면 +5)</li>
              <li>· 화면에 실시간 각도와 호가 표시돼요</li>
            </ul>

            <p className="mt-6 rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-500">
              온몸이(특히 어깨와 양손이) 카메라에 잘 보이게 1.5~2m 떨어져 서주세요.
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
            <div className="min-w-0">
              <div className="text-xs text-gray-400">미션</div>
              <div className="truncate text-lg font-extrabold text-navy">
                {view.mission}
              </div>
            </div>
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

          {/* 유지 진행 바 */}
          <div className="mb-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-mint transition-[width] duration-100"
              style={{ width: `${view.holdProgress * 100}%` }}
            />
          </div>

          <div className="overflow-hidden rounded-card shadow-card">
            <canvas
              ref={canvasRef}
              width={CW}
              height={CH}
              className="block w-full"
            />
          </div>

          <div className="mt-2 flex items-center justify-center gap-2 text-xs">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-600">
              현재 각도: <b className="text-brand-dark">{view.angle}°</b>
            </span>
            <span
              className={
                "rounded-full px-3 py-1 " +
                (view.inRange
                  ? "bg-mint/20 text-mint"
                  : "bg-gray-100 text-gray-400")
              }
            >
              {view.inRange ? "맞아요! 유지하세요 ✓" : "더 가까이…"}
            </span>
            {!view.detected && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
                온몸이 보이게 뒤로 서주세요
              </span>
            )}
          </div>
        </main>
      )}

      {phase === "result" && result && (
        <ResultScreen
          game={game}
          score={result.score}
          isNewRecord={result.isNewRecord}
          stats={[
            { label: "맞춘 미션", value: `${result.passed}` },
            { label: "최대 콤보", value: `${result.maxCombo}` },
          ]}
          onRetry={handleRetry}
        />
      )}
    </>
  );
}
