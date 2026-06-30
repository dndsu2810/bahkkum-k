// 학년 = 구분(초/중/고) + 세부학년(N). 저장/표시 형태: "초6", "중2", "고1".
// 구분만 있던 레거시("초등"/"중등"/"고등")도 호환.

export const GRADE_DIVS: { key: "초" | "중" | "고"; label: string; max: number }[] = [
  { key: "초", label: "초등", max: 6 },
  { key: "중", label: "중등", max: 3 },
  { key: "고", label: "고등", max: 3 },
];
export const DIV_MAX: Record<string, number> = { 초: 6, 중: 3, 고: 3 };
/** 세부학년 전체 목록 — 초1..초6, 중1..중3, 고1..고3. 학년 선택 드롭다운용. */
export const GRADE_OPTIONS: string[] = GRADE_DIVS.flatMap((d) => Array.from({ length: d.max }, (_, i) => d.key + (i + 1)));

/** "초6" → {div:"초", n:6}. 레거시 "초등" → {div:"초", n:0}. 못 읽으면 null. */
export function parseGrade(g: string): { div: "초" | "중" | "고"; n: number } | null {
  const s = (g || "").trim();
  const m = /^(초|중|고)\s*(\d+)/.exec(s);
  if (m) return { div: m[1] as "초" | "중" | "고", n: Number(m[2]) };
  if (s.startsWith("초")) return { div: "초", n: 0 };
  if (s.startsWith("중")) return { div: "중", n: 0 };
  if (s.startsWith("고")) return { div: "고", n: 0 };
  return null;
}
/** 수학 반 — 초등 저학년(low)/초등 고학년(high)/중고등(mid). 학년으로 자동 분류하되 직접 지정(override)이 우선.
 *  초1~3 = 저학년, 초4~6 = 고학년(학년 정보 없으면 저학년으로). 중·고 = 중고등. */
export type MathBand = "low" | "high" | "mid";
export function mathBandOf(grade: string, override?: "" | "low" | "high"): MathBand {
  if (override === "low" || override === "high") return override;
  const p = parseGrade(grade);
  if (p?.div === "초") return p.n >= 4 ? "high" : "low";
  return "mid";
}

/** 구분+세부학년 → 저장 문자열. n>0이면 "초6", 아니면 구분 라벨("초등"). */
export function makeGrade(div: string, n: number): string {
  if (!div) return "";
  if (n > 0) return div + n;
  return div === "초" ? "초등" : div === "중" ? "중등" : div === "고" ? "고등" : "";
}
/** 생년월일(YYYY-…)로 그 해 기준 학년 문자열. 초1 = 만 7세(=year-출생년 7). 범위 밖이면 "". */
export function gradeFromBirth(birth: string, year: number): string {
  const m = /^(\d{4})/.exec((birth || "").trim());
  if (!m) return "";
  const g = year - Number(m[1]) - 6; // 초1: year-birth = 7
  if (g < 1 || g > 12) return "";
  if (g <= 6) return "초" + g;
  if (g <= 9) return "중" + (g - 6);
  return "고" + (g - 9);
}
/** 한 단계 진급: 초6→중1, 중3→고1, 고3→"" (졸업 신호). */
export function promoteGrade(g: string): string | null {
  const p = parseGrade(g);
  if (!p || p.n <= 0) return null; // 세부학년 없는 값은 승급 대상 아님
  if (p.div === "초") return p.n < 6 ? "초" + (p.n + 1) : "중1";
  if (p.div === "중") return p.n < 3 ? "중" + (p.n + 1) : "고1";
  if (p.div === "고") return p.n < 3 ? "고" + (p.n + 1) : ""; // 고3 → 졸업
  return null;
}
