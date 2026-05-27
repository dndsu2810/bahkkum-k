"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { Game } from "@/lib/games";
import { saveGameResult } from "@/lib/records";
import ResultScreen from "./ResultScreen";

function GameLoading() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-gray-400">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand/30 border-t-brand" />
      게임을 불러오는 중…
    </main>
  );
}

// 실제로 구현된 게임 목록 (없으면 placeholder + 체험 버튼)
const REAL_GAMES: Record<string, ComponentType<{ game: Game }>> = {
  "yaksu-balloon": dynamic(() => import("./games/YaksuBalloonGame"), {
    ssr: false,
    loading: GameLoading,
  }),
  "bunsu-tilt": dynamic(() => import("./games/BunsuTiltGame"), {
    ssr: false,
    loading: GameLoading,
  }),
  "math-pungdeong": dynamic(() => import("./games/MathPungdeongGame"), {
    ssr: false,
    loading: GameLoading,
  }),
  "math-memory": dynamic(() => import("./games/MathMemoryGame"), {
    ssr: false,
    loading: GameLoading,
  }),
  "window-wash": dynamic(() => import("./games/WindowWashGame"), {
    ssr: false,
    loading: GameLoading,
  }),
  "angle-hunter": dynamic(() => import("./games/AngleHunterGame"), {
    ssr: false,
    loading: GameLoading,
  }),
  "shape-draw": dynamic(() => import("./games/ShapeDrawGame"), {
    ssr: false,
    loading: GameLoading,
  }),
  "bomb-pass": dynamic(() => import("./games/BombPassGame"), {
    ssr: false,
    loading: GameLoading,
  }),
};

export default function GameRunner({ game }: { game: Game }) {
  const RealGame = REAL_GAMES[game.id];
  if (RealGame) return <RealGame game={game} />;
  return <PlaceholderGame game={game} />;
}

// 아직 구현 전인 게임: 자리 + 임시 "체험 점수" 버튼 (기록→결과 흐름 확인용)
function PlaceholderGame({ game }: { game: Game }) {
  const [result, setResult] = useState<{
    score: number;
    isNewRecord: boolean;
  } | null>(null);

  const playDemo = () => {
    let score: number;
    if (game.scoreType === "초") {
      score = Math.round((Math.random() * 40 + 5) * 10) / 10; // 5.0~45.0초
    } else if (game.scoreType === "라운드") {
      score = Math.floor(Math.random() * 15) + 1; // 1~15라운드
    } else {
      score = Math.floor(Math.random() * 250) + 10; // 10~260점
    }
    const { isNewRecord } = saveGameResult({
      gameId: game.id,
      score,
      metadata: { demo: true },
    });
    setResult({ score, isNewRecord });
  };

  if (result) {
    return (
      <ResultScreen
        game={game}
        score={result.score}
        isNewRecord={result.isNewRecord}
        onRetry={() => setResult(null)}
      />
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
      <div
        className={`flex h-28 w-28 items-center justify-center rounded-card bg-gradient-to-br ${game.gradient} text-6xl shadow-card`}
      >
        {game.emoji}
      </div>

      <h1 className="mt-6 text-2xl font-extrabold text-navy">{game.name}</h1>
      <p className="mt-2 max-w-sm text-gray-500">{game.shortDesc}</p>

      <div className="mt-6 rounded-xl bg-white px-5 py-4 text-sm text-gray-500 shadow-card">
        이 게임은 곧 만들어질 예정이에요. 지금은 자리만 잡아둔 화면입니다.
      </div>

      {/* 임시 체험 버튼 — 실제 게임 구현 시 제거 */}
      <button
        onClick={playDemo}
        className="mt-6 rounded-xl bg-amber-400 px-6 py-3 font-bold text-white shadow-card transition hover:bg-amber-500"
      >
        🎲 체험: 임시 점수 기록해보기
      </button>
      <p className="mt-2 text-xs text-gray-400">
        (기록 저장 → 결과 화면 흐름을 미리 보기 위한 임시 버튼이에요)
      </p>

      <Link
        href="/"
        className="mt-8 text-sm font-semibold text-gray-500 underline-offset-4 hover:underline"
      >
        ← 허브로 돌아가기
      </Link>
    </main>
  );
}
