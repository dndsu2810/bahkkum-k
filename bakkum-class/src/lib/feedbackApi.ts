// 공지 배너 + 오류·개선 요청 API.

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}
async function jpost<T = { ok?: boolean; id?: string; error?: string }>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

export interface Notice {
  id: string;
  text: string;
  level: "info" | "warn";
  active: boolean;
  startDate: string;
  endDate: string;
  createdAt: number;
  createdBy: string;
}
export interface Issue {
  id: string;
  page: string;
  authorSub: string;
  authorName: string;
  authorRole: string;
  body: string;
  shot: string;
  status: string; // 접수 | 해결중 | 완료
  createdAt: number;
  updatedAt: number;
}

export const ISSUE_STATUSES = ["접수", "해결중", "완료"];
/** 오류 신고 시 고를 화면 목록(군더더기 없이 핵심만). */
export const ISSUE_PAGES = ["오늘", "출결", "숙제", "시간표", "학생 명단", "월말리포트", "학생 화면", "로그인", "기타"];

export const feedbackApi = {
  /** 활성 공지 배너(모든 로그인). */
  notices: () => jget<{ notices: Notice[] }>("/api/notice").then((j) => j.notices),
  /** 전체 공지(원장). */
  noticesAll: () => jget<{ notices: Notice[] }>("/api/notice/all").then((j) => j.notices),
  saveNotice: (n: { id?: string; text: string; level: "info" | "warn"; active: boolean; startDate?: string; endDate?: string }) =>
    jpost("/api/notice", n),
  removeNotice: (id: string) => jpost("/api/notice/delete", { id }),

  /** 오류 요청 목록(원장 전체 / 그 외 본인). */
  issues: () => jget<{ issues: Issue[]; isAdmin: boolean }>("/api/issue"),
  createIssue: (i: { page: string; body: string; shot?: string }) => jpost("/api/issue", i),
  setIssueStatus: (id: string, status: string) => jpost("/api/issue/status", { id, status }),
  removeIssue: (id: string) => jpost("/api/issue/delete", { id }),
};
