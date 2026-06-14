// 허브 공유 영역 API — 특이사항 · 위키 · SNS · 공유 업무 보드.

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}
async function jpost(url: string, body: unknown): Promise<{ ok?: boolean; id?: string; error?: string }> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

/** 이미지 업로드 → 저장된 URL 반환. */
export async function uploadImage(file: File): Promise<string> {
  const r = await fetch("/api/upload", {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!r.ok || !j.url) throw new Error(j.error || "upload_failed");
  return j.url;
}

/* ---------------- 특이사항 ---------------- */
export interface NoteItem {
  id: string;
  studentId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
}
export const notesApi = {
  list: (studentId?: string) =>
    jget<{ notes: NoteItem[] }>("/api/notes" + (studentId ? "?student_id=" + encodeURIComponent(studentId) : "")).then(
      (j) => j.notes
    ),
  add: (studentId: string, body: string) => jpost("/api/notes", { studentId, body }),
  remove: (id: string) => jpost("/api/notes/delete", { id }),
};

/* ---------------- 매뉴얼 위키 ---------------- */
export type WikiStatus = "draft" | "writing" | "review" | "current" | "outdated";
export interface WikiPage {
  id: string;
  title: string;
  body: string;
  importance: number; // 1~4
  status: WikiStatus;
  images: string[];
  updatedBy: string;
  updatedAt: number;
}
export const wikiApi = {
  list: () => jget<{ pages: WikiPage[] }>("/api/wiki").then((j) => j.pages),
  save: (p: { id?: string; title: string; body: string; importance: number; status: WikiStatus; images?: string[] }) =>
    jpost("/api/wiki", p),
  remove: (id: string) => jpost("/api/wiki/delete", { id }),
  /** 노션 '바꿈 매뉴얼' → 앱 위키 전체 재동기화(원장 전용). 하위 DB 포함. */
  sync: () => jpost("/api/sync/wiki", {}),
};

/* ---------------- SNS 관리 ---------------- */
export type SnsStatus = "wait" | "edit" | "stop" | "done";
export interface SnsPost {
  id: string;
  title: string;
  body: string;
  channel: string;
  authorName: string;
  status: SnsStatus;
  link: string;
  images: string[];
  createdAt: number;
  updatedAt: number;
}
export const snsApi = {
  list: () => jget<{ posts: SnsPost[] }>("/api/sns").then((j) => j.posts),
  save: (p: { id?: string; title: string; body: string; channel: string; status: SnsStatus; link: string; images?: string[] }) =>
    jpost("/api/sns", p),
  remove: (id: string) => jpost("/api/sns/delete", { id }),
};

/* ---------------- 공유 업무 보드 ---------------- */
export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "urgent" | "normal";
export interface BoardTask {
  id: string;
  title: string;
  status: TaskStatus;
  tag: string;
  due: string;
  studentId: string;
  memo: string;
  assignee: string; // 담당자(강사 이름)
  priority: TaskPriority; // 급한 일 / 일반
  source: string;
  createdAt: number;
  doneAt: number | null;
  archived: boolean;
}
export const tasksApi = {
  list: () => jget<{ tasks: BoardTask[] }>("/api/tasks").then((j) => j.tasks),
  save: (t: Partial<BoardTask> & { title: string }) => jpost("/api/tasks", t),
  remove: (id: string) => jpost("/api/tasks/delete", { id }),
};

/* ---------------- 학원 일정 (공용) ---------------- */
export interface EventItem {
  id: string;
  date: string; // YYYY-MM-DD
  endDate: string; // 비면 단일일
  title: string;
  category: string; // 학원·학교·강사·휴원·할일 등
  memo: string;
  authorId: string;
  authorName: string;
  updatedAt: number;
}
export const eventsApi = {
  list: (since?: string) =>
    jget<{ events: EventItem[] }>("/api/events" + (since ? "?since=" + since : "")).then((j) => j.events),
  save: (e: { id?: string; date: string; endDate?: string; title: string; category?: string; memo?: string }) =>
    jpost("/api/events", e),
  remove: (id: string) => jpost("/api/events/delete", { id }),
  /** 노션 '학원 일정' → 앱으로 1회 가져오기(원장 전용). */
  sync: () => jpost("/api/sync/events", {}),
};

/* ---------------- 시간표 변경 요청 ---------------- */
export interface ChangeReq {
  id: string;
  studentId: string;
  studentName: string;
  subject: string; // math | english
  changeDate: string; // YYYY-MM-DD
  fromTime: string;
  toTime: string;
  reason: string;
  requesterId: string;
  requesterName: string;
  targetId: string;
  targetName: string;
  status: string; // pending | approved | rejected
  response: string;
  createdAt: number;
  updatedAt: number;
}
export const reqsApi = {
  list: () => jget<{ reqs: ChangeReq[] }>("/api/reqs").then((j) => j.reqs),
  create: (r: {
    studentId: string; studentName: string; subject: string; changeDate: string;
    fromTime?: string; toTime: string; reason?: string; targetId?: string; targetName?: string;
  }) => jpost("/api/reqs", r),
  respond: (id: string, status: "approved" | "rejected", response?: string) =>
    jpost("/api/reqs/respond", { id, status, response }),
};
