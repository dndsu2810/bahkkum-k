import type { AttStatus, DataSnapshot } from "../types";
import { uid } from "./dates";

/** 보강 대기로 자동 등록되는 출결 상태 */
export const NEEDS_MAKEUP: AttStatus[] = ["결석", "무단결석", "조퇴"];

/** 출결 변경에 따라 보강 대기 자동 추가/제거. key = "YYYY-MM-DD|studentId|HH:MM" */
export function applyMakeup(d: DataSnapshot, key: string, studentId: string, duration: number, status: AttStatus) {
  const parts = key.split("|");
  const date = parts[0];
  const time = parts[2];
  const existing = d.makeups.find((m) => m.attKey === key);
  if (NEEDS_MAKEUP.includes(status)) {
    if (!existing) {
      d.makeups.push({
        id: uid(),
        studentId,
        absentDate: date,
        absentTime: time,
        absentDuration: duration,
        attKey: key,
        status: "pending",
        makeupDate: "",
        makeupTime: "",
        makeupDuration: duration,
        parentContacted: false,
        memo: status === "결석" ? "" : status,
        createdAt: Date.now(),
      });
    }
  } else if (existing && existing.status === "pending") {
    d.makeups = d.makeups.filter((m) => m.attKey !== key);
  }
}
