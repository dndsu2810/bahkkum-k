import type { DataSnapshot, Makeup } from "../types";
import type { AttSummary, DayBucket, NoteItem } from "./reportTypes";
import { pad, parseD, todayStr } from "./dates";

const PRIORITY: Record<DayBucket, number> = { a: 4, m: 3, l: 2, p: 1 };

/** 보강이 '끝난' 것으로 볼지 — 완료(done)이거나, 예정이지만 보강일이 이미 지난 것(보강관리 표시와 동일). */
function makeupHappened(m: Makeup, today: string): boolean {
  if (!m.makeupDate) return false;
  if (m.status === "done") return true;
  if (m.status === "scheduled" && m.makeupDate < today) return true; // 보강일이 지난 예정 = 사실상 완료
  return false;
}

function bucketOf(status: string): DayBucket | null {
  if (status === "결석" || status === "무단결석") return "a";
  if (status === "보강") return "m";
  if (status === "지각") return "l"; // 달력에 '지각'(주황)으로 따로 표시
  if (status === "출석" || status === "조퇴") return "p";
  return null;
}

/** 그 학생의 '활성 보강 일정'(예정/완료, 보강일 지정됨)이 있는 날짜 집합.
 *  보강을 '대기'로 되돌리거나 삭제하면 makeupDate가 비워져 여기에 안 들어온다 →
 *  남아 있는 '보강' 출결 행을 리포트에서 무시하는 기준(고아 보강 표시 방지). */
function activeMakeupDates(data: DataSnapshot, studentId: string): Set<string> {
  const s = new Set<string>();
  for (const m of data.makeups || []) {
    if (m.studentId !== studentId) continue;
    if ((m.status === "scheduled" || m.status === "done") && m.makeupDate) s.add(m.makeupDate);
  }
  return s;
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
  const boardingDates = new Set<string>(); // 출결로 이미 집계된 보강 날짜
  const activeMk = activeMakeupDates(data, studentId);
  Object.keys(data.attendance).forEach((key) => {
    const parts = key.split("|");
    const date = parts[0];
    const sid = parts[1];
    if (sid !== studentId || date.indexOf(prefix) !== 0) return;
    const status = data.attendance[key].status;
    const b = bucketOf(status);
    if (!b) return;
    // '보강' 출결인데 그 날짜에 활성 보강 일정이 없으면(되돌림/삭제된 고아) 집계·달력에서 제외.
    if (b === "m" && !activeMk.has(date)) return;
    const dk = date + "|" + status;
    if (counted.has(dk)) return;
    counted.add(dk);
    total++;
    if (status === "출석") pure++;
    else if (status === "지각") { late++; lateMin += Number(data.attendance[key].lateMinutes) || 0; }
    else if (status === "조퇴") outroEarly++;
    if (b === "p" || b === "l") present++; // 지각·조퇴도 출석 집계엔 포함(present=출석+지각+조퇴)
    else if (b === "m") { makeup++; boardingDates.add(date); }
    else if (b === "a") absent++;

    // 하루에 여러 기록(정규 출석 + 보강 등)이 있으면 모두 표시. 같은 버킷은 한 번만.
    const day = parseD(date).getDate();
    const arr = days[day] || (days[day] = []);
    if (!arr.includes(b)) {
      arr.push(b);
      arr.sort((x, y) => PRIORITY[x] - PRIORITY[y]); // 출석(p) → 보강(m) → 결석(a) 순
    }
  });

  // 보강일이 지났지만 '완료' 체크를 안 한 예정 보강도 집계(보강관리에선 완료로 보이는데 리포트에서 빠지던 누락 해결).
  // 그 달 보강일 기준 + 사실상 끝난 보강 + 아직 출결로 안 센 날짜만 추가.
  const today = todayStr();
  for (const m of data.makeups || []) {
    if (m.studentId !== studentId) continue;
    if (m.makeupDate.indexOf(prefix) !== 0) continue; // 이 달 보강일만
    if (!makeupHappened(m, today)) continue;
    if (boardingDates.has(m.makeupDate)) continue; // 출결로 이미 셈
    boardingDates.add(m.makeupDate);
    total++;
    makeup++;
    const day = parseD(m.makeupDate).getDate();
    const arr = days[day] || (days[day] = []);
    if (!arr.includes("m")) {
      arr.push("m");
      arr.sort((x, y) => PRIORITY[x] - PRIORITY[y]);
    }
  }

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
  const activeMk = activeMakeupDates(data, studentId);
  const rows: { date: string; status: string; note: string; time: string; lateMin: number }[] = [];
  Object.keys(data.attendance).forEach((key) => {
    const parts = key.split("|");
    const date = parts[0];
    const sid = parts[1];
    const time = parts[2] || "";
    if (sid !== studentId || date.indexOf(prefix) !== 0) return;
    const rec = data.attendance[key];
    if (rec.status === "출석" && !rec.note) return; // 평범한 출석은 특이사항 아님
    // '보강'인데 활성 보강 일정이 없으면(되돌림/삭제된 고아) 특이사항에서 제외.
    if (rec.status === "보강" && !activeMk.has(date)) return;
    rows.push({ date, status: rec.status, note: rec.note || "", time, lateMin: Number(rec.lateMinutes) || 0 });
  });
  // 보강일이 지난 '예정' 보강(완료 체크 안 한 것)도 특이사항에 포함 — 출결기록 없어도(보강관리 표시와 일치).
  const boardingDates = new Set(rows.filter((r) => r.status === "보강").map((r) => r.date));
  const today = todayStr();
  for (const m of data.makeups || []) {
    if (m.studentId !== studentId) continue;
    if (m.makeupDate.indexOf(prefix) !== 0) continue;
    if (!makeupHappened(m, today)) continue;
    if (boardingDates.has(m.makeupDate)) continue;
    boardingDates.add(m.makeupDate);
    rows.push({ date: m.makeupDate, status: "보강", note: m.memo || "", time: m.makeupTime || "", lateMin: 0 });
  }
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
