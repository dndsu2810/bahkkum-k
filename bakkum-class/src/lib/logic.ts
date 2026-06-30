import type { Lesson, Makeup, MakeupDisplay, ScheduleVersion, Student, StudentStatus } from "../types";
import { DOW, DOW_ORDER, TODAY, pad, parseD, ymd } from "./dates";
import { toneOf, type Tone } from "./categories";
import { holidayName } from "./holidays";
import { GRADE_OPTIONS } from "./grade";

/** 주어진 날짜(YYYY-MM-DD)에 유효한 시간표를 반환.
 *  - schedule(버전 이력)이 있으면 from <= dateStr 중 가장 최근 버전의 lessons.
 *    그 날짜 이전(아직 적용 전)이면 빈 배열.
 *  - schedule이 없으면 기존 단일 lessons를 그대로 사용(하위 호환). */
export function effectiveLessons(s: Student, dateStr: string): Lesson[] {
  const hist = s.schedule;
  if (!hist || !hist.length) return s.lessons || [];
  let chosen: ScheduleVersion | null = null;
  for (const v of hist) {
    if (v.from <= dateStr && (!chosen || v.from > chosen.from)) chosen = v;
  }
  return chosen ? chosen.lessons : [];
}

/** 학생의 수업 길이(분) — 1회성 이동·추가로 카드에 넣을 때 60분 하드코딩 대신 실제 길이를 쓰기 위함.
 *  time이 주어지면 그 시간의 수업 길이, 없으면 첫 수업 길이. 못 찾으면 60. */
export function lessonDurationFor(s: Student, time?: string): number {
  const ls = s.lessons || [];
  const m = (time ? ls.find((l) => l.time === time) : undefined) || ls[0];
  return m?.duration || 60;
}

/** 해당 날짜가 학생의 첫 등원일(등록일) 이후인지 — 출결/시간표 표시 가드. */
export function attendsOn(s: Student, dateStr: string): boolean {
  if (s.startDate && dateStr < s.startDate) return false;
  return true;
}

/** Students actively attending — the only ones shown on dashboard/attendance/timetable. */
export function isActive(s: Student): boolean {
  return (s.status ?? "재원") === "재원";
}
export function activeStudents(students: Student[]): Student[] {
  return students.filter(isActive);
}

/* ---------- 학생 명단 정렬(여러 수학 화면 공통) ---------- */
/** 가나다(한글 이름)순. */
export function cmpName(a: { name: string }, b: { name: string }): number {
  return (a.name || "").localeCompare(b.name || "", "ko");
}
/** 학년 순위(초1→고3). 모르는 학년은 맨 뒤. */
export function gradeRank(grade: string): number {
  const i = GRADE_OPTIONS.indexOf(grade);
  return i < 0 ? GRADE_OPTIONS.length : i;
}
/** 학년순(같은 학년이면 가나다). */
export function cmpGrade(a: { grade: string; name: string }, b: { grade: string; name: string }): number {
  return gradeRank(a.grade) - gradeRank(b.grade) || cmpName(a, b);
}
/** 수학 첫 등원일(mathStart 우선, 없으면 등록일)순. 빠른 날짜 먼저, 같으면 가나다. */
export function cmpMathStart(a: { mathStart?: string; startDate: string; name: string }, b: { mathStart?: string; startDate: string; name: string }): number {
  const da = a.mathStart || a.startDate || "";
  const db = b.mathStart || b.startDate || "";
  return da.localeCompare(db) || cmpName(a, b);
}
/** 명단 정렬 — "name"(가나다) | "grade"(학년순). */
export function sortStudents<T extends { name: string; grade: string }>(list: T[], by: "name" | "grade"): T[] {
  return list.slice().sort(by === "grade" ? cmpGrade : cmpName);
}
export function statusTone(st: StudentStatus): string {
  return st === "재원" ? "green" : st === "대기" ? "blue" : st === "휴원" ? "orange" : "gray";
}

/* ---------- small helpers ---------- */
export function gradeColor(g: string): Tone {
  return toneOf(g);
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
   재적 = 해당 월 '첫주'(1~7일)에 등록된 학생까지. 둘째 주(8일~) 등록은 다음 달부터. */
export const ENROLL_CUTOFF_DAY = 7; // 첫주 끝(포함)
export function firstOfMonth(ym: string): Date {
  const p = ym.split("-");
  return new Date(+p[0], +p[1] - 1, 1);
}
/** 재적 기준일 = 그 달 7일(첫주 끝). 7일 이전(포함) 등록 = 이번 달 재적. */
export function enrollCutoff(ym: string): Date {
  const p = ym.split("-");
  return new Date(+p[0], +p[1] - 1, ENROLL_CUTOFF_DAY);
}
export function enrolledStudents(students: Student[], ym: string): Student[] {
  const cut = enrollCutoff(ym);
  return students.filter((s) => isActive(s) && parseD(s.startDate) <= cut);
}
/** 이번 달 둘째 주 이후(8일~) 등록 → 다음 달부터 재적 */
export function newThisMonth(students: Student[], ym: string): Student[] {
  const p = ym.split("-");
  const y = +p[0];
  const m = +p[1];
  return students.filter((s) => {
    if (!isActive(s)) return false;
    const d = parseD(s.startDate);
    return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() > ENROLL_CUTOFF_DAY;
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
  // 명시적으로 '완료' 처리했으면 그대로. (스케줄만 잡고 날짜가 지난 건 자동 완료로 간주 — 하위호환)
  if (k.status === "scheduled") return parseD(k.makeupDate) < TODAY ? "done" : "scheduled";
  return k.status; // pending | skip | done
}

export function monthScheduled(makeups: Makeup[], ym: string): Makeup[] {
  return makeups
    .filter((k) => k.status === "scheduled" && inMonth(k.makeupDate, ym))
    .sort((a, b) => (a.makeupDate < b.makeupDate ? -1 : 1));
}
export function monthDone(makeups: Makeup[], ym: string): Makeup[] {
  return makeups
    .filter((k) => k.status === "done" && inMonth(k.makeupDate, ym))
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

/** from(YYYY-MM-DD) 다음 날부터 그 학생의 가장 가까운 수업일(YYYY-MM-DD).
 *  공휴일·등록일 이전·시간표 없는 요일은 건너뛴다. 3주 내 없으면 ''. */
export function nextLessonDate(s: Student, fromDateStr: string): string {
  const start = parseD(fromDateStr);
  for (let i = 1; i <= 21; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const ds = ymd(d);
    if (holidayName(ds)) continue;
    if (!attendsOn(s, ds)) continue;
    const dow = DOW[d.getDay()];
    if (effectiveLessons(s, ds).some((l) => l.day === dow)) return ds;
  }
  return "";
}
