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

const CW = 960;
const CH = 540;
const CLEAN_TARGET_PCT = 85; // 자기 영역 이만큼 닦으면 퀴즈 발동
const PICK_HOLD_SEC = 0.4;
const WIPE_RADIUS = 75;

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const P1_COLOR = "#06B6D4";
const P2_COLOR = "#EC4899";
const HALF = CW / 2;

type Phase = "intro" | "setup" | "playing" | "result" | "error";
type SubState = "cleaning" | "quiz" | "won" | "out";

type HandPos = { x: number; y: number };

type QuizProblem = { text: string; answer: number; choices: number[] };

type ChoiceRect = {
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

function ri(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 곱셈·나눗셈·혼합계산 — 양쪽 비슷한 난이도가 되도록 같은 풀에서 생성
function generateQuizProblem(): QuizProblem {
  const r = Math.random();
  let text: string;
  let answer: number;
  if (r < 0.33) {
    const a = ri(2, 12);
    const b = ri(2, 9);
    text = `${a} × ${b}`;
    answer = a * b;
  } else if (r < 0.66) {
    const b = ri(2, 9);
    const k = ri(2, 11);
    text = `${b * k} ÷ ${b}`;
    answer = k;
  } else {
    const c = ri(0, 2);
    if (c === 0) {
      const a = ri(2, 20);
      const b = ri(2, 9);
      const cc = ri(2, 9);
      text = `${a} + ${b} × ${cc}`;
      answer = a + b * cc;
    } else if (c === 1) {
      const b = ri(2, 9);
      const k = ri(2, 9);
      const rr = ri(2, 12);
      text = `${b * k} ÷ ${b} + ${rr}`;
      answer = k + rr;
    } else {
      const a = ri(3, 9);
      const b = ri(2, 8);
      const cc = ri(1, Math.max(1, a * b - 1));
      text = `${a} × ${b} − ${cc}`;
      answer = a * b - cc;
    }
  }
  const wrongs = new Set<number>();
  let guard = 0;
  while (wrongs.size < 3 && guard++ < 80) {
    const d = (Math.random() < 0.5 ? -1 : 1) * ri(1, 9);
    const w = answer + d;
    if (w < 0 || w === answer || wrongs.has(w)) continue;
    wrongs.add(w);
  }
  while (wrongs.size < 3) wrongs.add(answer + wrongs.size + 1);
  const choices = shuffle([answer, ...Array.from(wrongs)]);
  return { text, answer, choices };
}

function makeHalfCards(
  values: number[],
  halfStart: number,
  halfEnd: number
): ChoiceRect[] {
  const halfW = halfEnd - halfStart;
  const cardW = 168;
  const cardH = 96;
  const gapX = 16;
  const gapY = 16;
  const totalW = cardW * 2 + gapX;
  const totalH = cardH * 2 + gapY;
  const sx = halfStart + (halfW - totalW) / 2;
  const sy = (CH - totalH) / 2 + 40;
  return [
    { value: values[0], x: sx, y: sy, w: cardW, h: cardH },
    {
      value: values[1],
      x: sx + cardW + gapX,
      y: sy,
      w: cardW,
      h: cardH,
    },
    {
      value: values[2],
      x: sx,
      y: sy + cardH + gapY,
      w: cardW,
      h: cardH,
    },
    {
      value: values[3],
      x: sx + cardW + gapX,
      y: sy + cardH + gapY,
      w: cardW,
      h: cardH,
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

type PlayerState = {
  sub: SubState;
  progress: number;
  hands: HandPos[];
  quiz: QuizProblem | null;
  cards: ChoiceRect[];
  hoverIdx: number;
  hoverStart: number;
};

function newPlayerState(): PlayerState {
  return {
    sub: "cleaning",
    progress: 0,
    hands: [],
    quiz: null,
    cards: [],
    hoverIdx: -1,
    hoverStart: 0,
  };
}

export default function WindowWashGame({ game }: { game: Game }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dirtCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);

  const p1Ref = useRef<PlayerState>(newPlayerState());
  const p2Ref = useRef<PlayerState>(newPlayerState());
  const winnerRef = useRef<"p1" | "p2" | null>(null);
  const doneAtRef = useRef(0);
  const gameStartRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const lastSampleRef = useRef(0);

  const [p1Name, setP1Name] = useState("1번");
  const [p2Name, setP2Name] = useState("2번");

  const [phase, setPhase] = useState<Phase>("intro");
  const [muted, setMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [view, setView] = useState({
    p1: 0,
    p2: 0,
    p1Sub: "cleaning" as SubState,
    p2Sub: "cleaning" as SubState,
    detected: true,
  });
  const viewKeyRef = useRef("");

  const [result, setResult] = useState<{
    p1: number;
    p2: number;
    winner: string;
    p1Quiz: string | null;
    p2Quiz: string | null;
    isNewRecord: boolean;
    score: number;
  } | null>(null);

  // ── 더러움 초기화 ─────────────────────────────────
  const initDirtCanvas = useCallback(() => {
    if (!dirtCanvasRef.current) {
      const c = document.createElement("canvas");
      c.width = CW;
      c.height = CH;
      dirtCanvasRef.current = c;
    }
    const ctx = dirtCanvasRef.current.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = "rgba(120, 90, 60, 0.9)";
    ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = "rgba(70, 50, 30, 0.55)";
    for (let i = 0; i < 100; i++) {
      const x = Math.random() * CW;
      const y = Math.random() * CH;
      const r = 12 + Math.random() * 28;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(90, 65, 40, 0.45)";
    ctx.lineWidth = 4;
    for (let i = 0; i < 30; i++) {
      ctx.beginPath();
      const x = Math.random() * CW;
      const y = Math.random() * CH;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 120);
      ctx.stroke();
    }
  }, []);

  const wipeAt = useCallback(
    (x: number, y: number, halfStart: number, halfEnd: number) => {
      const dirt = dirtCanvasRef.current;
      if (!dirt) return;
      const ctx = dirt.getContext("2d");
      if (!ctx) return;
      ctx.save();
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
    },
    []
  );

  const sampleProgress = useCallback(() => {
    const dirt = dirtCanvasRef.current;
    if (!dirt) return;
    const ctx = dirt.getContext("2d");
    if (!ctx) return;
    const STEP = 18;
    try {
      const dataL = ctx.getImageData(0, 0, HALF, CH).data;
      const dataR = ctx.getImageData(HALF, 0, HALF, CH).data;
      let cleanedL = 0;
      let cleanedR = 0;
      let total = 0;
      for (let y = 0; y < CH; y += STEP) {
        for (let x = 0; x < HALF; x += STEP) {
          const i = (y * HALF + x) * 4 + 3;
          total++;
          if (dataL[i] < 60) cleanedL++;
          if (dataR[i] < 60) cleanedR++;
        }
      }
      p1Ref.current.progress = (cleanedL / total) * 100;
      p2Ref.current.progress = (cleanedR / total) * 100;
    } catch {
      // 무시
    }
  }, []);

  // ── 퀴즈 전환 ─────────────────────────────────────
  const goToQuiz = useCallback((player: "p1" | "p2") => {
    const me = player === "p1" ? p1Ref.current : p2Ref.current;
    const other = player === "p1" ? p2Ref.current : p1Ref.current;
    let problem = generateQuizProblem();
    // 상대와 같은 문제면 다시 (희박하지만 대비)
    let guard = 0;
    while (other.quiz && problem.text === other.quiz.text && guard++ < 10) {
      problem = generateQuizProblem();
    }
    me.quiz = problem;
    me.cards =
      player === "p1"
        ? makeHalfCards(problem.choices, 0, HALF)
        : makeHalfCards(problem.choices, HALF, CW);
    me.sub = "quiz";
    me.hoverIdx = -1;
    me.hoverStart = 0;
    playBeep();
  }, []);

  // ── 끝내기 ─────────────────────────────────────────
  const endGame = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    sampleProgress();
    const p1 = Math.round(p1Ref.current.progress);
    const p2 = Math.round(p2Ref.current.progress);
    let winner: string;
    if (winnerRef.current === "p1") winner = p1Name;
    else if (winnerRef.current === "p2") winner = p2Name;
    else winner = p1 > p2 ? p1Name : p2 > p1 ? p2Name : "무승부";
    const score = winnerRef.current !== null ? 200 : Math.max(p1, p2);
    const { isNewRecord } = saveGameResult({
      gameId: game.id,
      score,
      metadata: {
        p1Name,
        p2Name,
        p1Progress: p1,
        p2Progress: p2,
        p1Quiz: p1Ref.current.quiz?.text ?? null,
        p2Quiz: p2Ref.current.quiz?.text ?? null,
        winner: winnerRef.current,
      },
    });
    setResult({
      p1,
      p2,
      winner,
      p1Quiz: p1Ref.current.quiz
        ? `${p1Ref.current.quiz.text} = ${p1Ref.current.quiz.answer}`
        : null,
      p2Quiz: p2Ref.current.quiz
        ? `${p2Ref.current.quiz.text} = ${p2Ref.current.quiz.answer}`
        : null,
      isNewRecord,
      score,
    });
    setPhase("result");
  }, [game.id, p1Name, p2Name, sampleProgress]);

  // ── 퀴즈 제출 ─────────────────────────────────────
  const quizSubmit = useCallback(
    (player: "p1" | "p2", value: number, now: number) => {
      if (winnerRef.current) return;
      const me = player === "p1" ? p1Ref.current : p2Ref.current;
      const other = player === "p1" ? p2Ref.current : p1Ref.current;
      if (me.sub !== "quiz" || !me.quiz) return;
      if (value === me.quiz.answer) {
        me.sub = "won";
        winnerRef.current = player;
        playCombo();
        doneAtRef.current = now + 1500;
      } else {
        me.sub = "out";
        playWrong();
        // 상대도 OUT 이면 게임 종료 — 닦은 양으로 결정
        if (other.sub === "out") {
          doneAtRef.current = now + 1300;
        }
      }
    },
    []
  );

  // ── 그리기 ────────────────────────────────────────
  const draw = useCallback(
    (now: number) => {
      const ctx = canvasRef.current?.getContext("2d");
      const video = videoRef.current;
      const dirt = dirtCanvasRef.current;
      if (!ctx) return;

      // 배경 + 비디오 + 더러움
      ctx.fillStyle = "#0F172A";
      ctx.fillRect(0, 0, CW, CH);
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        ctx.save();
        ctx.translate(CW, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, CW, CH);
        ctx.restore();
      }
      if (dirt) ctx.drawImage(dirt, 0, 0);

      // 분리선 (굵게)
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.setLineDash([14, 10]);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(HALF, 0);
      ctx.lineTo(HALF, CH);
      ctx.stroke();
      ctx.setLineDash([]);

      // 손 커서
      const drawHands = (hands: HandPos[], color: string, dim: boolean) => {
        for (const h of hands) {
          ctx.fillStyle = (dim ? "#6B7280" : color) + "55";
          ctx.beginPath();
          ctx.arc(h.x, h.y, WIPE_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = dim ? "#6B7280" : color;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(h.x, h.y, WIPE_RADIUS, 0, Math.PI * 2);
          ctx.stroke();
        }
      };
      drawHands(
        p1Ref.current.hands,
        P1_COLOR,
        p1Ref.current.sub === "out" || p1Ref.current.sub === "won"
      );
      drawHands(
        p2Ref.current.hands,
        P2_COLOR,
        p2Ref.current.sub === "out" || p2Ref.current.sub === "won"
      );

      // 이름 라벨
      ctx.fillStyle = P1_COLOR;
      ctx.font = "bold 26px Inter, Pretendard, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(p1Name, 20, 16);
      ctx.fillStyle = P2_COLOR;
      ctx.textAlign = "right";
      ctx.fillText(p2Name, CW - 20, 16);

      // 각 영역별 오버레이 (퀴즈 / WON / OUT)
      const drawPlayerOverlay = (
        p: PlayerState,
        halfStart: number,
        halfEnd: number,
        color: string
      ) => {
        if (p.sub === "cleaning") return;
        const halfW = halfEnd - halfStart;
        ctx.save();
        ctx.beginPath();
        ctx.rect(halfStart, 0, halfW, CH);
        ctx.clip();

        if (p.sub === "won") {
          ctx.fillStyle = "rgba(16,185,129,0.4)";
          ctx.fillRect(halfStart, 0, halfW, CH);
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "bold 80px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("✓ 승리!", halfStart + halfW / 2, CH / 2);
        } else if (p.sub === "out") {
          ctx.fillStyle = "rgba(239,68,68,0.45)";
          ctx.fillRect(halfStart, 0, halfW, CH);
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "bold 80px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("✗ 오답", halfStart + halfW / 2, CH / 2);
        } else if (p.sub === "quiz" && p.quiz) {
          // 어둡게 + 문제 + 카드
          ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
          ctx.fillRect(halfStart, 0, halfW, CH);
          // 안내
          ctx.fillStyle = "#FCD34D";
          ctx.font = "bold 18px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            "⚡ 정답을 0.4초 잡으면 승리 ⚡",
            halfStart + halfW / 2,
            54
          );
          // 문제
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "bold 42px Inter, Pretendard, sans-serif";
          ctx.fillText(
            `${p.quiz.text} = ?`,
            halfStart + halfW / 2,
            104
          );
          // 카드
          p.cards.forEach((r, i) => {
            const hovered = p.hoverIdx === i;
            const prog = hovered
              ? Math.min(1, (now - p.hoverStart) / 1000 / PICK_HOLD_SEC)
              : 0;
            ctx.fillStyle = hovered
              ? "rgba(252,211,77,0.25)"
              : "rgba(255,255,255,0.10)";
            ctx.strokeStyle = hovered ? color : "rgba(255,255,255,0.45)";
            ctx.lineWidth = hovered ? 5 : 3;
            roundRect(ctx, r.x, r.y, r.w, r.h, 16);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#FFFFFF";
            ctx.font = "bold 48px Inter, Pretendard, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(r.value), r.x + r.w / 2, r.y + r.h / 2);
            // 호버 진행 링
            if (prog > 0) {
              ctx.strokeStyle = color;
              ctx.lineWidth = 5;
              ctx.beginPath();
              ctx.arc(
                r.x + r.w / 2,
                r.y + r.h / 2,
                Math.min(r.w, r.h) / 2 - 6,
                -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * prog
              );
              ctx.stroke();
            }
          });
        }
        ctx.restore();
      };
      drawPlayerOverlay(p1Ref.current, 0, HALF, P1_COLOR);
      drawPlayerOverlay(p2Ref.current, HALF, CW, P2_COLOR);
    },
    [p1Name, p2Name]
  );

  // ── 루프 ──────────────────────────────────────────
  const tick = useCallback(
    (now: number) => {
      if (!runningRef.current) return;

      // 손 인식
      const video = videoRef.current;
      const lm = landmarkerRef.current;
      let detected = false;
      if (video && lm && video.readyState >= 2 && video.videoWidth > 0) {
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          try {
            const res = lm.detectForVideo(video, now);
            const p1H: HandPos[] = [];
            const p2H: HandPos[] = [];
            for (const hand of res.landmarks) {
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
              const dispX = (1 - sx) * CW;
              const dispY = sy * CH;
              if (dispX < HALF) p1H.push({ x: dispX, y: dispY });
              else p2H.push({ x: dispX, y: dispY });
            }
            p1Ref.current.hands = p1H;
            p2Ref.current.hands = p2H;
            detected = p1H.length + p2H.length > 0;
          } catch {
            // 무시
          }
        } else {
          detected = p1Ref.current.hands.length + p2Ref.current.hands.length > 0;
        }
      }

      // 플레이어별 처리
      const processPlayer = (
        player: "p1" | "p2",
        halfStart: number,
        halfEnd: number
      ) => {
        const me = player === "p1" ? p1Ref.current : p2Ref.current;
        if (me.sub === "cleaning") {
          // 닦기
          for (const h of me.hands) wipeAt(h.x, h.y, halfStart, halfEnd);
          // 진행 임계점 도달 → 퀴즈
          if (me.progress >= CLEAN_TARGET_PCT) goToQuiz(player);
        } else if (me.sub === "quiz") {
          // 호버 체크
          let hit = -1;
          for (const h of me.hands) {
            for (let i = 0; i < me.cards.length; i++) {
              const r = me.cards[i];
              if (
                h.x >= r.x &&
                h.x <= r.x + r.w &&
                h.y >= r.y &&
                h.y <= r.y + r.h
              ) {
                hit = i;
                break;
              }
            }
            if (hit !== -1) break;
          }
          if (hit !== me.hoverIdx) {
            me.hoverIdx = hit;
            me.hoverStart = now;
          } else if (hit !== -1) {
            const held = (now - me.hoverStart) / 1000;
            if (held >= PICK_HOLD_SEC) {
              const v = me.cards[hit].value;
              me.hoverIdx = -1;
              quizSubmit(player, v, now);
            }
          }
        }
      };
      processPlayer("p1", 0, HALF);
      processPlayer("p2", HALF, CW);

      // 진행도 샘플링 (300ms마다)
      if (now - lastSampleRef.current > 300) {
        lastSampleRef.current = now;
        sampleProgress();
      }

      // 종료 체크
      if (doneAtRef.current > 0 && now >= doneAtRef.current) {
        endGame();
        return;
      }

      draw(now);

      // HUD
      const p1Pct = Math.round(p1Ref.current.progress);
      const p2Pct = Math.round(p2Ref.current.progress);
      const key = `${p1Ref.current.sub}|${p2Ref.current.sub}|${p1Pct}|${p2Pct}|${detected}`;
      if (key !== viewKeyRef.current) {
        viewKeyRef.current = key;
        setView({
          p1: p1Pct,
          p2: p2Pct,
          p1Sub: p1Ref.current.sub,
          p2Sub: p2Ref.current.sub,
          detected,
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [draw, endGame, goToQuiz, quizSubmit, sampleProgress, wipeAt]
  );

  // ── 준비 ───────────────────────────────────────────
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
    p1Ref.current = newPlayerState();
    p2Ref.current = newPlayerState();
    winnerRef.current = null;
    doneAtRef.current = 0;
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

  const subLabel = (s: SubState): string => {
    if (s === "cleaning") return "닦는 중";
    if (s === "quiz") return "퀴즈 풀이 중";
    if (s === "won") return "✓ 승리";
    return "✗ 오답 OUT";
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
                  닦기 → 본인 퀴즈 → 먼저 정답 잡는 사람 승리!
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
              <li>· 좌·우 영역이 <b>완전히 분리</b>됨 — 자기 쪽만 닦혀요</li>
              <li>· 자기 영역을 <b>85%</b> 닦으면 그쪽에 <b>본인 퀴즈</b>가 나옴 (먼저 닦은 사람이 먼저 시작!)</li>
              <li>· 좌·우 퀴즈는 <b>비슷한 난이도지만 다른 문제</b> (곱셈·나눗셈·혼합계산)</li>
              <li>· 정답 카드에 손가락 <b>0.4초</b> 머무름 → 선택. <b>먼저 정답 잡는 사람 승리</b>!</li>
              <li>· 오답이면 그 사람 <b>OUT</b>, 상대가 계속 도전. 둘 다 오답이면 닦은 양으로 결정</li>
              <li>· 시간 제한 없음 — 둘 중 한 명이 끝낼 때까지</li>
            </ul>

            <p className="mt-6 rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-500">
              두 명이 카메라 앞에 나란히 서기. 1.5~2m 거리. 손이 잘 보이게.
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
            <div className="flex flex-col gap-1 text-sm">
              <div
                className="rounded-lg px-3 py-1 font-bold text-white"
                style={{ background: P1_COLOR }}
              >
                {p1Name} · {view.p1}% · {subLabel(view.p1Sub)}
              </div>
            </div>
            <span className="text-sm font-bold text-gray-400">VS</span>
            <div className="flex flex-col gap-1 text-sm">
              <div
                className="rounded-lg px-3 py-1 font-bold text-white"
                style={{ background: P2_COLOR }}
              >
                {p2Name} · {view.p2}% · {subLabel(view.p2Sub)}
              </div>
            </div>
            <button
              onClick={toggleMute}
              className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-500 transition hover:bg-gray-200"
            >
              {muted ? "🔇" : "🔊"}
            </button>
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
            손을 휘저어 자기 영역 닦기 → 85%면 퀴즈 등장 → 정답 카드 잡기
            {!view.detected && (
              <span className="ml-2 text-amber-600">(손이 안 보여요)</span>
            )}
          </p>
        </main>
      )}

      {phase === "result" && result && (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
          <div className="rounded-card bg-white p-8 shadow-card">
            <h2 className="text-2xl font-extrabold text-navy">
              {result.winner === "무승부"
                ? "🤝 무승부!"
                : `🏆 ${result.winner} 우승!`}
            </h2>
            {result.isNewRecord && (
              <p className="mt-1 text-sm font-bold text-amber-500">기록 신기록!</p>
            )}

            <div className="mt-5 space-y-3">
              <div
                className="flex flex-col gap-1 rounded-xl border-2 px-4 py-3"
                style={{ borderColor: P1_COLOR }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold" style={{ color: P1_COLOR }}>
                    {p1Name}
                  </span>
                  <span className="font-num text-xl font-extrabold">
                    {result.p1}% 닦음
                  </span>
                </div>
                {result.p1Quiz && (
                  <div className="text-xs text-gray-500">퀴즈: {result.p1Quiz}</div>
                )}
              </div>
              <div
                className="flex flex-col gap-1 rounded-xl border-2 px-4 py-3"
                style={{ borderColor: P2_COLOR }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold" style={{ color: P2_COLOR }}>
                    {p2Name}
                  </span>
                  <span className="font-num text-xl font-extrabold">
                    {result.p2}% 닦음
                  </span>
                </div>
                {result.p2Quiz && (
                  <div className="text-xs text-gray-500">퀴즈: {result.p2Quiz}</div>
                )}
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
