import type { AttStatus, DataSnapshot } from "../types";
import { uid } from "./dates";

/** 보강 대기로 자동 등록되는 출결 상태 */
export const NEEDS_MAKEUP: AttStatus[] = ["결석", "무단결석", "조퇴"];

/**
 * 같은 날짜·학생에 이미 있는 '보강' 출결 키를 찾는다(키의 time 부분은 무엇이든).
 * 보강 완료 시 새 키로 중복 행을 만들지 않도록 기존 행을 재사용하기 위함.
 */
export function findBoKey(attendance: DataSnapshot["attendance"], date: string, sid: string): string | undefined {
  return Object.keys(attendance).find((key) => {
    const p = key.split("|");
    return p[0] === date && p[1] === sid && attendance[key].status === "보강";
  });
}

/** 출결 변경에 따라 보강 대기 자동 추가/제거. key = "YYYY-MM-DD|studentId|HH:MM" */
export function applyMakeup(d: DataSnapshot, key: string, studentId: string, duration: number, status: AttStatus) {
  const parts = key.split("|");
  const date = parts[0];
  const time = parts[2];
  const existing = d.makeups.find((m) => m.attKey === key);
  // (구) 결석 후속으로 강사 업무보드에 '보강 일정 잡기' 카드를 자동 생성하던 기능은 제거됨.
  // 기존에 자동 생성된 카드가 남아 있으면 정리(중복·잔재 제거).
  const taskSrc = "absence:" + key;
  if (d.tasks?.length) d.tasks = d.tasks.filter((t) => t.source !== taskSrc);
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
