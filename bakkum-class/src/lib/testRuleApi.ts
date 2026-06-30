// 반복 시험 예약 규칙(주간test·KTC) — 강사 전용. 규칙대로 TestLog 예약을 프론트가 생성.
export interface TestRule {
  id: string;
  name: string;
  kind: "weekly" | "ktc";
  studentIds: string[];
  active: boolean;
  createdAt: number;
  day: string; // "auto"(학생 등원 수/목) | "월".."일"(고정 요일)
  range: string; // 단원 미리 입력(선택, '' = 직접)
  until: string; // 반복 마감일 YYYY-MM-DD ('' = 계속)
  wom: string; // 주차: "every" | "1".."5"(매월 N번째 주)
}

export const testRuleApi = {
  list: (): Promise<TestRule[]> =>
    fetch("/api/test-rules", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { rules: [] }))
      .then((j) => ((j as { rules?: TestRule[] }).rules || []))
      .catch(() => []),
  save: async (rule: TestRule): Promise<void> => {
    const r = await fetch("/api/test-rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rule) });
    if (!r.ok) throw new Error("save_failed");
  },
  remove: async (id: string): Promise<void> => {
    const r = await fetch("/api/test-rules", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (!r.ok) throw new Error("delete_failed");
  },
};
