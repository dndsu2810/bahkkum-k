export type Grade = "초등" | "중등";
export type MakeupStatus = "pending" | "scheduled" | "skip";
/** Derived display status (adds "done" once a scheduled makeup date has passed). */
export type MakeupDisplay = "pending" | "scheduled" | "done" | "skip";

/** 재원/휴원/퇴원/대기 — only 재원 students appear in the dashboard/attendance/timetable. */
export type StudentStatus = "재원" | "휴원" | "퇴원" | "대기";

export type AttStatus = "출석" | "지각" | "결석" | "조퇴" | "무단결석" | "보강";
export type Attitude = "매우좋음" | "보통" | "미흡";

export interface Lesson {
  day: string; // '월'..'일'
  time: string; // HH:MM
  duration: number; // minutes
}

export interface Student {
  id: string;
  name: string;
  grade: Grade;
  startDate: string; // YYYY-MM-DD
  excluded: boolean;
  status: StudentStatus;
  school: string;
  birthdate: string; // YYYY-MM-DD or ''
  parentPhone: string;
  studentPhone: string;
  lessons: Lesson[];
}

export interface Makeup {
  id: string;
  studentId: string;
  absentDate: string;
  absentTime: string;
  absentDuration: number;
  attKey: string;
  status: MakeupStatus;
  makeupDate: string;
  makeupTime: string;
  makeupDuration: number;
  parentContacted: boolean;
  memo: string;
  createdAt: number;
}

/** One attendance mark. key = "YYYY-MM-DD|studentId|HH:MM" */
export interface AttRecord {
  status: AttStatus;
  lateMinutes?: number; // only for 지각
  attitude?: Attitude | "";
  note?: string;
  /** true once a +20 출석 point has been awarded for this mark (idempotency). */
  pointsAwarded?: boolean;
}

export type Attendance = Record<string, AttRecord>;

/** A homework record (숙제 관리 페이지에서 기록 → 월말리포트에 누적). */
export interface HwLog {
  id: string;
  studentId: string;
  date: string; // YYYY-MM-DD
  book: string;
  tags: string[];
  completion: number; // 0..100
  status: "pending" | "done" | "late"; // 검사 전 / 검사완료 / 지연
  memo: string;
}

/** A progress record (진도 관리). 날짜가 아니라 진행중/완료(완성도 100)가 기준. */
export interface ProgLog {
  id: string;
  studentId: string;
  unit: string;
  area: string;
  pct: number; // 달성률 0..100 (100 = 완료)
  startDate: string; // 학습 시작일
  memo: string;
}

export interface DataSnapshot {
  students: Student[];
  makeups: Makeup[];
  attendance: Attendance;
  homeworkLog: HwLog[];
  progressLog: ProgLog[];
}
