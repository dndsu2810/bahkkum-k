"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { Game } from "@/lib/games";
import { saveGameResult } from "@/lib/records";
import { playCorrect, playWrong, playBeep, playCombo, setMuted as setSoundMuted } from "@/lib/sound";

const CW = 960;
const CH = 540;
const CLEAN_SECONDS = 30;
const QUIZ_SECONDS = 12; // 퀴즈 제한 시간
const PICK_HOLD_SEC = 0.4; // 카드 위 호버 시간
const CLEAN_TARGET_PCT = 92; // 두 사람 모두 92% 도달 시 퀴즈 즉시 발동
const WIPE_RADIUS = 75;

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const P1_COLOR = "#06B6D4";
const P2_COLOR = "#EC4899";

type Phase = "intro" | "setup" | "playing" | "result" | "error";
type SubState = "cleaning" | "quiz" | "done";

type HandPos = { x: number; y: number };

type QuizProblem = { text: string; answer: number; choices: number[] };
type ChoiceRect = {
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

// 4지 선다 카드 위치 (가운데 2×2)
const CARD_W = 200;
const CARD_H = 120;
const CARD_GAP_X = 28;
const CARD_GAP_Y = 22;
function makeChoiceRects(values: number[]): ChoiceRect[] {
  const totalW = CARD_W * 2 + CARD_GAP_X;
  const totalH = CARD_H * 2 + CARD_GAP_Y;
  const sx = (CW - totalW) / 2;
  const sy = (CH - totalH) / 2 + 50;
  return [
    { value: values[0], x: sx, y: sy, w: CARD_W, h: CARD_H },
    { value: values[1], x: sx + CARD_W + CARD_GAP_X, y: sy, w: CARD_W, h: CARD_H },
    { value: values[2], x: sx, y: sy + CARD_H + CARD_GAP_Y, w: CARD_W, h: CARD_H },
    {
      value: values[3],
      x: sx + CARD_W + CARD_GAP_X,
      y: sy + CARD_H + CARD_GAP_Y,
      w: CARD_W,
      h: CARD_H,
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

// 곱셈·나눗셈·혼합계산 퀴즈 생성
function generateQuizProblem(): QuizProblem {
  const r = Math.random();
  let text: string;
  let answer: number;
  if (r < 0.32) {
    // 곱셈
    const a = ri(2, 14);
    const b = ri(2, 9);
    text = `${a} × ${b}`;
    answer = a * b;
  } else if (r < 0.62) {
    // 나눗셈
    const b = ri(2, 9);
    const k = ri(2, 11);
    text = `${b * k} ÷ ${b}`;
    answer = k;
  } else {
    // 혼합계산
    const c = Math.floor(Math.random() * 3);
    if (c === 0) {
      const a = ri(2, 20);
      const b = ri(2, 9);
      const cc = ri(2, 9);
      text = `${a} + ${b} × ${cc}`;
      answer = a + b * cc;
    } else if (c === 1) {
      const b = ri(2, 9);
      const k = ri(2, 9);
      const rr = ri(2, 15);
      text = `${b * k} ÷ ${b} + ${rr}`;
      answer = k + rr;
    } else {
      const a = ri(3, 9);
      const b = ri(2, 8);
      const cc = ri(1, a * b - 1);
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

export default function WindowWashGame({ game }: { game: Game }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dirtCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);

  const subStateRef = useRef<SubState>("cleaning");
  const gameStartRef = useRef(0);
  const quizStartRef = useRef(0);
  const doneAtRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const lastSampleRef = useRef(0);

  // 손 위치
  const p1HandsRef = useRef<HandPos[]>([]);
  const p2HandsRef = useRef<HandPos[]>([]);

  // 진행도
  const p1ProgressRef = useRef(0);
  const p2ProgressRef = useRef(0);

  // 퀴즈
  const quizRef = useRef<QuizProblem>(generateQuizProblem());
  const choicesRef = useRef<ChoiceRect[]>(makeChoiceRects(quizRef.current.choices));
  const p1OutRef = useRef(false); // 오답으로 OUT
  const p2OutRef = useRef(false);
  const p1HoverIdxRef = useRef(-1);
  const p1HoverStartRef = useRef(0);
  const p2HoverIdxRef = useRef(-1);
  const p2HoverStartRef = useRef(0);
  const quizWinnerRef = useRef<"p1" | "p2" | null>(null);
  const quizMsgRef = useRef<{ text: string; color: string; until: number } | null>(
    null
  );

  // 이름
  const [p1Name, setP1Name] = useState("1번");
  const [p2Name, setP2Name] = useState("2번");

  const [phase, setPhase] = useState<Phase>("intro");
  const [muted, setMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [view, setView] = useState({
    sub: "cleaning" as SubState,
    timeLeft: CLEAN_SECONDS,
    p1: 0,
    p2: 0,
    quizText: "",
    detected: true,
    p1Out: false,
    p2Out: false,
  });
  const viewKeyRef = useRef("");

  const [result, setResult] = useState<{
    p1: number;
    p2: number;
    winner: string;
    quizText: string;
    quizWinner: string | null; // p1Name | p2Name | null(시간초과)
    score: number;
    isNewRecord: boolean;
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
    ctx.fillStyle = "rgba(120, 90, 60, 0.88)";
    ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = "rgba(70, 50, 30, 0.55)";
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * CW;
      const y = Math.random() * CH;
      const r = 12 + Math.random() * 28;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
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

  // 닦기
  const wipeAt = useCallback((x: number, y: number, halfStart: number, halfEnd: number) => {
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
  }, []);

  // 진행도 샘플링
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

  // ── 퀴즈 전환 ─────────────────────────────────────
  const transitionToQuiz = useCallback((now: number) => {
    sampleProgress();
    subStateRef.current = "quiz";
    quizRef.current = generateQuizProblem();
    choicesRef.current = makeChoiceRects(quizRef.current.choices);
    quizStartRef.current = now;
    p1OutRef.current = false;
    p2OutRef.current = false;
    p1HoverIdxRef.current = -1;
    p2HoverIdxRef.current = -1;
    quizWinnerRef.current = null;
    quizMsgRef.current = null;
    playBeep();
  }, [sampleProgress]);

  // ── 끝내기 ──────────────────────────────────────────
  const endGame = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    const p1 = Math.round(p1ProgressRef.current);
    const p2 = Math.round(p2ProgressRef.current);
    // 우승자: 퀴즈에서 결정된 사람 우선, 없으면 닦은 % 비교
    let winner: string;
    let quizWinnerName: string | null = null;
    if (quizWinnerRef.current === "p1") {
      winner = p1Name;
      quizWinnerName = p1Name;
    } else if (quizWinnerRef.current === "p2") {
      winner = p2Name;
      quizWinnerName = p2Name;
    } else {
      winner = p1 > p2 ? p1Name : p2 > p1 ? p2Name : "무승부";
    }
    const score =
      quizWinnerRef.current !== null
        ? 100 + Math.max(p1, p2)
        : Math.max(p1, p2);
    const { isNewRecord } = saveGameResult({
      gameId: game.id,
      score,
      metadata: {
        p1Name,
        p2Name,
        p1Progress: p1,
        p2Progress: p2,
        quizWinner: quizWinnerName,
        quizText: quizRef.current.text,
      },
    });
    setResult({
      p1,
      p2,
      winner,
      quizText: `${quizRef.current.text} = ${quizRef.current.answer}`,
      quizWinner: quizWinnerName,
      score,
      isNewRecord,
    });
    setPhase("result");
  }, [game.id, p1Name, p2Name]);

  // ── 퀴즈 정답 제출 ──────────────────────────────────
  const quizSubmit = useCallback(
    (who: "p1" | "p2", value: number, now: number) => {
      if (quizWinnerRef.current) return;
      const correct = value === quizRef.current.answer;
      const name = who === "p1" ? p1Name : p2Name;
      if (correct) {
        quizWinnerRef.current = who;
        playCombo();
        quizMsgRef.current = {
          text: `${name} 정답! 🎉`,
          color: who === "p1" ? P1_COLOR : P2_COLOR,
          until: now + 1400,
        };
        doneAtRef.current = now + 1400;
        subStateRef.current = "done";
        return;
      }
      // 오답
      playWrong();
      if (who === "p1") p1OutRef.current = true;
      else p2OutRef.current = true;
      quizMsgRef.current = {
        text: `${name} 오답!`,
        color: "#EF4444",
        until: now + 1000,
      };
      // 둘 다 OUT → 무승부 처리 (퀴즈 승자 없음 → 닦은 % 비교)
      if (p1OutRef.current && p2OutRef.current) {
        doneAtRef.current = now + 1200;
        subStateRef.current = "done";
      }
    },
    [p1Name, p2Name]
  );

  // ── 그리기 ─────────────────────────────────────────
  const drawCleaning = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    const video = videoRef.current;
    const dirt = dirtCanvasRef.current;
    if (!ctx) return;
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

    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.setLineDash([12, 8]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CW / 2, 0);
    ctx.lineTo(CW / 2, CH);
    ctx.stroke();
    ctx.setLineDash([]);

    const drawHand = (h: HandPos, color: string) => {
      ctx.fillStyle = color + "55";
      ctx.beginPath();
      ctx.arc(h.x, h.y, WIPE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(h.x, h.y, WIPE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    };
    for (const h of p1HandsRef.current) drawHand(h, P1_COLOR);
    for (const h of p2HandsRef.current) drawHand(h, P2_COLOR);

    ctx.fillStyle = P1_COLOR;
    ctx.font = "bold 26px Inter, Pretendard, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(p1Name, 20, 16);
    ctx.fillStyle = P2_COLOR;
    ctx.textAlign = "right";
    ctx.fillText(p2Name, CW - 20, 16);
  }, [p1Name, p2Name]);

  const drawQuiz = useCallback((now: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    const video = videoRef.current;
    if (!ctx) return;
    // 배경
    const bg = ctx.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, "#1E1B4B");
    bg.addColorStop(1, "#0F172A");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CW, CH);
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.translate(CW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, CW, CH);
      ctx.restore();
    }
    // 분리선
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.setLineDash([12, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CW / 2, 0);
    ctx.lineTo(CW / 2, CH);
    ctx.stroke();
    ctx.setLineDash([]);

    // 안내 라벨
    ctx.fillStyle = "#FCD34D";
    ctx.font = "bold 22px Inter, Pretendard, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⚡ 수학 퀴즈! 먼저 정답 잡는 사람 승리 ⚡", CW / 2, 36);

    // 문제
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 60px Inter, Pretendard, sans-serif";
    ctx.fillText(`${quizRef.current.text} = ?`, CW / 2, 90);

    // 4개 카드
    choicesRef.current.forEach((r, i) => {
      const p1Hover = p1HoverIdxRef.current === i && !p1OutRef.current;
      const p2Hover = p2HoverIdxRef.current === i && !p2OutRef.current;
      const hovered = p1Hover || p2Hover;
      const ringColor = p1Hover && p2Hover ? "#FCD34D" : p1Hover ? P1_COLOR : p2Hover ? P2_COLOR : "rgba(255,255,255,0.4)";

      ctx.fillStyle = hovered ? "rgba(252,211,77,0.18)" : "rgba(255,255,255,0.10)";
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = hovered ? 5 : 3;
      roundRect(ctx, r.x, r.y, r.w, r.h, 18);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 56px Inter, Pretendard, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(r.value), r.x + r.w / 2, r.y + r.h / 2);

      // 호버 진행 링
      const drawProg = (idx: number | undefined, startMs: number | undefined, color: string) => {
        if (idx !== i || startMs === undefined) return;
        const prog = Math.min(1, (now - startMs) / 1000 / PICK_HOLD_SEC);
        if (prog <= 0) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(
          r.x + r.w / 2,
          r.y + r.h / 2,
          Math.min(r.w, r.h) / 2 - 8,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * prog
        );
        ctx.stroke();
      };
      if (p1Hover) drawProg(p1HoverIdxRef.current, p1HoverStartRef.current, P1_COLOR);
      if (p2Hover) drawProg(p2HoverIdxRef.current, p2HoverStartRef.current, P2_COLOR);
    });

    // 손 커서
    const drawHand = (h: HandPos, color: string, out: boolean) => {
      ctx.fillStyle = (out ? "#6B7280" : color) + "55";
      ctx.beginPath();
      ctx.arc(h.x, h.y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = out ? "#6B7280" : color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 18, 0, Math.PI * 2);
      ctx.stroke();
    };
    for (const h of p1HandsRef.current) drawHand(h, P1_COLOR, p1OutRef.current);
    for (const h of p2HandsRef.current) drawHand(h, P2_COLOR, p2OutRef.current);

    // OUT 라벨
    if (p1OutRef.current) {
      ctx.fillStyle = "#EF4444";
      ctx.font = "bold 24px Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${p1Name} OUT`, 20, CH - 30);
    }
    if (p2OutRef.current) {
      ctx.fillStyle = "#EF4444";
      ctx.font = "bold 24px Inter, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${p2Name} OUT`, CW - 20, CH - 30);
    }

    // 메시지
    const msg = quizMsgRef.current;
    if (msg && now < msg.until) {
      ctx.fillStyle = msg.color;
      ctx.font = "bold 48px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(msg.text, CW / 2, CH - 60);
    }
  }, [p1Name, p2Name]);

  // ── 메인 루프 ───────────────────────────────────────
  const tick = useCallback(
    (now: number) => {
      if (!runningRef.current) return;

      // 손 인식 (공통)
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
              if (dispX < CW / 2) p1.push({ x: dispX, y: dispY });
              else p2.push({ x: dispX, y: dispY });
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

      // 서브 스테이트별 로직
      if (subStateRef.current === "cleaning") {
        // 닦기
        for (const h of p1HandsRef.current) wipeAt(h.x, h.y, 0, CW / 2);
        for (const h of p2HandsRef.current) wipeAt(h.x, h.y, CW / 2, CW);

        // 주기 샘플링
        if (now - lastSampleRef.current > 300) {
          lastSampleRef.current = now;
          sampleProgress();
        }
        drawCleaning();

        // 종료 조건: 30초 OR 두 명 다 92% 도달
        const cleanElapsed = (now - gameStartRef.current) / 1000;
        const bothDone =
          p1ProgressRef.current >= CLEAN_TARGET_PCT &&
          p2ProgressRef.current >= CLEAN_TARGET_PCT;
        if (cleanElapsed >= CLEAN_SECONDS || bothDone) {
          transitionToQuiz(now);
        }
      } else if (subStateRef.current === "quiz") {
        // 호버 처리 (사람별)
        const checkHover = (
          hands: HandPos[],
          out: boolean,
          hoverIdxRef: React.MutableRefObject<number>,
          hoverStartRef: React.MutableRefObject<number>,
          who: "p1" | "p2"
        ) => {
          if (out) {
            hoverIdxRef.current = -1;
            return;
          }
          let hit = -1;
          // 어느 손이든 카드 위면 채택
          for (const h of hands) {
            for (let i = 0; i < choicesRef.current.length; i++) {
              const r = choicesRef.current[i];
              if (h.x >= r.x && h.x <= r.x + r.w && h.y >= r.y && h.y <= r.y + r.h) {
                hit = i;
                break;
              }
            }
            if (hit !== -1) break;
          }
          if (hit !== hoverIdxRef.current) {
            hoverIdxRef.current = hit;
            hoverStartRef.current = now;
          } else if (hit !== -1) {
            const held = (now - hoverStartRef.current) / 1000;
            if (held >= PICK_HOLD_SEC) {
              const val = choicesRef.current[hit].value;
              hoverIdxRef.current = -1; // 한 번 제출 후 초기화
              quizSubmit(who, val, now);
            }
          }
        };
        checkHover(p1HandsRef.current, p1OutRef.current, p1HoverIdxRef, p1HoverStartRef, "p1");
        checkHover(p2HandsRef.current, p2OutRef.current, p2HoverIdxRef, p2HoverStartRef, "p2");

        drawQuiz(now);

        // 시간 초과 → 종료
        const quizElapsed = (now - quizStartRef.current) / 1000;
        if (quizElapsed >= QUIZ_SECONDS && !quizWinnerRef.current) {
          // 무승부 (퀴즈 승자 없음)
          doneAtRef.current = now + 600;
          subStateRef.current = "done";
        }
      } else {
        // done — 잠깐 결과 보여주고 endGame
        drawQuiz(now);
        if (now >= doneAtRef.current) {
          endGame();
          return;
        }
      }

      // HUD 갱신
      const sub = subStateRef.current;
      const tLeft =
        sub === "cleaning"
          ? Math.max(0, Math.ceil(CLEAN_SECONDS - (now - gameStartRef.current) / 1000))
          : sub === "quiz"
            ? Math.max(0, Math.ceil(QUIZ_SECONDS - (now - quizStartRef.current) / 1000))
            : 0;
      const p1Pct = Math.round(p1ProgressRef.current);
      const p2Pct = Math.round(p2ProgressRef.current);
      const key = `${sub}|${tLeft}|${p1Pct}|${p2Pct}|${detected}|${p1OutRef.current}|${p2OutRef.current}`;
      if (key !== viewKeyRef.current) {
        viewKeyRef.current = key;
        setView({
          sub,
          timeLeft: tLeft,
          p1: p1Pct,
          p2: p2Pct,
          quizText: quizRef.current.text,
          detected,
          p1Out: p1OutRef.current,
          p2Out: p2OutRef.current,
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [drawCleaning, drawQuiz, endGame, quizSubmit, sampleProgress, transitionToQuiz, wipeAt]
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
    p1OutRef.current = false;
    p2OutRef.current = false;
    p1HoverIdxRef.current = -1;
    p2HoverIdxRef.current = -1;
    quizWinnerRef.current = null;
    quizMsgRef.current = null;
    subStateRef.current = "cleaning";
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
                  창문 닦기 → 수학 퀴즈 결승전. 먼저 답 잡는 사람이 승리!
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
              <li>· 1단계 — 30초간 손으로 자기 영역 창문 닦기 (둘 다 92% 닦이면 즉시 다음 단계)</li>
              <li>· 2단계 — 수학 퀴즈! 4지선다 (곱셈·나눗셈·혼합계산)</li>
              <li>· 손가락을 정답 카드에 <b>0.4초</b> 머무르면 선택. <b>먼저 정답</b> 잡으면 승리!</li>
              <li>· 오답 잡으면 <b>OUT</b>, 상대에게 기회 — 둘 다 오답이면 닦은 % 비교</li>
            </ul>

            <p className="mt-6 rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-500">
              둘이 카메라 앞에 나란히 서주세요. 1.5~2m 거리에서 손이 화면에 잘 보이게.
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
                className={
                  "rounded-lg px-3 py-1 text-sm font-bold text-white " +
                  (view.p1Out ? "opacity-40 line-through" : "")
                }
                style={{ background: P1_COLOR }}
              >
                {p1Name} · {view.p1}%
              </div>
              <span className="text-sm text-gray-400">VS</span>
              <div
                className={
                  "rounded-lg px-3 py-1 text-sm font-bold text-white " +
                  (view.p2Out ? "opacity-40 line-through" : "")
                }
                style={{ background: P2_COLOR }}
              >
                {p2Name} · {view.p2}%
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs text-gray-400">
                  {view.sub === "quiz" ? "퀴즈 남은" : "닦기 남은"}
                </div>
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

          {/* 진행도 바: 닦기 단계에서만 */}
          {view.sub === "cleaning" && (
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
          )}

          <div className="overflow-hidden rounded-card shadow-card">
            <canvas
              ref={canvasRef}
              width={CW}
              height={CH}
              className="block w-full"
            />
          </div>

          <p className="mt-3 text-center text-sm text-gray-400">
            {view.sub === "cleaning"
              ? "손을 휘저어 자기 영역을 깨끗하게!"
              : "정답 카드에 손을 0.4초 머무르면 선택!"}
            {!view.detected && (
              <span className="ml-2 text-amber-600">(손이 안 보여요)</span>
            )}
          </p>
        </main>
      )}

      {phase === "result" && result && (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
          <div className="rounded-card bg-white p-8 shadow-card">
            <p className="text-sm text-gray-400">{result.quizText}</p>
            <h2 className="text-2xl font-extrabold text-navy">
              {result.winner === "무승부"
                ? "🤝 무승부!"
                : `🏆 ${result.winner} 우승!`}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {result.quizWinner
                ? `퀴즈 정답: ${result.quizWinner} (먼저 맞춤)`
                : "퀴즈 승자 없음 — 닦은 양으로 결정"}
            </p>
            {result.isNewRecord && (
              <p className="mt-1 text-sm font-bold text-amber-500">기록 신기록!</p>
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
