// 알림장(수학 일일 메모) — 학생·날짜별 1건. 강사 작성, 학생 본인 조회. 스냅샷과 분리 저장.
export const classNoteApi = {
  get: (studentId: string, date: string): Promise<string> =>
    fetch(`/api/classnote?student_id=${encodeURIComponent(studentId)}&date=${encodeURIComponent(date)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { memo: "" }))
      .then((j) => String((j as { memo?: string }).memo || ""))
      .catch(() => ""),
  save: async (studentId: string, date: string, memo: string): Promise<void> => {
    const r = await fetch("/api/classnote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentId, date, memo }),
    });
    if (!r.ok) throw new Error("save_failed");
  },
};
