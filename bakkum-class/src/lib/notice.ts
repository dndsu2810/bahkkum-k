// 공지·배너 노출 대상(audience) — 공지사항 게시판·원장 공지 배너 공용.
// 클라(선택지·라벨)와 워커(노출 필터)가 같은 정의를 쓴다.

export type NoticeAudience = "all" | "staff" | "students" | "elem" | "mid" | "math";

export const NOTICE_AUDIENCES: { v: NoticeAudience; label: string; hint: string }[] = [
  { v: "all", label: "전체", hint: "강사·학생 모두에게 보여요" },
  { v: "staff", label: "강사만", hint: "학생에게는 안 보여요" },
  { v: "students", label: "학생 전체", hint: "초등·중고등 모든 학생" },
  { v: "elem", label: "초등영어 학생만", hint: "초등영어 학생에게만" },
  { v: "mid", label: "중고등영어 학생만", hint: "중고등영어 학생에게만" },
  { v: "math", label: "수학 학생만", hint: "수학 듣는 학생에게만" },
];

const ALL: NoticeAudience[] = ["all", "staff", "students", "elem", "mid", "math"];

export function normalizeAudience(a: unknown): NoticeAudience {
  const v = String(a) as NoticeAudience;
  return ALL.includes(v) ? v : "staff";
}

export function audienceLabel(a: string): string {
  return NOTICE_AUDIENCES.find((x) => x.v === a)?.label ?? "강사만";
}

/** 이 공지/배너가 보는 사람에게 노출되는가.
 *  학생이면 영어 band(elem/mid/bridge) 또는 수학 수강 여부(isMath)로 더 거른다. */
export function noticeVisible(audience: string, opts: { isStudent: boolean; band?: string; isMath?: boolean }): boolean {
  if (audience === "all") return true;
  if (!opts.isStudent) return audience === "staff"; // 스태프: 전체 + 강사만
  const band = opts.band || "";
  if (audience === "students") return true;
  if (audience === "elem") return band === "elem";
  if (audience === "mid") return band === "mid" || band === "bridge";
  if (audience === "math") return !!opts.isMath; // 수학 듣는 학생만
  return false; // staff 전용 → 학생은 못 봄
}
