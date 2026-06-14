// 시간표 변경 요청 — 1회성 수업 이동을 '오늘'에 반영 · 충돌 감지 · 새 요청 프리필 브리지.
// 수학(store nav)과 허브(view nav) 양쪽에서 같은 방식으로 쓰기 위해 CustomEvent로 변경요청 화면을 연다.
import { useEffect, useState } from "react";
import { reqsApi, type ChangeReq } from "./hubApi";
import { DOW, parseD } from "./dates";

export type ReqSubject = "math" | "english";
export interface ReqPrefill {
  studentId: string;
  studentName: string;
  subject: ReqSubject;
  fromDate?: string;
  toDate?: string;
  fromTime?: string;
  toTime?: string;
}

export const NEW_REQ_EVENT = "bk:new-change-req";

/** 어느 화면에서든 변경요청 폼을 프리필해서 연다(헤더/Workspace가 받아 처리). */
export function openChangeRequest(prefill: ReqPrefill): void {
  window.dispatchEvent(new CustomEvent<ReqPrefill>(NEW_REQ_EVENT, { detail: prefill }));
}

/** 그 날짜에 영향을 주는 '승인된' 변경요청(원래날짜=date 또는 변경날짜=date). */
export function useApprovedChanges(date: string): ChangeReq[] {
  const [list, setList] = useState<ChangeReq[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      reqsApi
        .list()
        .then((rs) => {
          if (!alive) return;
          setList(rs.filter((r) => r.status === "approved" && (r.toDate === date || r.fromDate === date || r.changeDate === date)));
        })
        .catch(() => {});
    void load();
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [date]);
  return list;
}

/** 그 날짜에 '들어오는'(이 날로 옮겨온) 변경 — 그 학생을 그날 오늘에 추가. */
export function arrivalOf(changes: ChangeReq[], studentId: string, subject: ReqSubject, date: string): ChangeReq | null {
  return changes.find((c) => c.studentId === studentId && c.subject === subject && (c.toDate || c.changeDate) === date) || null;
}
/** 그 날짜에서 '나가는'(다른 날로 옮겨간) 변경 — 그 학생을 그날 원래 자리에서 제외. */
export function departureOf(changes: ChangeReq[], studentId: string, subject: ReqSubject, date: string): ChangeReq | null {
  return changes.find((c) => c.studentId === studentId && c.subject === subject && c.fromDate === date && (c.toDate || c.changeDate) !== date) || null;
}
/** 그 날짜로 옮겨온(원래 다른 날) 학생 목록 — 오늘 목록에 추가용. */
export function arrivalsOn(changes: ChangeReq[], subject: ReqSubject, date: string): ChangeReq[] {
  return changes.filter((c) => c.subject === subject && (c.toDate || c.changeDate) === date && c.fromDate && c.fromDate !== date);
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
