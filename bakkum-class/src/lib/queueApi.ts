// 번호표(대기순번)·호출 클라 API.

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}
async function jpost<T = { ok?: boolean }>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

export type QueueSubject = "english" | "math";
export interface MyTicket { number: number; status: "waiting" | "called" | "done"; ahead: number; raised: boolean; calledAt: number }
export interface MineResp { subjects: QueueSubject[]; tickets: Partial<Record<QueueSubject, MyTicket | null>> }
export interface QueueRow { id: string; number: number; name: string; status: "waiting" | "called"; raised: boolean }

export const SUBJECT_LABEL: Record<QueueSubject, string> = { english: "영어", math: "수학" };

export const queueApi = {
  /** 학생 — 내 과목별 번호표 상태. */
  mine: () => jget<MineResp>("/api/queue/mine"),
  /** 학생 — 번호 뽑기(이미 있으면 그대로). */
  draw: (subject: QueueSubject) => jpost<{ ticket: MyTicket | null }>("/api/queue/draw", { subject }),
  /** 학생 — 손들기(강사 호출). */
  raise: (subject: QueueSubject) => jpost("/api/queue/raise", { subject }),
  /** 학생 — 내 번호표 취소. */
  cancel: (subject: QueueSubject) => jpost("/api/queue/cancel", { subject }),

  /** 강사 — 과목 대기열(오늘). */
  list: (subject: QueueSubject) => jget<{ list: QueueRow[] }>("/api/queue/list?subject=" + subject).then((j) => j.list),
  /** 강사 — 호출(차례). */
  call: (id: string) => jpost("/api/queue/call", { id }),
  /** 강사 — 호출 취소(대기로). */
  wait: (id: string) => jpost("/api/queue/wait", { id }),
  /** 강사 — 완료(줄에서 제거). */
  done: (id: string) => jpost("/api/queue/done", { id }),
};
