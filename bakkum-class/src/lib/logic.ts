import type { Grade, Makeup, MakeupDisplay, Student } from "../types";
import { DOW_ORDER, TODAY, pad, parseD } from "./dates";

/* ---------- small helpers ---------- */
export function gradeColor(g: Grade | string): "blue" | "purple" {
  return g === "초등" ? "blue" : "purple";
}
export function weekCount(st: Student): number {
  return st.lessons ? st.lessons.length : 0;
}
export function freqLabel(st: Student): string {
  return "주" + weekCount(st) + "회";
}
export function avatarText(name: string): string {
  return name ? name.slice(-2) : "?";
}
export function durTotal(s: Student): number {
  let t = 0;
  (s.lessons || []).forEach((l) => {
    t += +l.duration || 0;
  });
  return t;
}
export function pct(a: number, b: number): number {
  return b ? Math.round((a / b) * 100) : 0;
}

/* ---------- enrollment logic ----------
   재적 = 해당 월 1일 이전(포함)에 등록된 학생만 */
export function firstOfMonth(ym: string): Date {
  const p = ym.split("-");
  return new Date(+p[0], +p[1] - 1, 1);
}
export function enrolledStudents(students: Student[], ym: string): Student[] {
  const first = firstOfMonth(ym);
  return students.filter((s) => parseD(s.startDate) <= first);
}
/** 이번 달 등록(2일 이후) → 다음 달부터 재적 */
export function newThisMonth(students: Student[], ym: string): Student[] {
  const p = ym.split("-");
  const y = +p[0];
  const m = +p[1];
  return students.filter((s) => {
    const d = parseD(s.startDate);
    return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() > 1;
  });
}
export function inMonth(dateStr: string, ym: string): boolean {
  if (!dateStr) return false;
  const p = ym.split("-");
  const d = parseD(dateStr);
  return d.getFullYear() === +p[0] && d.getMonth() + 1 === +p[1];
}

/* ---------- makeup status ---------- */
export function mkStatus(k: Makeup): MakeupDisplay {
  if (k.status === "scheduled") return parseD(k.makeupDate) < TODAY ? "done" : "scheduled";
  return k.status; // pending | skip
}

export function monthScheduled(makeups: Makeup[], ym: string): Makeup[] {
  return makeups
    .filter((k) => k.status === "scheduled" && inMonth(k.makeupDate, ym))
    .sort((a, b) => (a.makeupDate < b.makeupDate ? -1 : 1));
}
export function monthPending(makeups: Makeup[], ym: string): Makeup[] {
  return makeups
    .filter((k) => k.status === "pending" && inMonth(k.absentDate, ym))
    .sort((a, b) => (a.absentDate < b.absentDate ? -1 : 1));
}
export function monthSkip(makeups: Makeup[], ym: string): Makeup[] {
  return makeups
    .filter((k) => k.status === "skip" && inMonth(k.absentDate, ym))
    .sort((a, b) => (a.absentDate < b.absentDate ? -1 : 1));
}
/** everything relevant to the month, for the dashboard overview list */
export function monthActivity(makeups: Makeup[], ym: string): Makeup[] {
  return makeups
    .filter((k) => inMonth(k.absentDate, ym) || inMonth(k.makeupDate, ym))
    .sort((a, b) => {
      const da = a.makeupDate || a.absentDate;
      const db = b.makeupDate || b.absentDate;
      return da < db ? 1 : -1;
    });
}
export function byAbsentDesc(a: Makeup, b: Makeup): number {
  return a.absentDate < b.absentDate ? 1 : -1;
}

export function studentById(students: Student[], id: string): Student | null {
  for (let i = 0; i < students.length; i++) if (students[i].id === id) return students[i];
  return null;
}

export function monthLabel(ym: string): string {
  const p = ym.split("-");
  return +p[1] + "월";
}
export function monthLabelFull(ym: string): string {
  const p = ym.split("-");
  return +p[0] + "년 " + +p[1] + "월";
}
export function curMonthStr(): string {
  return TODAY.getFullYear() + "-" + pad(TODAY.getMonth() + 1);
}

/* ---------- month options ---------- */
export function monthOptions(): { v: string; l: string }[] {
  const opts: { v: string; l: string }[] = [];
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  for (let i = 0; i < 14; i++) {
    const ym = d.getFullYear() + "-" + pad(d.getMonth() + 1);
    opts.push({ v: ym, l: d.getFullYear() + "년 " + (d.getMonth() + 1) + "월" });
    d.setMonth(d.getMonth() - 1);
  }
  return opts;
}

/** sorted day chips for a student (unique, timetable order) */
export function lessonDays(s: Student): string[] {
  const days = (s.lessons || []).map((l) => l.day);
  const uniq: string[] = [];
  days.forEach((d) => {
    if (uniq.indexOf(d) < 0) uniq.push(d);
  });
  uniq.sort((a, b) => DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b));
  return uniq;
}
