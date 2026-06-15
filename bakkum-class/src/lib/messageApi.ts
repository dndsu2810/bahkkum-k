// 학생 메시지(알림) API — 선생님(원장·수학)→학생 단방향, 학생 답장 1회.

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}
async function jpost<T = { ok?: boolean; error?: string }>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

export interface Message {
  id: string;
  batchId: string;
  senderSub: string;
  senderName: string;
  senderRole: string;
  recipientId: string;
  recipientName: string;
  body: string;
  createdAt: number;
  readAt: number; // 0=안읽음
  replyBody: string;
  replyAt: number; // 0=답장없음
}

export const messageApi = {
  /** 발송 대상 후보 — 개별 로그인 가능한 학생 전체(과목 무관). */
  students: () => jget<{ students: { id: string; name: string; grade: string }[] }>("/api/messages/students").then((j) => j.students),
  /** 발송(원장·수학) — 학생 1명당 1건 개별 생성. */
  send: (recipients: { id: string; name: string }[], body: string) =>
    jpost<{ ok?: boolean; count?: number; error?: string }>("/api/messages/send", { recipients, body }),
  /** 내가 보낸 메시지(원장·수학). */
  sent: () => jget<{ messages: Message[] }>("/api/messages/sent").then((j) => j.messages),
  /** 아직 확인 안 한 학생 답장 수(사이드바 배지). */
  replyCount: () => jget<{ count: number }>("/api/messages/replies/count").then((j) => j.count),
  /** 답장 확인 처리(발송 화면 열 때). */
  markRepliesSeen: () => jpost("/api/messages/replies/seen", {}),

  /** 받은 메시지(학생 본인). */
  inbox: () => jget<{ messages: Message[] }>("/api/messages/inbox").then((j) => j.messages),
  /** 안읽음 수(종 배지용). */
  unread: () => jget<{ count: number }>("/api/messages/unread").then((j) => j.count),
  /** 읽음 처리. */
  read: (id: string) => jpost("/api/messages/read", { id }),
  /** 답장 1회. */
  reply: (id: string, body: string) => jpost("/api/messages/reply", { id, body }),
};
