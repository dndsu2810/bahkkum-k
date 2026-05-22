"use client";

import Link from "next/link";
import { games, type Game } from "@/lib/games";
import { formatScore } from "@/lib/records";

type ResultScreenProps = {
  game: Game;
  score: number;
  isNewRecord: boolean;
  stats?: { label: string; value: string }[];
  note?: string; // 학습 피드백 (예: "이번엔 3, 6, 9를 자주 놓쳤어요")
  onRetry: () => void;
};

// 게임 종료 시 모든 게임이 함께 쓰는 공통 결과 화면.
export default function ResultScreen({
  game,
  score,
  isNewRecord,
  stats,
  note,
  onRetry,
}: ResultScreenProps) {
  // 다른 게임 추천 (현재 게임 제외, 2~3개)
  const recommended = games.filter((g) => g.id !== game.id).slice(0, 3);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-light/30 to-gray-50 px-4 py-10">
      <div className="w-full max-w-md rounded-card bg-white p-8 text-center shadow-card-hover">
        {/* 신기록 축하 */}
        {isNewRecord && (
          <div className="mb-3 flex justify-center gap-1 text-3xl">
            <span className="animate-bounce">🎉</span>
            <span className="animate-bounce [animation-delay:120ms]">✨</span>
            <span className="animate-bounce [animation-delay:240ms]">🎉</span>
          </div>
        )}

        <p className="text-sm font-semibold text-gray-400">{game.name}</p>

        {isNewRecord && (
          <p className="mt-1 text-sm font-bold text-amber-500">새 기록 달성!</p>
        )}

        {/* 점수 */}
        <div className="mt-3 font-num text-5xl font-extrabold text-brand">
          {formatScore(game.scoreType, score)}
        </div>

        {/* 통계 (게임별) */}
        {stats && stats.length > 0 && (
          <div className="mt-5 flex justify-center gap-6">
            {stats.map((s) => (
              <div key={s.label}>
                <div className="text-lg font-bold text-navy">{s.value}</div>
                <div className="text-xs text-gray-400">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* 학습 피드백 */}
        {note && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
            {note}
          </p>
        )}

        {/* 버튼 3개 */}
        <div className="mt-7 space-y-2">
          <button
            onClick={onRetry}
            className="w-full rounded-xl bg-brand py-3 font-bold text-white transition hover:bg-brand-dark"
          >
            다시 도전
          </button>
          <Link
            href="/"
            className="block w-full rounded-xl border border-gray-200 py-3 font-semibold text-gray-600 transition hover:bg-gray-50"
          >
            허브로
          </Link>
        </div>

        {/* 다른 게임 추천 */}
        {recommended.length > 0 && (
          <div className="mt-7 border-t border-gray-100 pt-5 text-left">
            <p className="mb-2 text-sm font-semibold text-gray-500">
              이런 게임은 어때요?
            </p>
            <div className="flex flex-col gap-2">
              {recommended.map((g) => (
                <Link
                  key={g.id}
                  href={g.route}
                  className="flex items-center gap-3 rounded-xl bg-gray-50 p-2 transition hover:bg-gray-100"
                >
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${g.gradient} text-xl`}
                  >
                    {g.emoji}
                  </span>
                  <div>
                    <div className="text-sm font-bold text-navy">{g.name}</div>
                    <div className="text-xs text-gray-400">{g.shortDesc}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
