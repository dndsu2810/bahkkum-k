import type { TestLog } from "../types";

export type ScoreMode = "score" | "max" | "ratio";

export const SCORE_MODES: { key: ScoreMode; label: string; hint: string }[] = [
  { key: "score", label: "점수", hint: "점수 직접 입력" },
  { key: "max", label: "만점", hint: "받은 점수 / 만점 → 환산" },
  { key: "ratio", label: "갯수", hint: "맞힌 갯수 / 총 문항 → 환산" },
];

/** 입력 방식별 최종 환산 점수(0~100). 월말리포트·노션이 쓰는 값. */
export function computeScore(mode: ScoreMode, num: number, den: number): number {
  if (mode === "score") return Math.max(0, Math.min(100, Math.round(num) || 0));
  if (den > 0) return Math.round((num / den) * 100);
  return 0;
}

/** 표시용 — '85점' / '43/50 (86점)' / '17/20문항 (85점)'. */
export function scoreLabel(t: Pick<TestLog, "score" | "scoreMode" | "scoreNum" | "scoreDen">): string {
  const mode = t.scoreMode || "score";
  if (mode === "max" && t.scoreDen) return `${t.scoreNum ?? 0}/${t.scoreDen} · ${t.score}점`;
  if (mode === "ratio" && t.scoreDen) return `${t.scoreNum ?? 0}/${t.scoreDen}문항 · ${t.score}점`;
  return `${t.score}점`;
}
