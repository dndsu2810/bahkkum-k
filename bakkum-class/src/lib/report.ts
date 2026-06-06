import type { DataSnapshot } from "../types";
import { fmtMDDow } from "./dates";
import {
  enrolledStudents,
  freqLabel,
  monthLabel,
  monthPending,
  monthScheduled,
  monthSkip,
  newThisMonth,
  studentById,
} from "./logic";

/** Builds the KakaoTalk-ready monthly report text (핵심 기능). */
export function buildReport(data: DataSnapshot, ym: string): string {
  const enrolled = enrolledStudents(data.students, ym)
    .slice()
    .sort((a, b) => (a.grade === b.grade ? 0 : a.grade === "초등" ? -1 : 1));
  const fresh = newThisMonth(data.students, ym);
  const sched = monthScheduled(data.makeups, ym);
  const pend = monthPending(data.makeups, ym);
  const skip = monthSkip(data.makeups, ym);
  const nm = (sid: string) => {
    const s = studentById(data.students, sid);
    return s ? s.name : "(삭제됨)";
  };
  const L: string[] = [];
  L.push("[" + monthLabel(ym) + " 수업 현황]");
  L.push("재적 학생 " + enrolled.length + "명");
  L.push("");
  L.push("— 재적 학생");
  enrolled.forEach((s) => L.push("  " + s.name + " (" + s.grade + " / " + freqLabel(s) + ")"));
  if (fresh.length) {
    L.push("");
    L.push("— 이번 달 신규 등록");
    fresh.forEach((s) =>
      L.push("  " + s.name + " " + fmtMDDow(s.startDate) + " 등록 → 다음 달부터 해당")
    );
  }
  L.push("");
  L.push("— 보강 내역");
  if (sched.length) {
    sched.forEach((k) => {
      let line =
        "  " + nm(k.studentId) + " · 보강 " + fmtMDDow(k.makeupDate) + " " + k.makeupTime + " (" + k.makeupDuration + "분)";
      if (k.absentDate) line += " · 결석 " + fmtMDDow(k.absentDate);
      L.push(line);
    });
  } else {
    L.push("  없음");
  }
  if (pend.length) {
    L.push("");
    L.push("— 보강 대기 (일정 미정)");
    pend.forEach((k) => L.push("  " + nm(k.studentId) + " · 결석 " + fmtMDDow(k.absentDate)));
  }
  if (skip.length) {
    L.push("");
    L.push("— 보강 미진행");
    skip.forEach((k) =>
      L.push(
        "  " +
          nm(k.studentId) +
          " · 결석 " +
          fmtMDDow(k.absentDate) +
          (k.parentContacted ? " (부모님 연락 완료)" : "")
      )
    );
  }
  return L.join("\n");
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* fall through */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* ignore */
  }
  document.body.removeChild(ta);
}
