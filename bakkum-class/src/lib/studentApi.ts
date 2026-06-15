// 학생 개별 페이지 API — 학생 본인 + 강사/원장 공용.
// 학생: 본인 시간표·커리큘럼 조회 + 본인 일지 입력.
// 강사/원장: 임의 학생(student_id) 페이지 + 커리큘럼 편집.

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}
async function jpost<T = { ok?: boolean; error?: string }>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

export interface StudentSlot {
  day: string;
  time: string;
  duration: number;
}
/* 커리큘럼 — 노션 '수업 내용' 표 구조(섹션별 항목). */
export interface CurriculumRow {
  name: string;
  amount: string;
}
export interface CurriculumSection {
  title: string;
  rows: CurriculumRow[];
}
export interface Curriculum {
  note: string;
  sections: CurriculumSection[];
}
export interface StudentLogRow {
  date: string;
  attStatus: string;
  bookNo: string;
  wordTest: string;
  doneItems: string[];
  startTime: string;
  endTime: string;
  comment: string;
  updatedAt: number;
}
export interface StudentPageData {
  role: string;
  canEditCurriculum: boolean;
  student: { id: string; name: string; grade: string; school: string; band: string; photo: string };
  engSlots: StudentSlot[];
  curriculum: Curriculum;
  daily: StudentLogRow[];
  doneItemOptions?: string[]; // 그 학생의 '오늘 한 것' 선택지(기본+전체공통+학생별)
}

/** 학생 개별 페이지 활동 체크리스트(초등 수업일지 활동과 동일). */
export const STUDENT_LOG_ITEMS = ["준비", "Practice Book", "영문법", "자판연습", "core phonics", "아카데미 주니어 프린트", "판다라이팅"];

export const studentApi = {
  /** 페이지 데이터. 강사는 sid 지정, 학생은 생략(본인). */
  page: (sid?: string) => jget<StudentPageData>("/api/student/page" + (sid ? "?student_id=" + encodeURIComponent(sid) : "")),
  /** 일지 입력. 학생은 본인(studentId 무시), 강사는 studentId 지정. */
  saveLog: (d: { studentId?: string; date: string; bookNo?: string; wordTest?: string; doneItems?: string[]; startTime?: string; endTime?: string; comment?: string }) =>
    jpost("/api/student/log", d),
  /** 커리큘럼 저장(초등영어 권한자·원장). */
  saveCurriculum: (studentId: string, cur: Curriculum) => jpost("/api/student/curriculum", { studentId, note: cur.note, sections: cur.sections }),
  /** 기본 커리큘럼 양식. */
  curriculumDefaults: () => jget<{ defaults: Curriculum }>("/api/student/curriculum/defaults").then((j) => j.defaults),
};
