// 회의록 API — 종류·회의안·목록·상세·AI 요약(음성/텍스트)·저장(생성/수정)·삭제.

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}
async function jpost<T = { ok?: boolean; id?: number; error?: string }>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

export interface MeetingListItem {
  id: number;
  title: string;
  category: string;
  meetingDate: string;
  attendees: string;
  status: string; // 예정 | 완료
  createdBy: string;
  createdAt: number;
  hasSummary: boolean;
  studentId?: string; // 연계 학생(학부모 상담 회의록)
}
export interface MeetingDetail extends MeetingListItem {
  agenda: string; // 회의안(리치 HTML)
  rawText: string;
  summary: string;
  attendeeSubs: string[];
  createdSub: string;
}

export interface SaveMeetingInput {
  id?: number;
  title: string;
  category?: string;
  meetingDate: string;
  attendees?: string;
  attendeeSubs?: string[];
  agenda?: string;
  rawText?: string;
  summary?: string;
  studentId?: string; // 연계 학생
}

export const meetingApi = {
  /** 회의 종류 목록(기본+커스텀). */
  categories: () => jget<{ categories: string[] }>("/api/meetings/categories").then((j) => j.categories),
  /** 회의 종류 추가. */
  addCategory: (name: string) => jpost<{ ok?: boolean; categories: string[] }>("/api/meetings/categories", { name }),
  /** 내가 볼 수 있는 회의록 목록(날짜 역순). */
  list: () => jget<{ meetings: MeetingListItem[] }>("/api/meetings").then((j) => j.meetings),
  /** 특정 학생에 연계된 회의록(학부모 상담 등). */
  byStudent: (studentId: string) => jget<{ meetings: MeetingListItem[] }>("/api/meetings?student_id=" + encodeURIComponent(studentId)).then((j) => j.meetings),
  /** 회의록 상세. */
  get: (id: number) => jget<{ meeting: MeetingDetail }>(`/api/meetings/${id}`).then((j) => j.meeting),
  /** 음성 파일 또는 텍스트 → AI 요약(저장 전 미리보기). 회의안 평문을 함께 보내면 요약에 반영. */
  async transcribe(input: { audio?: File | null; text?: string; agenda?: string }): Promise<{ rawText: string; summary: string; notice?: string }> {
    const fd = new FormData();
    if (input.audio) fd.append("audio", input.audio);
    if (input.text) fd.append("text", input.text);
    if (input.agenda) fd.append("agenda", input.agenda);
    const r = await fetch("/api/meetings/transcribe", { method: "POST", body: fd });
    const j = (await r.json().catch(() => ({}))) as { rawText?: string; summary?: string; notice?: string; error?: string };
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return { rawText: j.rawText || "", summary: j.summary || "", notice: j.notice };
  },
  /** 저장 — id 없으면 생성, 있으면 수정. */
  save: (m: SaveMeetingInput) => jpost<{ ok?: boolean; id?: number }>("/api/meetings", m),
  /** 삭제. */
  remove: (id: number) => jpost("/api/meetings/delete", { id }),
};
