// 게임 기록 localStorage 헬퍼.
// 모든 게임은 종료 시 saveGameResult()로 결과를 넘긴다 (기획서 공통 인터페이스).
import { recordStudentPlay } from "./student";

export type GameResult = {
  gameId: string;
  score: number;
  metadata?: Record<string, unknown>;
};

export type GameRecord = {
  best_score: number;
  total_plays: number;
  last_played: string;
  history: { score: number; date: string }[];
};

type RecordsMap = Record<string, GameRecord>;

const RECORDS_KEY = "ezssam_records";

export function getRecords(): RecordsMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(RECORDS_KEY);
    return raw ? (JSON.parse(raw) as RecordsMap) : {};
  } catch {
    return {};
  }
}

export function getRecord(gameId: string): GameRecord | null {
  return getRecords()[gameId] ?? null;
}

/** 게임 결과 저장. 최고기록 갱신 여부를 함께 반환. (점수 높을수록 좋음) */
export function saveGameResult(result: GameResult): {
  isNewRecord: boolean;
  record: GameRecord;
} {
  const records = getRecords();
  const prev = records[result.gameId];
  const now = new Date().toISOString();
  const isNewRecord = !prev || result.score > prev.best_score;

  const record: GameRecord = {
    best_score: prev ? Math.max(prev.best_score, result.score) : result.score,
    total_plays: (prev?.total_plays ?? 0) + 1,
    last_played: now,
    history: [{ score: result.score, date: now }, ...(prev?.history ?? [])].slice(
      0,
      20
    ),
  };

  records[result.gameId] = record;
  window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  recordStudentPlay();

  return { isNewRecord, record };
}

/** 점수 표시 형식 (게임별 단위). 예: 240점 / 12라운드 / 23.4초 */
export function formatScore(scoreType: string, score: number): string {
  if (scoreType === "초") return `${score.toFixed(1)}초`;
  if (scoreType === "라운드") return `${score}라운드`;
  return `${score}점`;
}
