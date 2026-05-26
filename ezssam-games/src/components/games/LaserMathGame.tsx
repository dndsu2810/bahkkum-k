"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { Game } from "@/lib/games";
import { saveGameResult } from "@/lib/records";
import {
  playCorrect,
  playWrong,
  playCombo,
  playBeep,
  setMuted as setSoundMuted,
} from "@/lib/sound";
import ResultScreen from "@/components/ResultScreen";
import {
  generateProblem,
  recognizeStrokes,
  type Candidate,
  type Point,
  type Problem,
  type Stroke,
} from "@/lib/laser";
import { isPinching, type HandLM } from "@/lib/hands";

// ── 상수 ──────────────────────────────────────────────
const CW = 960;
const CH = 540;
const TRAIL_LIFE_MS = 1000; // 손끝 잔상 1초
const IDLE_AUTO_SUBMIT_SEC = 1.4; // 손가락 1.4초 멈춤 → 자동 인식 (좀 더 빠르게)
const PICK_HOLD_SEC = 0.7; // 후보 위 손가락 0.7초 머무름 → 선택 확정
const GAME_SECONDS = 60;
const MIN_STROKE_POINTS = 4;
const SIGNIFICANT_MOVE_PX = 2.5; // 작은 움직임도 잡도록 더 민감하게
const FAST_BONUS_SEC = 5; // 5초 안에 풀면 +5 보너스
const FINGER_LOST_MS = 700; // 손가락 일시 끊겨도 stroke 안 끊기게 (인식 불안정 대비)

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const LASER_COLOR = "#FFFFFF";
const LASER_GLOW = "#5DADE2";

type Phase = "intro" | "setup" | "playing" | "result" | "error";

type TimedPoint = { x: number; y: number; t: number };

type CandidateRect = {
  cand: Candidate;
  x: number;
  y: number;
  w: number;
  h: number;
};

const RETRY_RECT = { x: CW - 130, y: CH - 110, w: 100, h: 88 };

export default function LaserMathGame({ game }: { game: Game }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);

  // 게임 상태
  const gameStartRef = useRef(0);
  const problemRef = useRef<Problem>(generateProblem());
  const problemStartRef = useRef(0);
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
  const penDownRef = useRef(false); // 핀치 = 펜 다운(그리기), 아니면 펜 업(이동만)

  // 후보 + 호버
  const candidatesRef = useRef<CandidateRect[]>([]);
  const hoverIdxRef = useRef<number>(-1); // 0..2: 후보, 3: 다시(retry), -1: 없음
  const hoverStartRef = useRef<number>(0);

  // 정답 효과
  const flashRef = useRef<{ kind: "correct" | "wrong"; until: number } | null>(
    null
  );

  // UI state
  const [phase, setPhase] = useState<Phase>("intro");
  const [muted, setMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [view, setView] = useState({
    score: 0,
    combo: 0,
    timeLeft: GAME_SECONDS,
    problem: "",
    detected: true,
    hasCandidates: false,
  });
  const [result, setResult] = useState<{
    score: number;
    isNewRecord: boolean;
    passed: number;
    maxCombo: number;
  } | null>(null);
  const viewKeyRef = useRef("");

  // ── 새 문제 시작 ────────────────────────────────────
  const startProblem = useCallback((now: number) => {
    problemRef.current = generateProblem();
    problemStartRef.current = now;
    strokesRef.current = [];
    currentStrokeRef.current = null;
    trailRef.current = [];
    candidatesRef.current = [];
    hoverIdxRef.current = -1;
    hoverStartRef.current = 0;
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

  // ── 인식 시도 → 후보 띄우기 ─────────────────────────
  const triggerRecognize = useCallback(() => {
    // 충분한 점이 있어야 인식 시도
    const totalPts = strokesRef.current.reduce((a, s) => a + s.length, 0);
    if (totalPts < MIN_STROKE_POINTS) return;
    // current stroke가 진행 중이면 닫아서 strokes에 포함
    if (currentStrokeRef.current && currentStrokeRef.current.length >= 2) {
      strokesRef.current.push(currentStrokeRef.current);
      currentStrokeRef.current = null;
    }
    const top3 = recognizeStrokes(strokesRef.current);
    if (top3.length === 0) return;
    // 후보 박스 위치 (화면 아래 가운데 3개 + 오른쪽 '다시')
    const bw = 130;
    const bh = 110;
    const gap = 28;
    const totalW = bw * 3 + gap * 2;
    const startX = (CW - totalW) / 2;
    const y = CH - bh - 30;
    candidatesRef.current = top3.map((c, i) => ({
      cand: c,
      x: startX + i * (bw + gap),
      y,
      w: bw,
      h: bh,
    }));
    hoverIdxRef.current = -1;
    hoverStartRef.current = 0;
    playBeep();
  }, []);

  // ── 후보 선택 확정 (정답/오답 판정) ──────────────────
  const submitAnswer = useCallback(
    (digit: number, now: number) => {
      const correct = digit === problemRef.current.answer;
      if (correct) {
        let gain = 10;
        if (comboRef.current >= 3) gain += 5;
        const dt = (now - problemStartRef.current) / 1000;
        if (dt <= FAST_BONUS_SEC) gain += 5;
        scoreRef.current += gain;
        comboRef.current += 1;
        passedRef.current += 1;
        maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
        if (comboRef.current === 3 || comboRef.current % 5 === 0) playCombo();
        else playCorrect();
        flashRef.current = { kind: "correct", until: now + 500 };
      } else {
        comboRef.current = 0;
        playWrong();
        flashRef.current = { kind: "wrong", until: now + 500 };
      }
      // 새 문제 (잠깐 후)
      setTimeout(() => {
        if (!runningRef.current) return;
        startProblem(performance.now());
      }, 600);
      // 즉시 입력 막기
      candidatesRef.current = [];
      hoverIdxRef.current = -1;
      strokesRef.current = [];
      currentStrokeRef.current = null;
    },
    [startProblem]
  );

  // ── 그리기 캔버스 ───────────────────────────────────
  const draw = useCallback((now: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    // 배경 (거의 검은색 + 별 가루)
    ctx.fillStyle = "#0A0A0F";
    ctx.fillRect(0, 0, CW, CH);
    // 별 (시드 고정으로 일정한 위치)
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    for (let i = 0; i < 50; i++) {
      const sx = ((i * 173) % CW);
      const sy = ((i * 97) % CH);
      ctx.fillRect(sx, sy, 1, 1);
    }

    // 정답/오답 플래시
    if (flashRef.current && now < flashRef.current.until) {
      ctx.fillStyle =
        flashRef.current.kind === "correct"
          ? "rgba(16,185,129,0.22)"
          : "rgba(239,68,68,0.22)";
      ctx.fillRect(0, 0, CW, CH);
    }

    // 그린 stroke들 (희미한 잔상 - 후보가 떠 있을 때는 좀 더 진하게)
    const strokesDimmer = candidatesRef.current.length > 0 ? 0.4 : 0.85;
    ctx.strokeStyle = `rgba(255,255,255,${strokesDimmer})`;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = LASER_GLOW;
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

    // 손끝 잔상 (시간 흐름에 따라 alpha 감소)
    for (let i = 1; i < trailRef.current.length; i++) {
      const a = trailRef.current[i - 1];
      const b = trailRef.current[i];
      const age = now - b.t;
      if (age > TRAIL_LIFE_MS) continue;
      const alpha = 1 - age / TRAIL_LIFE_MS;
      ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.6})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = LASER_GLOW;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 손끝 레이저 점 (펜 다운: 채움+큰 글로우 / 펜 업: 외곽선만)
    if (fingerPosRef.current) {
      const fp = fingerPosRef.current;
      const isDown = penDownRef.current;
      ctx.shadowColor = LASER_GLOW;
      ctx.shadowBlur = isDown ? 30 : 10;
      ctx.fillStyle = isDown ? "rgba(93,173,226,0.5)" : "rgba(93,173,226,0.2)";
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, isDown ? 22 : 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (isDown) {
        ctx.fillStyle = LASER_COLOR;
        ctx.beginPath();
        ctx.arc(fp.x, fp.y, 9, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 펜 업: 빈 원 (외곽선)
        ctx.strokeStyle = LASER_COLOR;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(fp.x, fp.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 인식 임박 표시 (1.6초 카운트다운 링, 후보가 없을 때만)
      if (candidatesRef.current.length === 0) {
        const idle = (now - lastSignificantMoveRef.current) / 1000;
        const totalPts = strokesRef.current.reduce((a, s) => a + s.length, 0);
        if (idle > 0.4 && totalPts >= MIN_STROKE_POINTS) {
          const prog = Math.min(1, idle / IDLE_AUTO_SUBMIT_SEC);
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(fp.x, fp.y, 32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
          ctx.stroke();
        }
      }
    }

    // 문제 (상단)
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "bold 56px Inter, Pretendard, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${problemRef.current.text} = ?`, CW / 2, 60);
    ctx.font = "16px Pretendard, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(
      candidatesRef.current.length > 0
        ? "맞는 숫자에 손가락을 0.7초 머무르세요"
        : penDownRef.current
          ? "✏️ 그리는 중… (엄지+검지 떼면 펜이 떨어져요)"
          : "✋ 이동 중 — 엄지와 검지를 모아 펜을 잡으세요",
      CW / 2,
      100
    );

    // 후보 박스들
    if (candidatesRef.current.length > 0) {
      candidatesRef.current.forEach((r, i) => {
        const hovered = hoverIdxRef.current === i;
        const prog = hovered
          ? Math.min(1, (now - hoverStartRef.current) / 1000 / PICK_HOLD_SEC)
          : 0;
        // box
        ctx.fillStyle = hovered ? "rgba(93,173,226,0.25)" : "rgba(255,255,255,0.08)";
        ctx.strokeStyle = hovered ? "#5DADE2" : "rgba(255,255,255,0.4)";
        ctx.lineWidth = 3;
        const radius = 16;
        roundRect(ctx, r.x, r.y, r.w, r.h, radius);
        ctx.fill();
        ctx.stroke();
        // digit
        ctx.fillStyle = "#fff";
        ctx.font = "bold 56px Inter, Pretendard, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(r.cand.digit), r.x + r.w / 2, r.y + r.h / 2 - 6);
        // conf
        ctx.font = "12px Inter, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillText(
          `${Math.round(r.cand.conf * 100)}%`,
          r.x + r.w / 2,
          r.y + r.h - 16
        );
        // hover progress ring
        if (prog > 0) {
          ctx.strokeStyle = "#10B981";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(
            r.x + r.w / 2,
            r.y + r.h / 2,
            r.w / 2 - 4,
            -Math.PI / 2,
            -Math.PI / 2 + Math.PI * 2 * prog
          );
          ctx.stroke();
        }
      });

      // 다시(✗) 버튼
      const rh = hoverIdxRef.current === 3;
      const rp = rh
        ? Math.min(1, (now - hoverStartRef.current) / 1000 / PICK_HOLD_SEC)
        : 0;
      ctx.fillStyle = rh ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.05)";
      ctx.strokeStyle = rh ? "#EF4444" : "rgba(255,255,255,0.3)";
      ctx.lineWidth = 3;
      roundRect(ctx, RETRY_RECT.x, RETRY_RECT.y, RETRY_RECT.w, RETRY_RECT.h, 14);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 32px Inter, Pretendard, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("다시", RETRY_RECT.x + RETRY_RECT.w / 2, RETRY_RECT.y + RETRY_RECT.h / 2);
      if (rp > 0) {
        ctx.strokeStyle = "#EF4444";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(
          RETRY_RECT.x + RETRY_RECT.w / 2,
          RETRY_RECT.y + RETRY_RECT.h / 2,
          RETRY_RECT.w / 2 - 4,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * rp
        );
        ctx.stroke();
      }
    }
  }, []);

  // ── 메인 루프 ───────────────────────────────────────
  const tick = useCallback(
    (now: number) => {
      if (!runningRef.current) return;
      const survival = (now - gameStartRef.current) / 1000;
      const timeLeft = Math.max(0, GAME_SECONDS - survival);

      // 손 인식 + 핀치 상태
      const video = videoRef.current;
      const lm = landmarkerRef.current;
      let fingerNow: { x: number; y: number } | null = null;
      if (video && lm && video.readyState >= 2 && video.videoWidth > 0) {
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          try {
            const res = lm.detectForVideo(video, now);
            const hand = res.landmarks?.[0];
            if (hand && hand[8]) {
              fingerNow = { x: (1 - hand[8].x) * CW, y: hand[8].y * CH };
              penDownRef.current = isPinching(hand as HandLM[]);
            } else {
              penDownRef.current = false;
            }
          } catch {
            // 무시
          }
        } else if (fingerPosRef.current) {
          fingerNow = fingerPosRef.current;
        }
      }

      // 손끝 처리
      if (fingerNow) {
        const prev = fingerPosRef.current;
        fingerPosRef.current = fingerNow;
        lastFingerSeenRef.current = now;
        // 잔상은 펜 다운일 때만 (이동 중일 땐 안 남기기)
        if (penDownRef.current && candidatesRef.current.length === 0)
          trailRef.current.push({ x: fingerNow.x, y: fingerNow.y, t: now });

        // 후보가 떠 있으면 호버 처리 (그리기 안 함, 핀치 불필요)
        if (candidatesRef.current.length > 0) {
          let hit = -1;
          candidatesRef.current.forEach((r, i) => {
            if (
              fingerNow!.x >= r.x &&
              fingerNow!.x <= r.x + r.w &&
              fingerNow!.y >= r.y &&
              fingerNow!.y <= r.y + r.h
            )
              hit = i;
          });
          // 다시 버튼 영역
          if (
            hit === -1 &&
            fingerNow.x >= RETRY_RECT.x &&
            fingerNow.x <= RETRY_RECT.x + RETRY_RECT.w &&
            fingerNow.y >= RETRY_RECT.y &&
            fingerNow.y <= RETRY_RECT.y + RETRY_RECT.h
          )
            hit = 3;

          if (hit !== hoverIdxRef.current) {
            hoverIdxRef.current = hit;
            hoverStartRef.current = now;
          } else if (hit !== -1) {
            const held = (now - hoverStartRef.current) / 1000;
            if (held >= PICK_HOLD_SEC) {
              if (hit === 3) {
                // 다시
                candidatesRef.current = [];
                strokesRef.current = [];
                currentStrokeRef.current = null;
                hoverIdxRef.current = -1;
                lastSignificantMoveRef.current = now;
                playBeep();
              } else {
                submitAnswer(candidatesRef.current[hit].cand.digit, now);
              }
            }
          }
        } else {
          // 그리기 모드 (핀치할 때만 그림)
          if (penDownRef.current) {
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
          } else {
            // 펜 업: 현재 stroke 종료 → 다음 핀치 때 새 stroke 시작
            if (
              currentStrokeRef.current &&
              currentStrokeRef.current.length >= 2
            ) {
              strokesRef.current.push(currentStrokeRef.current);
            }
            currentStrokeRef.current = null;
          }
          // 멈춤 누적 → 자동 인식 (펜 업 + 충분한 점 있으면 카운트다운)
          const totalPts =
            strokesRef.current.reduce((a, s) => a + s.length, 0) +
            (currentStrokeRef.current?.length ?? 0);
          if (
            totalPts >= MIN_STROKE_POINTS &&
            (now - lastSignificantMoveRef.current) / 1000 >=
              IDLE_AUTO_SUBMIT_SEC
          ) {
            triggerRecognize();
          }
        }
      } else {
        // 손 안 보임: 일정 시간 후 현재 stroke 종료
        if (now - lastFingerSeenRef.current > FINGER_LOST_MS) {
          if (
            currentStrokeRef.current &&
            currentStrokeRef.current.length >= 2
          ) {
            strokesRef.current.push(currentStrokeRef.current);
          }
          currentStrokeRef.current = null;
          fingerPosRef.current = null;
        }
      }

      // 잔상 만료된 점 정리
      while (
        trailRef.current.length > 0 &&
        now - trailRef.current[0].t > TRAIL_LIFE_MS
      )
        trailRef.current.shift();

      draw(now);

      // HUD 갱신 (값 바뀔 때만)
      const tFloor = Math.ceil(timeLeft);
      const detected = !!fingerNow;
      const hasC = candidatesRef.current.length > 0;
      const key = `${scoreRef.current}|${comboRef.current}|${tFloor}|${problemRef.current.text}|${detected}|${hasC}`;
      if (key !== viewKeyRef.current) {
        viewKeyRef.current = key;
        setView({
          score: scoreRef.current,
          combo: comboRef.current,
          timeLeft: tFloor,
          problem: problemRef.current.text,
          detected,
          hasCandidates: hasC,
        });
      }

      if (timeLeft <= 0) {
        endGame();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [draw, endGame, submitAnswer, triggerRecognize]
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
    startProblem(now);
    rafRef.current = requestAnimationFrame(tick);
  }, [startProblem, tick]);

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

  // ── 렌더 ───────────────────────────────────────────
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
                  공중에 손가락으로 숫자를 그려 답을 맞춰요
                </p>
              </div>
            </div>

            <ul className="mt-6 space-y-1.5 text-sm text-gray-600">
              <li>· 60초 동안 한 자리 답 문제를 풀어요 (구구단·나눗셈)</li>
              <li>
                · <b>엄지 + 검지를 모아 펜을 잡듯</b> 공중에 답을 그려요.
                떼면 펜이 떨어져 이동만 돼요.
              </li>
              <li>· 1.4초 멈추면 자동 인식 → 후보 3개 중 맞는 걸 손가락으로 고르기</li>
              <li>· 정답 +10점, 콤보 3+면 +5, 5초 안 풀면 +5 보너스</li>
            </ul>

            <p className="mt-6 rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-500">
              카메라가 필요해요. 손이 잘 보이게 카메라 앞에 앉아주세요. (영상은 저장되지 않아요.)
              <br />
              <span className="text-amber-700">
                * 이번 단계는 한 자리 답 + 1인 모드만. 두 자리 답·2인 대결은 다음 단계에 추가됩니다.
              </span>
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
            {view.hasCandidates
              ? "맞는 숫자에 손가락을 0.7초 머무르세요"
              : "공중에 검지로 숫자를 크게 그려보세요"}
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

// roundRect 폴리필 (구형 브라우저 대비)
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === "function") {
    ctx.beginPath();
    (ctx as CanvasRenderingContext2D & {
      roundRect: (x: number, y: number, w: number, h: number, r: number) => void;
    }).roundRect(x, y, w, h, r);
    return;
  }
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
