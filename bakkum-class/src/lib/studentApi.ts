// 학생 개별 페이지 API — 학생 본인 + 강사/원장 공용.
// 학생: 본인 시간표·커리큘럼 조회 + 본인 일지 입력.
// 강사/원장: 임의 학생(student_id) 페이지 + 커리큘럼 편집.

import type { MathBoard } from "./baseball";
import type { HwItem } from "./engApi";

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
  step?: number; // 현재 진행 단계(평탄화된 행 인덱스) — 초록불 위치. 영구 저장.
}
/** 학습 목표 — 강사가 만들고 학생도 'done' 체크 가능(양방향, 같은 일지 row 공유). */
export interface StudentGoal {
  text: string;
  done: boolean;
}
export interface StudentLogRow {
  date: string;
  attStatus: string;
  goals: StudentGoal[];
  hwAssign: HwItem[];
  hwCheck: { text: string; status: string }[];
  bookNo: string;
  bookNext: string; // 중고등영어 '다음에 할 것'(진도 예고)
  wordTest: string;
  doneItems: string[];
  curRanges?: Record<string, string>; // '오늘뭐해요' 항목별 범위/분량(학생·강사 입력)
  startTime: string;
  endTime: string;
  comment: string; // 수업 코멘트(학생은 읽기 전용)
  hwComment: string; // 숙제 코멘트(중고등영어, 학생 읽기)
  studentNote: string; // 학생이 '선생님께' 남긴 메모
  // 중고등 숙제(강사가 '오늘'에서 체크 — 학생 페이지는 조회).
  hwWord: string;
  hwReading: string;
  hwGrammar: string;
  wrongCheck: boolean;
  links?: StudentLink[]; // 그날 일지에 붙는 바로가기 링크(강사 입력) — 학생 화면에 버튼으로
  updatedAt: number;
}
/** 학생 화면 바로가기 링크 — 강사가 학생별로 넣는 버튼(이름 + 주소). */
export interface StudentLink {
  name: string;
  url: string;
}
export interface StudentPageData {
  role: string;
  canEditCurriculum: boolean;
  student: { id: string; name: string; grade: string; school: string; band: string; photo: string };
  subjects?: string[]; // 수강 과목 ["math","english"] — 영수 둘 다면 학생 화면에서 과목 선택
  mathClass?: string; // 수학 반: "" 자동 | "low" 저학년 | "high" 고학년
  engSlots: StudentSlot[];
  mathSlots?: StudentSlot[]; // 수학 수업 시간(학생 수학 화면 시간표용)
  curriculum: Curriculum;
  selfCurriculum: CurriculumRow[]; // 학생이 직접 추가한 '내가 추가한 학습'
  daily: StudentLogRow[];
  materials?: { kind: string; name: string }[]; // 배부된 자료(kind: lesson 수업 / hw 숙제). 해제 전까지 계속 표시.
  progressBooks?: string[]; // 진도·교재관리에서 진행중인 교재명
  examMode?: boolean; // 내신모드(중고등) 활성 여부 — 켜지면 교재·진도 칸을 숨긴다
  mathBoard?: MathBoard | null; // 수학 전광판(수학 수강생만). 아니면 null/없음 → 칩 숨김.
  math?: MathStudentData | null; // 수학 기록(읽기 전용) — 출석·숙제·진도·시험·보강·등하원
  doneItemOptions?: string[]; // 그 학생의 '오늘 한 것' 선택지(기본+전체공통+학생별)
}

/** 수학 학생 화면(읽기 전용) 데이터 — 기존 수학 앱 테이블에서 그 학생 것만 모아 온 것. */
export interface MathStudentData {
  attendance: { date: string; status: string }[];
  homework: { date: string; book: string; status: string; completion: number; memo: string; recheckDate?: string }[];
  progress: { unit: string; area: string; pct: number }[];
  tests: { date: string; type: string; range: string; score: number; status: string }[];
  makeups: { absentDate: string; makeupDate: string; makeupTime: string; status: string; memo: string }[];
  checkin: { date: string; kind: string; subject: string; time: string }[];
  noteToday?: string; // 오늘 알림장(강사 메모)
}

/** 학생이 낸 수업시간 변경 신청(상태 확인용). */
export interface StudentChangeReq {
  id: string;
  fromDate: string;
  toDate: string;
  fromTime: string;
  toTime: string;
  reason: string;
  status: string; // pending | approved | rejected | withdrawn
  createdAt: number;
}

/** 학생 개별 페이지 활동 체크리스트(초등 수업일지 활동과 동일). */
export const STUDENT_LOG_ITEMS = ["준비", "Practice Book", "영문법", "자판연습", "core phonics", "아카데미 주니어 프린트", "판다라이팅"];

export const studentApi = {
  /** 페이지 데이터. 강사는 sid 지정, 학생은 생략(본인). */
  page: (sid?: string) => jget<StudentPageData>("/api/student/page" + (sid ? "?student_id=" + encodeURIComponent(sid) : "")),
  /** 일지 입력. 학생은 본인(studentId 무시), 강사는 studentId 지정. */
  saveLog: (d: { studentId?: string; date: string; bookNo?: string; wordTest?: string; doneItems?: string[]; curRanges?: Record<string, string>; startTime?: string; endTime?: string; studentNote?: string; goals?: StudentGoal[]; hwAssign?: HwItem[]; hwCheck?: { text: string; status: string }[] }) =>
    jpost("/api/student/log", d),
  /** 수업시간 변경 신청(학생) — 3일 전·어머님 확인 필수. 저장 후 카카오워크 알림. */
  createChangeReq: (d: { fromDate: string; fromTime: string; toDate: string; toTime: string; reason: string; parentConfirmed: boolean }) =>
    jpost<{ ok?: boolean; error?: string; minDate?: string }>("/api/student/change-req", d),
  /** 내 변경 신청 목록(상태 확인). */
  myChangeReqs: () => jget<{ reqs: StudentChangeReq[] }>("/api/student/change-reqs").then((j) => j.reqs),
  /** 커리큘럼 저장(초등영어 권한자·원장). */
  getCurriculum: (studentId: string) => jget<{ curriculum: Curriculum }>("/api/student/curriculum?student_id=" + encodeURIComponent(studentId)).then((j) => j.curriculum),
  saveCurriculum: (studentId: string, cur: Curriculum) => jpost("/api/student/curriculum", { studentId, note: cur.note, sections: cur.sections, step: cur.step || 0 }),
  /** 진행 단계만 갱신(초록불 이동). 학생 본인은 studentId 생략, 교사는 지정. */
  setCurriculumStep: (step: number, studentId?: string) => jpost("/api/student/curriculum-step", { studentId, step }),
  /** '내가 추가한 학습' 저장(학생 본인은 studentId 생략, 강사는 지정). */
  saveSelfCurriculum: (items: CurriculumRow[], studentId?: string) => jpost("/api/student/curriculum-self", { studentId, items }),
  /** 기본 커리큘럼 양식. */
  curriculumDefaults: () => jget<{ defaults: Curriculum }>("/api/student/curriculum/defaults").then((j) => j.defaults),
};
