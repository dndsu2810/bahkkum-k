export const DOW = ["일", "월", "화", "수", "목", "금", "토"];
/** Timetable column order (Mon-first). */
export const DOW_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

export const TT_START = 10;
export const TT_END = 21;
export const ROW_H = 54;

export const TODAY = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();

export function pad(n: number): string {
  return (n < 10 ? "0" : "") + n;
}

export function todayStr(): string {
  return TODAY.getFullYear() + "-" + pad(TODAY.getMonth() + 1) + "-" + pad(TODAY.getDate());
}

export function parseD(s: string): Date {
  const p = s.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

export function fmtMD(d: Date): string {
  return d.getMonth() + 1 + "/" + d.getDate();
}

export function fmtMDDow(s: string): string {
  const d = parseD(s);
  return fmtMD(d) + "(" + DOW[d.getDay()] + ")";
}

export function fmtFull(d: Date): string {
  return (
    d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일 (" + DOW[d.getDay()] + ")"
  );
}

export function timeToMin(t: string): number {
  const p = t.split(":");
  return +p[0] * 60 + +p[1];
}

export function mondayOf(date: Date, offsetWeeks: number): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  d.setDate(d.getDate() + diff + offsetWeeks * 7);
  return d;
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
