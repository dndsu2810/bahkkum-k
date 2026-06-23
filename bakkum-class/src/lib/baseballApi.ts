// 수학 야구(수학 전광판) 클라 API — 선생님 관리 화면용.
// 계산은 서버가 src/lib/baseball.ts로 끝내서 board를 그대로 내려준다.

import type { BaseballRule, BaseballConfig, MathBoard, EventKind } from "./baseball";

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}
async function jsend<T = { ok?: boolean }>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

export interface LogEntry {
  id: string; // 자동: 파생 id / 수동: 이벤트 id
  source: "auto" | "manual";
  kind: string; // strike|ball|cancel_strike|exempt_out|makeup_done
  label: string;
  date: string;
  points: number;
  ignored: boolean; // 자동 스트라이크가 무효화됨
  ignoreEventId: string; // 무효화 이벤트 id(되돌리기용)
  memo: string;
}
export interface ClassRow {
  id: string;
  name: string;
  grade: string;
  board: MathBoard;
  log: LogEntry[];
}
export interface ClassResp {
  rules: BaseballRule[];
  cfg: BaseballConfig;
  students: ClassRow[];
}

export interface NewEvent {
  studentId: string;
  kind: EventKind;
  points?: number;
  label?: string;
  ref?: string;
  memo?: string;
}

export const baseballApi = {
  /** 반 전체 현황 + 규칙 + 기준값(선생님). */
  classView: () => jget<ClassResp>("/api/baseball/class"),
  /** 한 학생 전광판(선생님은 student_id, 학생 본인은 생략). 학생 사진(photo)도 함께. */
  board: (sid?: string) => jget<{ board: MathBoard | null; photo?: string }>("/api/baseball/board" + (sid ? "?student_id=" + encodeURIComponent(sid) : "")),
  /** 규칙·기준값 저장(전체 교체). */
  saveRules: (rules: BaseballRule[], cfg?: Partial<BaseballConfig>) => jsend("/api/baseball/rules", "POST", { rules, cfg }),
  /** 이벤트 추가(볼 주기·취소·면제·보충완료·자동무효화). */
  addEvent: (e: NewEvent) => jsend<{ ok?: boolean; id?: string }>("/api/baseball/event", "POST", e),
  /** 이벤트 수정(사유·메모·가중치). */
  editEvent: (id: string, patch: { points?: number; label?: string; memo?: string }) => jsend("/api/baseball/event", "PUT", { id, ...patch }),
  /** 이벤트 삭제. */
  delEvent: (id: string) => jsend("/api/baseball/event?id=" + encodeURIComponent(id), "DELETE"),
};
