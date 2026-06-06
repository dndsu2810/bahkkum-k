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

export interface DataSnapshot {
  students: Student[];
  makeups: Makeup[];
  attendance: Attendance;
}
