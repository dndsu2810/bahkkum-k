"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Game } from "@/lib/games";
import { saveGameResult } from "@/lib/records";
import { playCorrect, playWrong, playCombo, setMuted as setSoundMuted } from "@/lib/sound";
import ResultScreen from "@/components/ResultScreen";
import {
  generatePairs,
  calcMemoryScore,
  LEVELS,
  type MemoryLevel,
} from "@/lib/memory";

type Phase = "intro" | "playing" | "result";

type Card = {
  id: number;
  pairId: number;
  text: string; // 식 또는 숫자
  isEq: boolean;
  matched: boolean;
};

const FLIP_BACK_MS = 900; // 안 맞으면 다시 뒤집히는 시간

export default function MathMemoryGame({ game }: { game: Game }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [level, setLevel] = useState<MemoryLevel>("normal");
  const [muted, setMuted] = useState(false);

  const [cards, setCards] = useState<Card[]>([]);
  const [flipped, setFlipped] = useState<number[]>([]); // 현재 뒤집힌 카드 id들 (매칭 보류)
  const [tries, setTries] = useState(0); // 두 장 뒤집은 횟수
  const [failed, setFailed] = useState(0); // 안 맞은 시도
  const [matchedCount, setMatchedCount] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const comboRef = useRef(0);

  const [result, setResult] = useState<{
    score: number;
    isNewRecord: boolean;
    tries: number;
    failed: number;
    elapsedSec: number;
  } | null>(null);

  // ── 게임 시작 ─────────────────────────────────────
  const startGame = useCallback(() => {
    const cfg = LEVELS[level];
    const pairs = generatePairs(cfg.pairs, level);
    const all: Card[] = [];
    pairs.forEach((p, idx) => {
      all.push({ id: idx * 2, pairId: idx, text: p.eq, isEq: true, matched: false });
      all.push({
        id: idx * 2 + 1,
        pairId: idx,
        text: String(p.ans),
        isEq: false,
        matched: false,
      });
    });
    // 셔플
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    setCards(all);
    setFlipped([]);
    setTries(0);
    setFailed(0);
    setMatchedCount(0);
    setIsLocked(false);
    setElapsedSec(0);
    comboRef.current = 0;
    startTimeRef.current = performance.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSec(
        Math.round(((performance.now() - startTimeRef.current) / 1000) * 10) / 10
      );
    }, 100);
    setPhase("playing");
  }, [level]);

  // ── 게임 종료 ─────────────────────────────────────
  const finishGame = useCallback(
    (finalFailed: number, finalElapsed: number) => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      const cfg = LEVELS[level];
      const score = calcMemoryScore(cfg.pairs, finalFailed, finalElapsed);
      const { isNewRecord } = saveGameResult({
        gameId: game.id,
        score,
        metadata: {
          level,
          pairs: cfg.pairs,
          tries: cfg.pairs + finalFailed,
          failed: finalFailed,
          elapsedSec: finalElapsed,
        },
      });
      setResult({
        score,
        isNewRecord,
        tries: cfg.pairs + finalFailed,
        failed: finalFailed,
        elapsedSec: finalElapsed,
      });
      setPhase("result");
    },
    [game.id, level]
  );

  // ── 카드 클릭 ─────────────────────────────────────
  const onCardClick = (cardId: number) => {
    if (isLocked) return;
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.matched) return;
    if (flipped.includes(cardId)) return; // 이미 뒤집힌 카드
    if (flipped.length >= 2) return;

    const newFlipped = [...flipped, cardId];
    setFlipped(newFlipped);

    if (newFlipped.length === 2) {
      const [aId, bId] = newFlipped;
      const a = cards.find((c) => c.id === aId);
      const b = cards.find((c) => c.id === bId);
      if (!a || !b) return;
      const newTries = tries + 1;
      setTries(newTries);
      if (a.pairId === b.pairId) {
        // 매칭!
        comboRef.current += 1;
        if (comboRef.current >= 3) playCombo();
        else playCorrect();
        setTimeout(() => {
          setCards((cur) =>
            cur.map((c) =>
              c.id === aId || c.id === bId ? { ...c, matched: true } : c
            )
          );
          setFlipped([]);
          const newMatched = matchedCount + 1;
          setMatchedCount(newMatched);
          if (newMatched >= LEVELS[level].pairs) {
            // 모두 맞춤 → 종료
            const elapsed =
              Math.round(((performance.now() - startTimeRef.current) / 1000) * 10) /
              10;
            finishGame(failed, elapsed);
          }
        }, 380);
      } else {
        // 불일치
        comboRef.current = 0;
        playWrong();
        setIsLocked(true);
        setTimeout(() => {
          setFailed((f) => f + 1);
          setFlipped([]);
          setIsLocked(false);
        }, FLIP_BACK_MS);
      }
    }
  };

  // ── 정리 ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const toggleMute = () => {
    setMuted((m) => {
      setSoundMuted(!m);
      return !m;
    });
  };

  const handleRetry = () => {
    setResult(null);
    startGame();
  };

  const cfg = LEVELS[level];

  return (
    <>
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
                  뒤집힌 카드들 중 식과 답이 맞는 짝을 찾아요
                </p>
              </div>
            </div>

            <p className="mt-6 text-sm font-semibold text-gray-700">난이도</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(Object.keys(LEVELS) as MemoryLevel[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setLevel(k)}
                  className={
                    "rounded-xl border px-3 py-3 text-center transition " +
                    (level === k
                      ? "border-brand bg-brand/10 text-brand-dark"
                      : "border-gray-200 text-gray-500 hover:bg-gray-50")
                  }
                >
                  <div className="font-bold">{LEVELS[k].name}</div>
                  <div className="text-xs">{LEVELS[k].desc}</div>
                </button>
              ))}
            </div>

            <ul className="mt-6 space-y-1.5 text-sm text-gray-600">
              <li>· 카드 2장을 뒤집어요. <b>식</b>(예: 3×4)과 <b>답</b>(예: 12)이 맞으면 짝!</li>
              <li>· 짝을 맞춘 카드는 그대로, 안 맞으면 다시 뒤집힘</li>
              <li>· 모든 짝을 다 맞추면 끝 — 실수가 적고 빠를수록 점수 ↑</li>
              <li>· 콤보 3+면 정답 효과음이 더 신나져요</li>
            </ul>

            <div className="mt-6 flex gap-2">
              <Link
                href="/"
                className="rounded-xl border border-gray-200 px-5 py-3 font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                허브로
              </Link>
              <button
                onClick={startGame}
                className="flex-1 rounded-xl bg-brand py-3 text-lg font-bold text-white transition hover:bg-brand-dark"
              >
                시작하기
              </button>
            </div>
          </div>
        </main>
      )}

      {phase === "playing" && (
        <main className="mx-auto max-w-5xl px-3 py-4 sm:py-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-500">
              {cfg.name} · {matchedCount}/{cfg.pairs} 쌍
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-gray-400">시간</div>
                <div className="font-num text-2xl font-extrabold text-brand">
                  {elapsedSec.toFixed(1)}초
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">시도</div>
                <div className="font-num text-2xl font-extrabold text-amber-500">
                  {tries}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">실수</div>
                <div className="font-num text-2xl font-extrabold text-red-400">
                  {failed}
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

          <div
            className="mx-auto grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${cfg.cols}, minmax(0, 1fr))`,
              maxWidth: cfg.cols * 140 + (cfg.cols - 1) * 12,
            }}
          >
            {cards.map((card) => {
              const isUp = card.matched || flipped.includes(card.id);
              const isMatched = card.matched;
              return (
                <button
                  key={card.id}
                  onClick={() => onCardClick(card.id)}
                  disabled={isLocked || isMatched}
                  className={
                    "aspect-square rounded-2xl border-2 text-2xl font-extrabold transition-all duration-200 sm:text-3xl " +
                    (isMatched
                      ? "border-mint bg-mint/15 text-mint"
                      : isUp
                        ? "border-brand bg-white text-navy scale-105 shadow-card-hover"
                        : "border-brand-dark bg-gradient-to-br from-brand to-brand-dark text-white hover:scale-105 shadow-card")
                  }
                >
                  {isUp ? (
                    <span className={card.isEq ? "tracking-tight" : "font-num"}>
                      {card.text}
                    </span>
                  ) : (
                    <span className="opacity-60">?</span>
                  )}
                </button>
              );
            })}
          </div>

          <p className="mt-4 text-center text-sm text-gray-400">
            식 카드와 답 카드가 같은 짝이면 맞아요!
          </p>
        </main>
      )}

      {phase === "result" && result && (
        <ResultScreen
          game={game}
          score={result.score}
          isNewRecord={result.isNewRecord}
          stats={[
            { label: "총 시도", value: `${result.tries}` },
            { label: "실수", value: `${result.failed}` },
            { label: "시간", value: `${result.elapsedSec}초` },
          ]}
          note="모든 짝을 맞췄어요!"
          onRetry={handleRetry}
        />
      )}
    </>
  );
}
