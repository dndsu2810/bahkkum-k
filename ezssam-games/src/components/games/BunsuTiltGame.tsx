"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Game } from "@/lib/games";
import { saveGameResult } from "@/lib/records";
import {
  generatePair,
  stageTime,
  stageName,
  fracValue,
  simulateAnswerDistribution,
  type Frac,
  type Pair,
  type Side,
} from "@/lib/fractions";
import { playCorrect, playWrong, playBeep, setMuted as setSoundMuted } from "@/lib/sound";
import ResultScreen from "@/components/ResultScreen";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
// `_full` 모델: 정확도 향상
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

const MINI_W = 320;
const MINI_H = 180;
const LEFT_ZONE = 0.46; // 화면 표시 기준 코 x < 0.46 → 왼쪽 (살짝만 기울여도 인식)
const RIGHT_ZONE = 0.54;
const HOLD_SEC = 0.5; // 그쪽에 0.5초 머물러야 인정
const GRACE_SEC = 0.5; // 카운트다운 직후 0.5초 판정 보류
const MAX_LIVES = 3;

type Phase = "intro" | "setup" | "playing" | "result" | "error";
type RoundPhase = "countdown" | "answer" | "judge";

// 분수 표시
function FracView({ f, big }: { f: Frac; big?: boolean }) {
  const numSize = big ? "text-6xl" : "text-4xl";
  if (f.kind === "decimal") {
    return <span className={`font-num font-extrabold ${numSize}`}>{f.value}</span>;
  }
  const stacked = (num: number, den: number) => (
    <span className="inline-flex flex-col items-center leading-none">
      <span className={`font-num font-extrabold ${numSize}`}>{num}</span>
      <span className="my-1 h-1 w-full min-w-[2.5rem] rounded bg-current" />
      <span className={`font-num font-extrabold ${numSize}`}>{den}</span>
    </span>
  );
  if (f.kind === "frac") return stacked(f.num, f.den);
  // mixed
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`font-num font-extrabold ${big ? "text-6xl" : "text-4xl"}`}>
        {f.whole}
      </span>
      {stacked(f.num, f.den)}
    </span>
  );
}

export default function BunsuTiltGame({ game }: { game: Game }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);

  const poseRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);

  const livesRef = useRef(MAX_LIVES);
  const scoreRef = useRef(0); // 통과한 라운드 수
  const stageRef = useRef(1);
  const maxStageRef = useRef(1);
  const pairRef = useRef<Pair>(generatePair(1));
  // 디버그: 라운드 카운트 + 정답 좌/우 누적
  const roundNumRef = useRef(0);
  const leftCountRef = useRef(0);
  const rightCountRef = useRef(0);
  const centerCountRef = useRef(0);
  const roundPhaseRef = useRef<RoundPhase>("countdown");
  const roundStartRef = useRef(0);
  const answerStartRef = useRef(0);
  const judgeStartRef = useRef(0);
  const holdZoneRef = useRef<Side>("center");
  const holdStartRef = useRef(0);
  const leanRef = useRef<Side>("center");
  const noseXRef = useRef(0.5);
  const detectedRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const startStageRef = useRef(1);

  const [phase, setPhase] = useState<Phase>("intro");
  const [startStage, setStartStage] = useState(1);
  const [muted, setMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [view, setView] = useState({
    lives: MAX_LIVES,
    score: 0,
    stage: 1,
    roundPhase: "countdown" as RoundPhase,
    count: 3,
    lean: "center" as Side,
    timeLeft: 0,
    detected: true,
  });
  const [flash, setFlash] = useState<{
    answer: Side;
    correct: boolean;
  } | null>(null);
  const [result, setResult] = useState<{
    score: number;
    isNewRecord: boolean;
    maxStage: number;
  } | null>(null);
  // 디버그 패널용 통계
  const [debugStats, setDebugStats] = useState({
    round: 0,
    left: 0,
    right: 0,
    center: 0,
    currentSide: "-" as string,
  });

  const viewCacheRef = useRef("");

  const drawMini = useCallback(() => {
    const ctx = miniRef.current?.getContext("2d");
    const video = videoRef.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, MINI_W, MINI_H);
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      ctx.save();
      ctx.translate(MINI_W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, MINI_W, MINI_H);
      ctx.restore();
    } else {
      ctx.fillStyle = "#E5E7EB";
      ctx.fillRect(0, 0, MINI_W, MINI_H);
    }
    // 중앙선
    ctx.strokeStyle = "rgba(31,41,55,0.5)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(MINI_W / 2, 0);
    ctx.lineTo(MINI_W / 2, MINI_H);
    ctx.stroke();
    ctx.setLineDash([]);
    // 코 위치
    if (detectedRef.current) {
      const x = noseXRef.current * MINI_W;
      ctx.beginPath();
      ctx.arc(x, MINI_H / 2, 10, 0, Math.PI * 2);
      ctx.fillStyle = "#5DADE2";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
  }, []);

  const endGame = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    const score = scoreRef.current;
    const { isNewRecord } = saveGameResult({
      gameId: game.id,
      score,
      metadata: { maxStage: maxStageRef.current },
    });
    setResult({ score, isNewRecord, maxStage: maxStageRef.current });
    setPhase("result");
  }, [game.id]);

  const startRound = useCallback((now: number) => {
    const pair = generatePair(stageRef.current);
    pairRef.current = pair;
    roundNumRef.current += 1;

    // 통계 집계
    if (pair.answer === "left") leftCountRef.current += 1;
    else if (pair.answer === "right") rightCountRef.current += 1;
    else centerCountRef.current += 1;

    // 디버그 로그
    const lv = fracValue(pair.left);
    const rv = fracValue(pair.right);
    const bigger =
      Math.abs(lv - rv) < 1e-9 ? "equal" : lv > rv ? "left" : "right";
    console.log(
      `[분수] R${roundNumRef.current} stage=${stageRef.current} | ` +
        `L=${lv.toFixed(3)} R=${rv.toFixed(3)} | bigger=${bigger} | ` +
        `correctSide=${pair.answer} | 누적 L=${leftCountRef.current} R=${rightCountRef.current} C=${centerCountRef.current}`,
      { left: pair.left, right: pair.right }
    );
    setDebugStats({
      round: roundNumRef.current,
      left: leftCountRef.current,
      right: rightCountRef.current,
      center: centerCountRef.current,
      currentSide: pair.answer,
    });

    roundPhaseRef.current = "countdown";
    roundStartRef.current = now;
    holdZoneRef.current = "center";
    holdStartRef.current = now;
    setFlash(null);
    playBeep();
  }, []);

  const judge = useCallback(
    (chosen: Side, now: number) => {
      const answer = pairRef.current.answer;
      const correct = chosen === answer;
      console.log(
        `[분수 판정] R${roundNumRef.current} chosen=${chosen} correctSide=${answer} → ${correct ? "정답" : "오답"}`
      );
      roundPhaseRef.current = "judge";
      judgeStartRef.current = now;
      setFlash({ answer, correct });
      if (correct) {
        scoreRef.current += 1;
        playCorrect();
        if (scoreRef.current % 4 === 0) {
          stageRef.current = Math.min(5, stageRef.current + 1);
          maxStageRef.current = Math.max(maxStageRef.current, stageRef.current);
        }
      } else {
        livesRef.current -= 1;
        playWrong();
      }
    },
    []
  );

  const tick = useCallback(
    (now: number) => {
      if (!runningRef.current) return;

      // 자세 인식 → 코 x
      const video = videoRef.current;
      const pose = poseRef.current;
      if (video && pose && video.readyState >= 2 && video.videoWidth > 0) {
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          try {
            const res = pose.detectForVideo(video, now);
            const nose = res.landmarks?.[0]?.[0];
            if (nose) {
              detectedRef.current = true;
              noseXRef.current = 1 - nose.x; // 거울 모드
            } else {
              detectedRef.current = false;
            }
          } catch {
            // 무시
          }
        }
      }
      const dispX = noseXRef.current;
      const zone: Side =
        dispX < LEFT_ZONE ? "left" : dispX > RIGHT_ZONE ? "right" : "center";
      leanRef.current = zone;

      const phaseNow = roundPhaseRef.current;
      let timeLeft = 0;

      if (phaseNow === "countdown") {
        const e = (now - roundStartRef.current) / 1000;
        if (e >= 1.65) {
          roundPhaseRef.current = "answer";
          answerStartRef.current = now;
          holdZoneRef.current = "center";
          holdStartRef.current = now;
        }
      } else if (phaseNow === "answer") {
        const dur = stageTime(stageRef.current);
        const e = (now - answerStartRef.current) / 1000;
        timeLeft = Math.max(0, dur - e);

        if (e > GRACE_SEC) {
          if (zone !== holdZoneRef.current) {
            holdZoneRef.current = zone;
            holdStartRef.current = now;
          }
          const held = (now - holdStartRef.current) / 1000;
          // 좌/우는 0.5초 유지 시 즉시 확정
          if ((zone === "left" || zone === "right") && held >= HOLD_SEC) {
            judge(zone, now);
          } else if (timeLeft <= 0) {
            // 시간 종료: 가운데 충분히 머물렀으면 center, 아니면 현재 zone
            const chosen =
              holdZoneRef.current === "center" && held >= HOLD_SEC
                ? "center"
                : zone;
            judge(chosen, now);
          }
        } else if (timeLeft <= 0) {
          judge(zone, now);
        }
      } else if (phaseNow === "judge") {
        const e = (now - judgeStartRef.current) / 1000;
        if (e >= 1.0) {
          if (livesRef.current <= 0) {
            endGame();
            return;
          }
          startRound(now);
        }
      }

      drawMini();

      // HUD 갱신 (바뀔 때만)
      const count =
        phaseNow === "countdown"
          ? Math.max(1, 3 - Math.floor((now - roundStartRef.current) / 1000 / 0.55))
          : 0;
      const tlRound = Math.ceil(timeLeft * 10) / 10;
      const key = `${livesRef.current}|${scoreRef.current}|${stageRef.current}|${phaseNow}|${count}|${zone}|${tlRound}|${detectedRef.current}`;
      if (key !== viewCacheRef.current) {
        viewCacheRef.current = key;
        setView({
          lives: livesRef.current,
          score: scoreRef.current,
          stage: stageRef.current,
          roundPhase: phaseNow,
          count,
          lean: zone,
          timeLeft: tlRound,
          detected: detectedRef.current,
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [drawMini, endGame, judge, startRound]
  );

  // 준비
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
    livesRef.current = MAX_LIVES;
    scoreRef.current = 0;
    stageRef.current = startStageRef.current;
    maxStageRef.current = startStageRef.current;
    viewCacheRef.current = "";
    // 디버그 카운터 리셋
    roundNumRef.current = 0;
    leftCountRef.current = 0;
    rightCountRef.current = 0;
    centerCountRef.current = 0;
    setDebugStats({ round: 0, left: 0, right: 0, center: 0, currentSide: "-" });
    runningRef.current = true;
    setPhase("playing");
    startRound(performance.now());
    rafRef.current = requestAnimationFrame(tick);
  }, [startRound, tick]);

  // 디버그: 자동 시뮬레이션 (실제 게임 없이 출제만)
  const runSimulation = useCallback((rounds: number) => {
    const stats = simulateAnswerDistribution(startStage, rounds);
    console.group(`[분수] ${rounds}라운드 시뮬레이션 — stage ${startStage}`);
    stats.pairs.forEach((p, i) => {
      console.log(
        `R${i + 1}: L=${fracValue(p.left).toFixed(3)} R=${fracValue(p.right).toFixed(3)} → correctSide=${p.answer}`
      );
    });
    const total = stats.left + stats.right;
    const lp = total > 0 ? ((stats.left / total) * 100).toFixed(1) : "0";
    const rp = total > 0 ? ((stats.right / total) * 100).toFixed(1) : "0";
    console.log(
      `결과: 왼쪽=${stats.left}, 오른쪽=${stats.right}, 가운데=${stats.center} | L/R 비율 ${lp}% / ${rp}% (50:50에 가까워야 정상)`
    );
    console.groupEnd();
    alert(
      `${rounds}라운드 시뮬레이션 결과 (콘솔에 상세):\n왼쪽 정답 ${stats.left}회 / 오른쪽 정답 ${stats.right}회 / 가운데 ${stats.center}회\nL:R = ${lp}% : ${rp}%`
    );
  }, [startStage]);

  const handleStart = useCallback(async () => {
    startStageRef.current = startStage;
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
  }, [startStage, ensurePose, startCamera, beginGame]);

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

  // 카드 강조 클래스
  const cardClass = (side: "left" | "right") => {
    let cls =
      "flex flex-1 flex-col items-center justify-center rounded-card bg-white p-6 text-navy shadow-card transition ";
    if (flash) {
      if (flash.answer === side) cls += " ring-4 ring-mint scale-105";
      else if (view.lean === side && !flash.correct) cls += " animate-shake";
    } else if (view.roundPhase === "answer" && view.lean === side) {
      cls += " ring-4 ring-brand";
    }
    return cls;
  };

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
                  더 큰 분수 쪽으로 몸을 기울이세요!
                </p>
              </div>
            </div>

            <ul className="mt-6 space-y-1.5 text-sm text-gray-600">
              <li>· 분수 두 개 중 더 큰 쪽으로 몸을 기울이면 정답이에요.</li>
              <li>· 그쪽에 0.5초 머무르면 인정돼요. 생명은 3개(틀리면 -1).</li>
              <li>· 두 분수가 같으면 가운데에 그대로 서 있어요.</li>
              <li>· 맞히면 점점 어려운 단계로 올라가요.</li>
            </ul>

            <p className="mt-6 text-sm font-semibold text-gray-700">시작 단계</p>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setStartStage(s)}
                  className={
                    "rounded-xl border px-2 py-3 text-center transition " +
                    (startStage === s
                      ? "border-brand bg-brand/10 text-brand-dark"
                      : "border-gray-200 text-gray-500 hover:bg-gray-50")
                  }
                >
                  <div className="font-bold">{s}단계</div>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              {startStage}단계: {stageName(startStage)}
            </p>

            <p className="mt-6 rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-500">
              수업용 게임이라 카메라가 필요해요. 온몸이 보이게 1.5~2m 떨어져 서면
              가장 잘 인식돼요. (영상은 저장되지 않아요.)
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

            {/* 디버그 도구: 정답 좌/우 분포 시뮬레이션 */}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-400">디버그 도구</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => runSimulation(20)}
                  className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-200"
                >
                  20라운드 시뮬레이션
                </button>
                <button
                  onClick={() => runSimulation(100)}
                  className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-200"
                >
                  100라운드 시뮬레이션
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                결과는 화면 알림 + 브라우저 콘솔(F12)에 자세히 찍혀요. 50:50에 가깝게 나와야 정상.
              </p>
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
          <p className="text-sm text-gray-400">
            온몸이 보이게 한두 걸음 뒤로 서주세요.
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
          {/* 디버그 패널 (정답 좌/우 누적) */}
          <div className="pointer-events-none fixed left-2 top-2 z-50 rounded-lg bg-black/70 px-3 py-2 font-num text-xs text-white shadow-lg">
            <div className="font-bold">디버그</div>
            <div>
              R{debugStats.round}: <b>{debugStats.currentSide}</b>
            </div>
            <div>
              L:{debugStats.left} R:{debugStats.right} C:{debugStats.center}
            </div>
          </div>

          {/* HUD */}
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-500">
              {view.stage}단계 · {stageName(view.stage)}
            </div>
            <div className="flex items-center gap-4">
              <div className="text-lg">
                {"♥".repeat(view.lives)}
                <span className="text-gray-300">
                  {"♥".repeat(MAX_LIVES - view.lives)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-400">통과</span>{" "}
                <span className="font-num text-xl font-extrabold text-brand">
                  {view.score}
                </span>
              </div>
              <button
                onClick={toggleMute}
                className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-500 transition hover:bg-gray-200"
              >
                {muted ? "🔇" : "🔊"}
              </button>
            </div>
          </div>

          {/* 분수 카드 3분할 */}
          <div className="relative flex items-stretch gap-3">
            <div className={cardClass("left")}>
              <FracView f={pairRef.current.left} big />
            </div>

            <div className="flex w-16 flex-col items-center justify-center">
              <div className="text-2xl font-extrabold text-gray-400">VS</div>
              {view.roundPhase === "countdown" && (
                <div className="mt-2 font-num text-4xl font-extrabold text-brand">
                  {view.count}
                </div>
              )}
              {flash && flash.answer === "center" && (
                <div className="animate-pop-in mt-2 rounded-full bg-mint px-2 py-1 text-xs font-bold text-white">
                  같아요!
                </div>
              )}
            </div>

            <div className={cardClass("right")}>
              <FracView f={pairRef.current.right} big />
            </div>
          </div>

          {/* 라운드 타이머 */}
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-amber-400 transition-[width] duration-100"
              style={{
                width:
                  view.roundPhase === "answer"
                    ? `${(view.timeLeft / stageTime(view.stage)) * 100}%`
                    : "100%",
              }}
            />
          </div>

          {/* 안내 + 미니뷰 */}
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm text-gray-500">
              {flash
                ? flash.correct
                  ? "정답! 🎉"
                  : "아쉬워요. 다음엔 맞힐 수 있어요!"
                : "더 큰 쪽으로 기울이세요!"}
              {!view.detected && (
                <span className="ml-2 text-amber-600">
                  (온몸이 보이게 뒤로 서주세요)
                </span>
              )}
            </p>
            <canvas
              ref={miniRef}
              width={MINI_W}
              height={MINI_H}
              className="w-40 rounded-lg border border-gray-200 shadow-sm sm:w-56"
            />
          </div>
        </main>
      )}

      {phase === "result" && result && (
        <ResultScreen
          game={game}
          score={result.score}
          isNewRecord={result.isNewRecord}
          stats={[{ label: "도달 단계", value: `${result.maxStage}단계` }]}
          onRetry={handleRetry}
        />
      )}
    </>
  );
}
