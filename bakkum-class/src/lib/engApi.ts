// 영어(신규) API — 일일 학습일지 · 진도 · 테스트.

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}
async function jpost<T = { ok?: boolean; id?: string; error?: string }>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

export interface Goal {
  text: string;
  done: boolean;
}
// 출결 상태 — 수학과 통일(출석/지각/결석 + 조퇴/무단결석). '보강'은 상태가 아니라 별도 플래그(makeup).
export type AttStatus = "" | "출석" | "지각" | "결석" | "조퇴" | "무단결석";
// 중고등영어 숙제 분류 상태(노션 과제기록과 동일): 완료/미흡/안함/없음.
export type HwStatus = "" | "완료" | "미흡" | "안함" | "없음";
export const HW_STATUSES: HwStatus[] = ["완료", "미흡", "안함", "없음"];
/** 숙제 진행률(%) — 완료 100·미흡 50·안함 0, '없음'/미입력은 제외. */
export function hwProgress(d: { hwWord: HwStatus; hwReading: HwStatus; hwGrammar: HwStatus }): number | null {
  const vals = [d.hwWord, d.hwReading, d.hwGrammar].filter((s) => s && s !== "없음");
  if (!vals.length) return null;
  const score = vals.reduce((n, s) => n + (s === "완료" ? 1 : s === "미흡" ? 0.5 : 0), 0);
  return Math.round((score / vals.length) * 100);
}
export interface EngDaily {
  studentId: string;
  date: string;
  attended: boolean;
  attStatus: AttStatus;
  lateMin: number; // 지각 분
  absentReason: string; // 결석 사유
  // 보강 플래그 — 켜면 이 수업은 보강. 출결(출석/지각/조퇴/무단결석)은 그대로 남기되 포인트는 적립하지 않음.
  makeup: boolean;
  goals: Goal[];
  homework: string;
  hwChecked: boolean;
  // 중고등영어 숙제 3분류 + 틀린 단어 확인(틀단확인).
  hwWord: HwStatus;
  hwReading: HwStatus;
  hwGrammar: HwStatus;
  wrongCheck: boolean;
  // 포인트 제도(노션 수업기록과 동일): 적립/차감 사유 + 합계 포인트 + 수업태도 + 특이사항.
  attitude: string;
  pointReasons: string[];
  points: number;
  note: string;
  // 초등영어 수업일지 — 원서진도번호·단어시험·활동 체크리스트.
  bookNo: string;
  wordTest: string;
  doneItems: string[];
  comment: string;
  materials: string;
  updatedAt: number;
}

// 적립/차감 사유 카탈로그(노션 '적립이나 차감사유' 옵션과 동일). 라벨 끝 숫자가 점수.
export const POINT_REASONS: { name: string; value: number }[] = [
  { name: "출석 100", value: 100 },
  { name: "지각 -100", value: -100 },
  { name: "칭찬 200", value: 200 },
  { name: "단어숙제 50", value: 50 },
  { name: "독해숙제 50", value: 50 },
  { name: "문법숙제 50", value: 50 },
  { name: "숙제 50", value: 50 },
  { name: "숙제 -100", value: -100 },
  { name: "협동 300", value: 300 },
];
export const ENG_ATTITUDES = ["매우좋음", "보통", "미흡", "매우나쁨"];
// 초등영어 수업일지 활동 체크리스트(노션 초등 수업일지 DB의 체크박스 항목).
export const ELEM_LOG_ITEMS = ["준비", "Practice Book", "영문법", "자판연습", "core phonics", "아카데미 주니어 프린트", "판다라이팅"];
/** 사유 라벨들에서 끝 숫자(±) 합 = 포인트. */
export function pointsOf(reasons: string[]): number {
  return (reasons || []).reduce((n, r) => {
    const m = /(-?\d+)\s*$/.exec(r);
    return n + (m ? parseInt(m[1], 10) : 0);
  }, 0);
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
  result: string; // '' | 통과 | 재시(NP)
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

export interface EngRanking {
  studentId: string;
  name: string;
  grade: string;
  points: number;
  days: number;
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
  /** 노션 '과제기록 입력'(중고등 단어·리딩·문법 숙제) 1회 가져오기(원장 전용). */
  syncDaily: () => jpost<{ ok: boolean; total: number; imported: number; unmatched: string[] }>("/api/sync/eng-daily", {}),
  /** 노션 '수업기록(출결+포인트)' 1회 가져오기(원장 전용). */
  syncAttendance: () => jpost<{ ok: boolean; total: number; imported: number; unmatched: string[] }>("/api/sync/eng-attendance", {}),
  /** 노션 '초등 수업일지' 1회 가져오기(원장 전용). */
  syncElemLog: () => jpost<{ ok: boolean; total: number; imported: number; unmatched: string[] }>("/api/sync/eng-elem-log", {}),
  /** 학생 포인트 랭킹(누적 합). */
  ranking: () => jget<{ ranking: EngRanking[] }>("/api/eng/ranking").then((j) => j.ranking),
  /** 강사가 추가한 '오늘 한 것'·포인트 사유 목록(기본 목록에 더해 쓰임). */
  getCatalog: () => jget<{ doneItems: string[]; pointReasons: { name: string; value: number }[] }>("/api/eng/catalog"),
  saveCatalog: (patch: { doneItems?: string[]; pointReasons?: { name: string; value: number }[] }) => jpost("/api/eng/catalog", patch),
  /** 포인트 항목(적립·차감 사유) 공통 카탈로그 — 저장된 게 없으면 기본+기존추가 합본 반환. */
  pointReasons: () => jget<{ reasons: { name: string; value: number }[] }>("/api/eng/point-reasons").then((j) => j.reasons),
  savePointReasons: (reasons: { name: string; value: number }[]) => jpost("/api/eng/point-reasons", { reasons }),
  /** '오늘 한 것' 항목 — 기본 + 전체공통 + 학생별. student_id 주면 그 학생 것 포함. */
  doneItems: (studentId?: string) =>
    jget<{ defaults: string[]; hidden: string[]; global: string[]; student: string[]; merged: string[] }>("/api/eng/done-items" + (studentId ? "?student_id=" + encodeURIComponent(studentId) : "")),
  /** 항목 추가/삭제. scope 'all'(모두) | 'student'(해당 학생만). add 또는 remove 중 하나. */
  saveDoneItem: (b: { scope: "all" | "student"; studentId?: string; add?: string; remove?: string }) => jpost("/api/eng/done-items", b),

  progress: (studentId: string) =>
    jget<{ progress: EngProgress[] }>("/api/eng/progress?student_id=" + encodeURIComponent(studentId)).then((j) => j.progress),
  saveProgress: (p: Partial<EngProgress> & { studentId: string }) => jpost("/api/eng/progress", p),
  removeProgress: (id: string) => jpost("/api/eng/progress/delete", { id }),

  tests: (studentId: string) =>
    jget<{ tests: EngTest[] }>("/api/eng/test?student_id=" + encodeURIComponent(studentId)).then((j) => j.tests),
  /** 특정 학생·날짜의 테스트(오늘 화면에서 여러 개 입력용). */
  testsByDate: (studentId: string, date: string) =>
    jget<{ tests: EngTest[] }>("/api/eng/test?student_id=" + encodeURIComponent(studentId) + "&date=" + encodeURIComponent(date)).then((j) => j.tests),
  saveTest: (t: Partial<EngTest> & { studentId: string }) => jpost("/api/eng/test", t),
  removeTest: (id: string) => jpost("/api/eng/test/delete", { id }),

  makeups: (studentId?: string) =>
    jget<{ makeups: EngMakeup[] }>("/api/eng/makeup" + (studentId ? "?student_id=" + encodeURIComponent(studentId) : "")).then((j) => j.makeups),
  saveMakeup: (mk: Partial<EngMakeup> & { studentId: string }) => jpost("/api/eng/makeup", mk),
  removeMakeup: (id: string) => jpost("/api/eng/makeup/delete", { id }),
};
