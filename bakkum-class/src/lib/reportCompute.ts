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
  let pure = 0; // 출석
  const days: Record<number, DayBucket> = {};

  Object.keys(data.attendance).forEach((key) => {
    const parts = key.split("|");
    const date = parts[0];
    const sid = parts[1];
    if (sid !== studentId || date.indexOf(prefix) !== 0) return;
    const status = data.attendance[key].status;
    const b = bucketOf(status);
    if (!b) return;
    total++;
    if (status === "출석") pure++;
    else if (status === "지각") late++;
    else if (status === "조퇴") outroEarly++;
    if (b === "p") present++;
    else if (b === "m") makeup++;
    else if (b === "a") absent++;

    const day = parseD(date).getDate();
    if (!days[day] || PRIORITY[b] > PRIORITY[days[day]]) days[day] = b;
  });

  void outroEarly;
  const rate = total ? Math.round(((pure + late) / total) * 100) : 0;
  return { total, present, makeup, absent, rate, days };
}

/** Build default 출결 특이사항 from the student's month attendance (editable later). */
export function deriveNotes(
  data: DataSnapshot,
  studentId: string,
  year: number,
  month: number
): NoteItem[] {
  const prefix = year + "-" + pad(month) + "-";
  const rows: { date: string; status: string; note: string }[] = [];
  Object.keys(data.attendance).forEach((key) => {
    const [date, sid] = key.split("|");
    if (sid !== studentId || date.indexOf(prefix) !== 0) return;
    const rec = data.attendance[key];
    if (rec.status === "출석" && !rec.note) return; // 평범한 출석은 특이사항 아님
    rows.push({ date, status: rec.status, note: rec.note || "" });
  });
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  return rows.map((r, i) => {
    const d = parseD(r.date);
    const dateLabel = pad(d.getMonth() + 1) + " / " + pad(d.getDate());
    const tone: NoteItem["tone"] =
      r.status === "결석" || r.status === "무단결석" || r.status === "조퇴"
        ? "r"
        : r.status === "보강"
          ? "b"
          : "g";
    const text = r.note ? r.status + " — " + r.note : r.status;
    return { id: "n" + i + "_" + r.date, dateLabel, tone, text };
  });
}
