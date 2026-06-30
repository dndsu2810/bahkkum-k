// 알림장 공지(여러 명·전체 대상 + 마감일) — 강사 작성/삭제, 학생은 본인 활성 공지 조회.
// 활성 = startDate <= 날짜 AND (dueDate='' 또는 날짜 <= dueDate). 스냅샷과 분리 저장.
export interface AlimNotice {
  id: string;
  batch: string;
  studentId: string;
  body: string;
  startDate: string;
  dueDate: string; // '' = 마감 없음
  authorName: string;
  createdAt: number;
}

// 학생 본인 활성 공지(마감일 안 지난 것).
export interface MyAlim { id: string; body: string; startDate: string; dueDate: string; createdAt: number; }

export const alimApi = {
  // 학생 — 본인 화면용 활성 공지.
  mine: (date: string): Promise<MyAlim[]> =>
    fetch(`/api/alim?date=${encodeURIComponent(date)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { notices: [] }))
      .then((j) => ((j as { notices?: MyAlim[] }).notices || []))
      .catch(() => []),
  // 강사 — 그 날짜에 활성인 모든 공지(학생별 행). 프론트에서 batch로 묶어 표시.
  list: (date: string): Promise<AlimNotice[]> =>
    fetch(`/api/alim?date=${encodeURIComponent(date)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { notices: [] }))
      .then((j) => ((j as { notices?: AlimNotice[] }).notices || []))
      .catch(() => []),
  create: async (p: { studentIds: string[]; body: string; startDate: string; dueDate: string }): Promise<{ batch: string; count: number }> => {
    const r = await fetch("/api/alim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    });
    if (!r.ok) throw new Error("create_failed");
    return r.json();
  },
  remove: async (p: { batch?: string; id?: string }): Promise<void> => {
    const r = await fetch("/api/alim", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    });
    if (!r.ok) throw new Error("delete_failed");
  },
};
