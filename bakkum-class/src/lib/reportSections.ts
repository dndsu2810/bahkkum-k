// 월말리포트 섹션 순서 설정 (localStorage).
export type SectionKey = "summary" | "comment" | "progress" | "attendance" | "evals" | "homework";

export const SECTION_LABELS: Record<SectionKey, string> = {
  summary: "이달의 학습 요약",
  comment: "선생님 종합 코멘트",
  progress: "진도 달성 현황",
  attendance: "월간 출결 현황",
  evals: "평가 결과 상세",
  homework: "숙제 및 수행 기록",
};

export const DEFAULT_ORDER: SectionKey[] = ["summary", "comment", "progress", "attendance", "evals", "homework"];

const KEY = "bk_reportsections";
let cache: SectionKey[] = read();

function read(): SectionKey[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const a = JSON.parse(raw) as SectionKey[];
      // 누락된 키는 뒤에 보강, 알 수 없는 키 제거
      const valid = a.filter((k) => DEFAULT_ORDER.includes(k));
      const merged = [...valid, ...DEFAULT_ORDER.filter((k) => !valid.includes(k))];
      if (merged.length) return merged;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_ORDER;
}

export function getReportOrder(): SectionKey[] {
  return cache;
}
export function setReportOrder(order: SectionKey[]): void {
  cache = order.length ? order : DEFAULT_ORDER;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}
