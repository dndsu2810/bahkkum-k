import type { DataSnapshot } from "../types";
import type { AttSummary, DayBucket, NoteItem } from "./reportTypes";
import { pad, parseD } from "./dates";

const PRIORITY: Record<DayBucket, number> = { a: 3, m: 2, p: 1 };

function bucketOf(status: string): DayBucket | null {
  if (status === "결석" || status === "무단결석") return "a";
  if (status === "보강") return "m";
  if (status === "출석" || status === "지각" || status === "조퇴") return "p";
  return null;
}

/** Compute attendance summary for one student in a given year/month from the snapshot. */
export function computeAtt(data: DataSnapshot, studentId: string, year: number, month: number): AttSummary {
  const prefix = year + "-" + pad(month) + "-";
  let present = 0;
  let makeup = 0;
  let absent = 0;
  let total = 0;
  let outroEarly = 0; // 조퇴 (counts toward present-ish, but not into rate numerator)
  let late = 0;
  let lateMin = 0; // 지각 누적 분
  let pure = 0; // 출석
  const days: Record<number, DayBucket[]> = {};

  // 같은 날짜·같은 상태는 1회만(중복 출결 키로 인한 이중집계 방지).
  const counted = new Set<string>();
  Object.keys(data.attendance).forEach((key) => {
    const parts = key.split("|");
    const date = parts[0];
    const sid = parts[1];
    if (sid !== studentId || date.indexOf(prefix) !== 0) return;
    const status = data.attendance[key].status;
    const b = bucketOf(status);
    if (!b) return;
    const dk = date + "|" + status;
    if (counted.has(dk)) return;
    counted.add(dk);
    total++;
    if (status === "출석") pure++;
    else if (status === "지각") { late++; lateMin += Number(data.attendance[key].lateMinutes) || 0; }
    else if (status === "조퇴") outroEarly++;
    if (b === "p") present++;
    else if (b === "m") makeup++;
    else if (b === "a") absent++;

    // 하루에 여러 기록(정규 출석 + 보강 등)이 있으면 모두 표시. 같은 버킷은 한 번만.
    const day = parseD(date).getDate();
    const arr = days[day] || (days[day] = []);
    if (!arr.includes(b)) {
      arr.push(b);
      arr.sort((x, y) => PRIORITY[x] - PRIORITY[y]); // 출석(p) → 보강(m) → 결석(a) 순
    }
  });

  void outroEarly;
  const rate = total ? Math.round(((pure + late) / total) * 100) : 0;
  return { total, present, makeup, absent, late, lateMin, rate, days };
}

/** Build default 출결 특이사항 from the student's month attendance (editable later). */
export function deriveNotes(
  data: DataSnapshot,
  studentId: string,
  year: number,
  month: number
): NoteItem[] {
  const prefix = year + "-" + pad(month) + "-";
  const rows: { date: string; status: string; note: string; time: string; lateMin: number }[] = [];
  Object.keys(data.attendance).forEach((key) => {
    const parts = key.split("|");
    const date = parts[0];
    const sid = parts[1];
    const time = parts[2] || "";
    if (sid !== studentId || date.indexOf(prefix) !== 0) return;
    const rec = data.attendance[key];
    if (rec.status === "출석" && !rec.note) return; // 평범한 출석은 특이사항 아님
    rows.push({ date, status: rec.status, note: rec.note || "", time, lateMin: Number(rec.lateMinutes) || 0 });
  });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.time < b.time ? -1 : 1));
  return rows.map((r, i) => {
    const d = parseD(r.date);
    const dateLabel = pad(d.getMonth() + 1) + " / " + pad(d.getDate());
    const tone: NoteItem["tone"] =
      r.status === "결석" || r.status === "무단결석" || r.status === "조퇴"
        ? "r"
        : r.status === "보강"
          ? "b"
          : "g";
    // 보강은 '몇 시부터' 했는지 같이 표기 — 단, 시간 자리가 실제 시각(HH:MM)일 때만.
    // (가져온 기록은 시간 자리가 내부 식별자라 시각이 아님 → 시각 생략)
    const isClock = /^\d{1,2}:\d{2}$/.test(r.time);
    const head =
      r.status === "보강" && isClock
        ? "보강 " + r.time + "~"
        : r.status === "지각" && r.lateMin
          ? "지각 " + r.lateMin + "분"
          : r.status;
    const text = r.note ? head + " — " + r.note : head;
    return { id: "n" + i + "_" + r.date + "_" + r.time, dateLabel, tone, text };
  });
}
