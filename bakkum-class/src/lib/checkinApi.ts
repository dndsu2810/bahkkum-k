// 등하원(체크인) API.

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

export interface CheckinRow {
  id: string;
  studentId: string;
  name: string;
  grade: string;
  date: string;
  kind: "등원" | "하원";
  subject: string; // 영어 | 수학 | ""
  time: string;
  sent: boolean;
  sentAt: number;
  corrected: boolean;
}
export interface CheckinStudent { id: string; name: string; grade: string; subjects: string[] }

export const checkinApi = {
  // 키오스크(공개)
  lookup: (code: string) => jget<{ found: boolean; student?: CheckinStudent }>(`/api/checkin/lookup?code=${encodeURIComponent(code)}`),
  punch: (code: string, subject: string, kind: string) =>
    jpost<{ ok: boolean; name?: string; grade?: string; subject?: string; kind?: string; time?: string; error?: string }>("/api/checkin/punch", { code, subject, kind }),
  // 선생님 관리
  today: (date?: string) => jget<{ date: string; list: CheckinRow[]; summary: { arrive: number; leave: number; unsent: number } }>(`/api/checkin${date ? `?date=${date}` : ""}`),
  days: () => jget<{ days: { date: string; count: number; unsent: number }[] }>("/api/checkin/days"),
  setTime: (id: string, time: string) => jpost("/api/checkin/time", { id, time }),
  send: (id: string) => jpost<{ ok: boolean; template?: string; testMode?: boolean }>("/api/checkin/send", { id }),
  // 학생 상세 이력(조회용)
  student: (studentId: string) => jget<{ history: CheckinRow[] }>(`/api/checkin/student?studentId=${encodeURIComponent(studentId)}`),
};
