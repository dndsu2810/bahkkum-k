"use client";

import Link from "next/link";
import type { Game } from "@/lib/games";

// 뱃지 색상: 학년=파랑, 단원=초록, 신작=핑크, 인기=노랑 (기획서)
function badgeClass(label: string): string {
  if (label === "신작") return "bg-pink-100 text-pink-600";
  if (label === "인기") return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700"; // 단원
}

export default function GameCard({
  game,
  bestLabel,
}: {
  game: Game;
  bestLabel?: string;
}) {
  const cardClass =
    "card-lift group flex flex-col overflow-hidden rounded-card bg-white shadow-card hover:shadow-card-hover";

  const inner = (
    <>
      {/* 썸네일 자리 — 실제 이미지는 나중에. 지금은 그라데이션 + 이모지 */}
      <div
        className={`relative flex aspect-video items-center justify-center bg-gradient-to-br ${game.gradient}`}
      >
        <span className="text-5xl drop-shadow-sm">{game.emoji}</span>
        {game.tags.includes("신작") && (
          <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-xs font-bold text-pink-600">
            NEW
          </span>
        )}
        {game.external && (
          <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-xs font-bold text-gray-500">
            새 탭 ↗
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-lg font-bold text-navy">{game.name}</h3>
        <p className="mt-0.5 text-sm text-gray-500">{game.shortDesc}</p>

        {/* 뱃지 영역 */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {game.grades.map((g) => (
            <span
              key={g}
              className="rounded-md bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700"
            >
              {g}
            </span>
          ))}
          {game.units.map((u) => (
            <span
              key={u}
              className={`rounded-md px-2 py-0.5 text-xs font-semibold ${badgeClass(u)}`}
            >
              {u}
            </span>
          ))}
        </div>

        {/* 본인 최고 기록 (있을 때만) */}
        {bestLabel && (
          <p className="mt-3 text-sm font-semibold text-gray-600">
            🏆 나의 최고: {bestLabel}
          </p>
        )}

        {/* 버튼 — 카드 호버 시 강조 */}
        <div className="mt-4 flex items-center justify-end">
          <span className="inline-flex items-center gap-1 rounded-xl bg-gray-100 px-4 py-2 text-sm font-bold text-gray-500 transition group-hover:bg-brand group-hover:text-white">
            {game.external ? "열기 ↗" : "플레이 ▶"}
          </span>
        </div>
      </div>
    </>
  );

  // 외부 게임은 새 탭으로, 내부 게임은 Next 라우팅으로
  if (game.external) {
    return (
      <a
        href={game.route}
        target="_blank"
        rel="noopener noreferrer"
        className={cardClass}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link href={game.route} className={cardClass}>
      {inner}
    </Link>
  );
}
