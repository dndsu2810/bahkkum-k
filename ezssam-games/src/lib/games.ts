// 게임 메타데이터. 새 게임 추가 = 이 JSON에 한 줄 + 라우트 폴더 하나 (기획서 확장성).
import gamesData from "@/data/games.json";

export type Game = {
  id: string;
  name: string;
  shortDesc: string;
  grades: string[];
  units: string[];
  scoreType: string;
  emoji: string;
  gradient: string;
  route: string;
  tags: string[];
};

export const games: Game[] = gamesData as Game[];

export function getGame(id: string): Game | undefined {
  return games.find((g) => g.id === id);
}
