// 공지 배너 + 오류·개선 요청 API.

import type { NoticeAudience } from "./notice";

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
  audience: NoticeAudience; // 노출 대상(전체/강사/학생/초등/중고등)
}
export interface IssueReply {
  id: string;
  issueId: string;
  authorSub: string;
  authorName: string;
  authorRole: string;
  text: string;
  shot?: string; // 답변 첨부 이미지(개선 결과 스크린샷 등)
  createdAt: number;
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
  reply: string; // (구) 단일 답변 — 스레드로 이관됨
  replyAt: number;
  seen: boolean; // 작성자가 답변·해결을 확인했는지
  status: string; // 접수 | 진행중 | 보류 | 완료
  createdAt: number;
  updatedAt: number;
  replies: IssueReply[]; // 작성자·시간이 남는 답변 스레드
}

export const ISSUE_STATUSES = ["접수", "진행중", "보류", "완료"];
/** '전체' 보기 정렬 순서: 접수 → 진행중 → 보류 → 완료. */
export const ISSUE_STATUS_ORDER: Record<string, number> = { 접수: 0, 진행중: 1, 해결중: 1, 보류: 2, 완료: 3 };
/** 오류 신고 시 고를 화면 목록 — 수학·영어·공통·데스크·학생 화면까지 폭넓게. */
export const ISSUE_PAGES = [
  "오늘", "출결", "숙제", "진도·교재관리", "테스트", "시간표", "보강관리", "대시보드", "월말리포트",
  "학생 명단", "포인트 랭킹", "메시지", "등하원",
  "데스크-전체시간표", "데스크-오늘", "데스크-계정", "강사 업무보드", "학원일정",
  "중고등영어", "초등영어", "학생 화면", "노션", "로그인", "기타",
];

export const feedbackApi = {
  /** 활성 공지 배너(모든 로그인). */
  notices: () => jget<{ notices: Notice[] }>("/api/notice").then((j) => j.notices),
  /** 전체 공지(원장). */
  noticesAll: () => jget<{ notices: Notice[] }>("/api/notice/all").then((j) => j.notices),
  saveNotice: (n: { id?: string; text: string; level: "info" | "warn"; active: boolean; audience?: NoticeAudience; startDate?: string; endDate?: string }) =>
    jpost("/api/notice", n),
  removeNotice: (id: string) => jpost("/api/notice/delete", { id }),

  /** 오류 요청 목록(원장 전체 / 그 외 본인). */
  issues: () => jget<{ issues: Issue[]; isAdmin: boolean }>("/api/issue"),
  createIssue: (i: { page: string; body: string; shot?: string; link?: string }) => jpost("/api/issue", i),
  setIssueStatus: (id: string, status: string) => jpost("/api/issue/status", { id, status }),
  replyIssue: (id: string, reply: string, shot?: string) => jpost("/api/issue/reply", { id, reply, shot }),
  removeReply: (id: string) => jpost("/api/issue/reply/delete", { id }),
  removeIssue: (id: string) => jpost("/api/issue/delete", { id }),
  /** 알림 개수(종) — 원장: 새 접수 / 그 외: 내 글 새 답변·해결. */
  issueUnseen: () => jget<{ count: number; kind: string }>("/api/issue/unseen"),
  /** 내 글 답변·해결 확인 처리. */
  markIssuesSeen: () => jpost("/api/issue/seen", {}),
};
