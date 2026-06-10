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
    // 사용자가 이 결석의 보강을 직접 삭제(tombstone)했으면 자동 재등록하지 않는다.
    if (d.dismissedMakeups?.includes(key)) return;
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
  } else {
    // 결석이 아니게 되면 자동 보강 제거 + 삭제표시도 해제(이후 다시 결석 시 정상 등록).
    if (existing && existing.status === "pending") d.makeups = d.makeups.filter((m) => m.attKey !== key);
    if (d.dismissedMakeups?.length) d.dismissedMakeups = d.dismissedMakeups.filter((k) => k !== key);
  }
}
