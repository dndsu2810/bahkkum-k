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
import type { Stroke } from "@/lib/laser";
import {
  classifyShape,
  pickMission,
  type ShapeLabel,
  type ShapeMission,
} from "@/lib/shapeRec";

const CW = 960;
const CH = 540;
const TRAIL_LIFE_MS = 1000;
const IDLE_AUTO_SUBMIT_SEC = 1.4;
const GAME_SECONDS = 60;
const MIN_POINTS = 12;
const SIGNIFICANT_MOVE_PX = 2.5;
const FINGER_LOST_MS = 700;
const JUDGE_DELAY_MS = 1100; // 인식 결과 표시 후 다음 미션까지

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

type Phase = "intro" | "setup" | "playing" | "result" | "error";
type TimedPoint = { x: number; y: number; t: number };

export default function ShapeDrawGame({ game }: { game: Game }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);

  // 게임 상태
  const gameStartRef = useRef(0);
  const missionRef = useRef<ShapeMission>(pickMission());
  const missionStartRef = useRef(0);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const passedRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);

  // 그리기 상태
  const trailRef = useRef<TimedPoint[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const fingerPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastFingerSeenRef = useRef(0);
  const lastSignificantMoveRef = useRef(0);

  // 결과
  const judgeRef = useRef<{
    result: { label: ShapeLabel; correct: boolean };
    until: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>("intro");
  const [muted, setMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [view, setView] = useState({
    timeLeft: GAME_SECONDS,
    score: 0,
    combo: 0,
    missionText: "",
    missionHint: "",
    judgeLabel: "" as string,
    judgeCorrect: false,
    judging: false,
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
  const startMission = useCallback((now: number, prev?: ShapeLabel) => {
    missionRef.current = pickMission(prev);
    missionStartRef.current = now;
    strokesRef.current = [];
    currentStrokeRef.current = null;
    trailRef.current = [];
    judgeRef.current = null;
    lastSignificantMoveRef.current = now;
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

  // ── 인식 + 판정 ─────────────────────────────────────
  const triggerJudge = useCallback(
    (now: number) => {
      // current stroke 닫기
      if (currentStrokeRef.current && currentStrokeRef.current.length >= 2) {
        strokesRef.current.push(currentStrokeRef.current);
        currentStrokeRef.current = null;
      }
      const res = classifyShape(strokesRef.current);
      const target = missionRef.current.label;
      const correct = res.label === target;
      console.log(
        `[도형] 목표=${target} | 인식=${res.label} | corners=${res.corners} closed=${res.closed} star=${res.starScore.toFixed(2)} circ=${res.circScore.toFixed(2)} → ${correct ? "정답" : "오답"}`
      );
      judgeRef.current = {
        result: { label: res.label, correct },
        until: now + JUDGE_DELAY_MS,
      };
      if (correct) {
        let gain = 10;
        if (comboRef.current >= 3) gain += 5;
        scoreRef.current += gain;
        comboRef.current += 1;
        passedRef.current += 1;
        maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
        if (comboRef.current === 3 || comboRef.current % 5 === 0) playCombo();
        else playCorrect();
      } else {
        comboRef.current = 0;
        playWrong();
      }
    },
    []
  );

  // ── 캔버스 그리기 ───────────────────────────────────
  const draw = useCallback((now: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    // 배경 (어두운 청록)
    const bg = ctx.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, "#064E3B");
    bg.addColorStop(1, "#022C22");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CW, CH);

    // 정답/오답 플래시
    const j = judgeRef.current;
    if (j && now < j.until) {
      ctx.fillStyle = j.result.correct
        ? "rgba(16,185,129,0.20)"
        : "rgba(239,68,68,0.18)";
      ctx.fillRect(0, 0, CW, CH);
    }

    // 그린 stroke들 (형광 연두)
    ctx.strokeStyle = "rgba(190,242,100,0.95)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "#84CC16";
    ctx.shadowBlur = 14;
    for (const s of strokesRef.current) {
      if (s.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
      ctx.stroke();
    }
    if (currentStrokeRef.current && currentStrokeRef.current.length >= 2) {
      const s = currentStrokeRef.current;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // 손끝 잔상
    for (let i = 1; i < trailRef.current.length; i++) {
      const a = trailRef.current[i - 1];
      const b = trailRef.current[i];
      const age = now - b.t;
      if (age > TRAIL_LIFE_MS) continue;
      const alpha = 1 - age / TRAIL_LIFE_MS;
      ctx.strokeStyle = `rgba(190,242,100,${alpha * 0.6})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = "#84CC16";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 손끝 점
    if (fingerPosRef.current) {
      const fp = fingerPosRef.current;
      ctx.fillStyle = "rgba(190,242,100,0.55)";
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ECFCCB";
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, 8, 0, Math.PI * 2);
      ctx.fill();

      // 자동 인식 임박 링
      if (!judgeRef.current) {
        const idle = (now - lastSignificantMoveRef.current) / 1000;
        const totalPts =
          strokesRef.current.reduce((a, s) => a + s.length, 0) +
          (currentStrokeRef.current?.length ?? 0);
        if (idle > 0.4 && totalPts >= MIN_POINTS) {
          const prog = Math.min(1, idle / IDLE_AUTO_SUBMIT_SEC);
          ctx.strokeStyle = "rgba(236,252,203,0.85)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(fp.x, fp.y, 32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
          ctx.stroke();
        }
      }
    }

    // 미션 텍스트 (상단)
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "bold 44px Inter, Pretendard, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(missionRef.current.text, CW / 2, 50);
    ctx.font = "16px Pretendard, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(`힌트: ${missionRef.current.hint}`, CW / 2, 84);

    // 결과 표시
    if (j && now < j.until) {
      const text = j.result.correct
        ? `정답! (${j.result.label})`
        : `${j.result.label}으로 보였어요`;
      ctx.fillStyle = j.result.correct ? "#10B981" : "#FCA5A5";
      ctx.font = "bold 56px Inter, Pretendard, sans-serif";
      ctx.fillText(text, CW / 2, CH / 2);
    }
  }, []);

  // ── 메인 루프 ───────────────────────────────────────
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

      // 판정 표시 중이면 새 미션으로 전환
      if (judgeRef.current && now >= judgeRef.current.until) {
        const prev = missionRef.current.label;
        startMission(now, prev);
      }

      if (fingerNow) {
        const prev = fingerPosRef.current;
        fingerPosRef.current = fingerNow;
        lastFingerSeenRef.current = now;
        trailRef.current.push({ x: fingerNow.x, y: fingerNow.y, t: now });

        // 판정 중이 아니면 그리기
        if (!judgeRef.current) {
          const moveDist = prev
            ? Math.hypot(fingerNow.x - prev.x, fingerNow.y - prev.y)
            : 0;
          if (!currentStrokeRef.current) {
            currentStrokeRef.current = [{ x: fingerNow.x, y: fingerNow.y }];
            lastSignificantMoveRef.current = now;
          } else if (moveDist >= SIGNIFICANT_MOVE_PX) {
            currentStrokeRef.current.push({ x: fingerNow.x, y: fingerNow.y });
            lastSignificantMoveRef.current = now;
          }
          const totalPts =
            strokesRef.current.reduce((a, s) => a + s.length, 0) +
            (currentStrokeRef.current?.length ?? 0);
          if (
            totalPts >= MIN_POINTS &&
            (now - lastSignificantMoveRef.current) / 1000 >= IDLE_AUTO_SUBMIT_SEC
          ) {
            triggerJudge(now);
          }
        }
      } else {
        if (now - lastFingerSeenRef.current > FINGER_LOST_MS) {
          if (currentStrokeRef.current && currentStrokeRef.current.length >= 2) {
            strokesRef.current.push(currentStrokeRef.current);
          }
          currentStrokeRef.current = null;
          fingerPosRef.current = null;
        }
      }

      // 잔상 만료 정리
      while (
        trailRef.current.length > 0 &&
        now - trailRef.current[0].t > TRAIL_LIFE_MS
      )
        trailRef.current.shift();

      draw(now);

      // HUD
      const tF = Math.ceil(timeLeft);
      const detected = !!fingerNow;
      const j = judgeRef.current;
      const judging = !!j && now < j.until;
      const key = `${tF}|${scoreRef.current}|${comboRef.current}|${missionRef.current.text}|${detected}|${judging}|${j?.result.label ?? ""}|${j?.result.correct ?? false}`;
      if (key !== viewKeyRef.current) {
        viewKeyRef.current = key;
        setView({
          timeLeft: tF,
          score: scoreRef.current,
          combo: comboRef.current,
          missionText: missionRef.current.text,
          missionHint: missionRef.current.hint,
          judging,
          judgeLabel: j?.result.label ?? "",
          judgeCorrect: j?.result.correct ?? false,
          detected,
        });
      }

      if (timeLeft <= 0) {
        endGame();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [draw, endGame, startMission, triggerJudge]
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
                <h1 className="text-2xl font-extrabold text-navy">
                  {game.name}
                </h1>
                <p className="text-sm text-gray-500">
                  공중에 손가락으로 도형을 그리면 자동 인식돼요
                </p>
              </div>
            </div>

            <ul className="mt-6 space-y-1.5 text-sm text-gray-600">
              <li>· 60초 동안 미션 도형(삼각형·사각형·원·별)을 그려요</li>
              <li>· 검지 손가락으로 공중에 도형을 큼지막하게</li>
              <li>· 1.4초 멈추면 자동 인식 → 맞으면 +10점 (콤보 3+이면 +5)</li>
              <li>· 도형은 한 번에 이어 그리는 게 좋아요 (시작점과 끝점이 가깝게)</li>
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
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-500">
              {view.detected ? "손 인식 ✓" : "손이 보이지 않아요"}
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

          <div className="overflow-hidden rounded-card shadow-card">
            <canvas
              ref={canvasRef}
              width={CW}
              height={CH}
              className="block w-full"
            />
          </div>

          <p className="mt-3 text-center text-sm text-gray-400">
            검지 손가락으로 도형을 크게 그려요. 1.4초 멈추면 자동 인식.
          </p>
        </main>
      )}

      {phase === "result" && result && (
        <ResultScreen
          game={game}
          score={result.score}
          isNewRecord={result.isNewRecord}
          stats={[
            { label: "맞춘 도형", value: `${result.passed}` },
            { label: "최대 콤보", value: `${result.maxCombo}` },
          ]}
          onRetry={handleRetry}
        />
      )}
    </>
  );
}
