// 영어(신규) API — 일일 학습일지 · 진도 · 테스트.

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}
async function jpost(url: string, body: unknown): Promise<{ ok?: boolean; id?: string; error?: string }> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

export interface Goal {
  text: string;
  done: boolean;
}
export type AttStatus = "" | "등원" | "지각" | "결석";
export interface EngDaily {
  studentId: string;
  date: string;
  attended: boolean;
  attStatus: AttStatus;
  lateMin: number; // 지각 분
  absentReason: string; // 결석 사유
  goals: Goal[];
  homework: string;
  hwChecked: boolean;
  comment: string;
  materials: string;
  updatedAt: number;
}
export interface EngProgress {
  id: string;
  studentId: string;
  book: string;
  level: string;
  status: string; // 진행|완료|보류
  startDate: string;
  memo: string;
  updatedAt: number;
}
export interface EngTest {
  id: string;
  studentId: string;
  date: string;
  name: string;
  score: number;
  total: number;
  memo: string;
}

/* 월말리포트 — 8개 항목 등급(기존 영어 성적표 사양 그대로). */
export const ENG_CRITERIA: { key: string; en: string; ko: string }[] = [
  { key: "Listening", en: "Listening", ko: "[듣기]" },
  { key: "Reading", en: "Reading", ko: "[읽기]" },
  { key: "Speaking", en: "Speaking", ko: "[회화·발표]" },
  { key: "Spelling•Writing", en: "Spelling•Writing", ko: "[철자·영작]" },
  { key: "Comprehension", en: "Comprehension", ko: "[이해]" },
  { key: "Learning Attitude", en: "Learning Attitude", ko: "[태도]" },
  { key: "Task Performance", en: "Task Performance", ko: "[수행]" },
  { key: "Confidence", en: "Confidence", ko: "[자신감]" },
];
export const ENG_GRADES: { value: string; full: string }[] = [
  { value: "P", full: "Perfect" },
  { value: "E", full: "Excellent" },
  { value: "GR", full: "Great" },
  { value: "G", full: "Good" },
  { value: "VG", full: "Very Good" },
  { value: "NI", full: "Need Improvement" },
];
export interface EngReport {
  studentId: string;
  month: string; // YYYY-MM
  teacher: string;
  scores: Record<string, string>; // criteria key -> grade value
  comments: string;
  updatedAt: number;
}
export interface EngMakeup {
  id: string;
  studentId: string;
  absentDate: string; // 결석/빠진 날
  makeupDate: string; // 보강 예정일
  makeupTime: string; // 보강 시간
  status: string; // 예정 | 완료 | 취소
  memo: string;
  createdAt: number;
}

export const engApi = {
  reportsByMonth: (month: string) =>
    jget<{ reports: EngReport[] }>("/api/eng/report?month=" + encodeURIComponent(month)).then((j) => j.reports),
  saveReport: (r: { studentId: string; month: string; teacher: string; scores: Record<string, string>; comments: string }) =>
    jpost("/api/eng/report", r),


  dailyByDate: (date: string) => jget<{ daily: EngDaily[] }>("/api/eng/daily?date=" + encodeURIComponent(date)).then((j) => j.daily),
  dailyByStudent: (studentId: string) =>
    jget<{ daily: EngDaily[] }>("/api/eng/daily?student_id=" + encodeURIComponent(studentId)).then((j) => j.daily),
  saveDaily: (d: Partial<EngDaily> & { studentId: string; date: string }) => jpost("/api/eng/daily", d),

  progress: (studentId: string) =>
    jget<{ progress: EngProgress[] }>("/api/eng/progress?student_id=" + encodeURIComponent(studentId)).then((j) => j.progress),
  saveProgress: (p: Partial<EngProgress> & { studentId: string }) => jpost("/api/eng/progress", p),
  removeProgress: (id: string) => jpost("/api/eng/progress/delete", { id }),

  tests: (studentId: string) =>
    jget<{ tests: EngTest[] }>("/api/eng/test?student_id=" + encodeURIComponent(studentId)).then((j) => j.tests),
  saveTest: (t: Partial<EngTest> & { studentId: string }) => jpost("/api/eng/test", t),
  removeTest: (id: string) => jpost("/api/eng/test/delete", { id }),

  makeups: (studentId?: string) =>
    jget<{ makeups: EngMakeup[] }>("/api/eng/makeup" + (studentId ? "?student_id=" + encodeURIComponent(studentId) : "")).then((j) => j.makeups),
  saveMakeup: (mk: Partial<EngMakeup> & { studentId: string }) => jpost("/api/eng/makeup", mk),
  removeMakeup: (id: string) => jpost("/api/eng/makeup/delete", { id }),
};
