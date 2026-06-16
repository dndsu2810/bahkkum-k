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
  audience: "all" | "staff"; // all=학생 포함 전체, staff=강사만
}
export interface Issue {
  id: string;
  page: string;
  authorSub: string;
  authorName: string;
  authorRole: string;
  body: string;
  shot: string;
  link: string; // 어디가 문제인지 링크
  reply: string; // 지현T 답변
  replyAt: number;
  seen: boolean; // 작성자가 답변·해결을 확인했는지
  status: string; // 접수 | 해결중 | 완료
  createdAt: number;
  updatedAt: number;
}

export const ISSUE_STATUSES = ["접수", "해결중", "완료"];
/** 오류 신고 시 고를 화면 목록(군더더기 없이 핵심만). 노션도 포함. */
export const ISSUE_PAGES = ["오늘", "출결", "숙제", "시간표", "학생 명단", "월말리포트", "학생 화면", "노션", "로그인", "기타"];

export const feedbackApi = {
  /** 활성 공지 배너(모든 로그인). */
  notices: () => jget<{ notices: Notice[] }>("/api/notice").then((j) => j.notices),
  /** 전체 공지(원장). */
  noticesAll: () => jget<{ notices: Notice[] }>("/api/notice/all").then((j) => j.notices),
  saveNotice: (n: { id?: string; text: string; level: "info" | "warn"; active: boolean; audience?: "all" | "staff"; startDate?: string; endDate?: string }) =>
    jpost("/api/notice", n),
  removeNotice: (id: string) => jpost("/api/notice/delete", { id }),

  /** 오류 요청 목록(원장 전체 / 그 외 본인). */
  issues: () => jget<{ issues: Issue[]; isAdmin: boolean }>("/api/issue"),
  createIssue: (i: { page: string; body: string; shot?: string; link?: string }) => jpost("/api/issue", i),
  setIssueStatus: (id: string, status: string) => jpost("/api/issue/status", { id, status }),
  replyIssue: (id: string, reply: string) => jpost("/api/issue/reply", { id, reply }),
  removeIssue: (id: string) => jpost("/api/issue/delete", { id }),
  /** 알림 개수(종) — 원장: 새 접수 / 그 외: 내 글 새 답변·해결. */
  issueUnseen: () => jget<{ count: number; kind: string }>("/api/issue/unseen"),
  /** 내 글 답변·해결 확인 처리. */
  markIssuesSeen: () => jpost("/api/issue/seen", {}),
};
