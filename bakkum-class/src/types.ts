export type Grade = "초등" | "중등";
export type MakeupStatus = "pending" | "scheduled" | "skip";
/** Derived display status (adds "done" once a scheduled makeup date has passed). */
export type MakeupDisplay = "pending" | "scheduled" | "done" | "skip";

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

export type Attendance = Record<string, "present" | "absent">;

export interface DataSnapshot {
  students: Student[];
  makeups: Makeup[];
  attendance: Attendance;
}
