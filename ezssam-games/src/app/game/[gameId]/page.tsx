import { notFound } from "next/navigation";
import { getGame, games } from "@/lib/games";
import GameRunner from "@/components/GameRunner";

// 1단계는 게임 자리만 잡아두는 placeholder. 실제 게임은 3~5단계에서 구현.
export function generateStaticParams() {
  // 외부 게임(기존에 만든 게임)은 내부 페이지가 필요 없음 — 카드에서 새 탭으로 열림
  return games.filter((g) => !g.external).map((g) => ({ gameId: g.id }));
}

export default function GamePage({
  params,
}: {
  params: { gameId: string };
}) {
  const game = getGame(params.gameId);
  if (!game) notFound();

  return <GameRunner game={game} />;
}
