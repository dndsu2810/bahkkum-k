// 시간표 변경 요청 — '오늘/시간표'에서의 임시 반영(승인 배지) · 충돌 감지 · 새 요청 프리필 브리지.
// 수학(store nav)과 허브(view nav) 양쪽에서 같은 방식으로 쓰기 위해 CustomEvent로 변경요청 화면을 연다.
import { useEffect, useState } from "react";
import { reqsApi, type ChangeReq } from "./hubApi";
import { DOW, parseD } from "./dates";

export type ReqSubject = "math" | "english";
export interface ReqPrefill {
  studentId: string;
  studentName: string;
  subject: ReqSubject;
  changeDate: string;
  fromTime?: string;
  toTime?: string;
}

export const NEW_REQ_EVENT = "bk:new-change-req";

/** 어느 화면에서든 변경요청 폼을 프리필해서 연다(헤더/Workspace가 받아 처리). */
export function openChangeRequest(prefill: ReqPrefill): void {
  window.dispatchEvent(new CustomEvent<ReqPrefill>(NEW_REQ_EVENT, { detail: prefill }));
}

/** 선택 날짜에 '승인된' 변경요청만. 학생별 임시 시간 변경 반영용. */
export function useApprovedChanges(date: string): ChangeReq[] {
  const [list, setList] = useState<ChangeReq[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      reqsApi
        .list()
        .then((rs) => { if (alive) setList(rs.filter((r) => r.status === "approved" && r.changeDate === date)); })
        .catch(() => {});
    void load();
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [date]);
  return list;
}

/** 한 학생의 그 날짜 승인된 변경(과목별). 없으면 null. */
export function approvedFor(changes: ChangeReq[], studentId: string, subject: ReqSubject): ChangeReq | null {
  return changes.find((c) => c.studentId === studentId && c.subject === subject) || null;
}

export interface SlotConflict {
  studentId: string;
  studentName: string;
  time: string;
  mathTime: string;
  engTime: string;
}

/** 그 날짜(요일)에 한 학생의 수학·영어 수업 시간이 같은(겹치는) 경우를 찾는다. */
export function findSlotConflicts(
  roster: { id: string; name: string; mathSlots: { day: string; time: string }[]; engSlots: { day: string; time: string }[] }[],
  date: string
): SlotConflict[] {
  const dow = DOW[parseD(date).getDay()];
  const out: SlotConflict[] = [];
  for (const s of roster) {
    const mTimes = s.mathSlots.filter((x) => x.day === dow).map((x) => x.time);
    const eTimes = s.engSlots.filter((x) => x.day === dow).map((x) => x.time);
    const clash = mTimes.find((t) => eTimes.includes(t));
    if (clash) out.push({ studentId: s.id, studentName: s.name, time: clash, mathTime: clash, engTime: clash });
  }
  return out;
}
