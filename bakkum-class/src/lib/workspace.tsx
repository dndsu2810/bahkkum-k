// 통합 사이드바 구성 — 로그인하면 역할별 사이드바가 바로 열린다.
// 수학 메뉴는 [수학 수업관리] 카테고리 안으로, 영어는 [영어 수업관리]로,
// 공통/원장 전용이 같은 사이드바에 카테고리로 함께.

import type { IconName } from "../icons";
import type { PageId } from "./nav";
import type { AuthUser } from "./roles";
import { areasForUser, shownRole } from "./roles";

/** 사이드바 항목. math는 기존 수학 페이지(store.page), hub는 허브 화면. */
export interface WsEntry {
  key: string;
  label: string;
  icon: IconName;
  kind: "math" | "hub";
  /** math일 때 매핑되는 수학 페이지. */
  page?: PageId;
}

export interface WsGroup {
  label?: string; // 카테고리 제목 (없으면 상단 무제목)
  entries: WsEntry[];
}

/* ---- 수학 수업관리 (기존 앱 메뉴 그대로) ---- */
const MATH: WsEntry[] = [
  { key: "today", label: "수학 오늘", icon: "today", kind: "math", page: "today" },
  { key: "classdash", label: "수학 대시보드", icon: "dashboard", kind: "math", page: "classdash" },
  { key: "timetable", label: "수학 시간표", icon: "cal", kind: "math", page: "timetable" },
  { key: "dashboard", label: "수학 강사 대시보드", icon: "chart", kind: "math", page: "dashboard" },
  { key: "attendance", label: "수학 출결 기록", icon: "clipboard", kind: "math", page: "attendance" },
  { key: "homework", label: "수학 숙제 기록", icon: "book", kind: "math", page: "homework" },
  { key: "progress", label: "수학 진도·교재관리", icon: "chart", kind: "math", page: "progress" },
  { key: "tests", label: "수학 테스트 기록", icon: "cap", kind: "math", page: "tests" },
  { key: "baseball", label: "수학 야구", icon: "baseball", kind: "math", page: "baseball" },
  { key: "students", label: "수학 학생 관리", icon: "students", kind: "math", page: "students" },
  { key: "makeup", label: "수학 보강 관리", icon: "refresh", kind: "math", page: "makeup" },
  { key: "report", label: "수학 월말리포트", icon: "fileText", kind: "math", page: "report" },
  { key: "plan", label: "연간 수업 계획표", icon: "cal", kind: "math", page: "plan" },
  { key: "timetable_sample", label: "통합 시간표(샘플)", icon: "calplus", kind: "math", page: "timetable_sample" },
];

/* ---- 학생 메시지 보내기 (원장·수학 담당) ---- */
const MSG: WsEntry = { key: "messages_send", label: "학생에게 메시지 보내기", icon: "megaphone", kind: "hub" };

/* ---- 영어 수업관리 (핵심부터) ---- */
function engEntries(band: "mid" | "elem"): WsEntry[] {
  const sfx = "_" + band;
  const list: WsEntry[] = [
    { key: "eng_today" + sfx, label: "영어 오늘", icon: "today", kind: "hub" },
    { key: "eng_tt" + sfx, label: "영어 시간표", icon: "cal", kind: "hub" },
    { key: "eng_att" + sfx, label: "영어 출결 기록", icon: "clipboard", kind: "hub" },
  ];
  // 초등영어는 숙제를 다루지 않는다 — 숙제 기록 메뉴는 중고등만.
  if (band === "mid") list.push({ key: "eng_hw" + sfx, label: "영어 숙제 기록", icon: "book", kind: "hub" });
  // 내신기간 모드 — 중고등만. 켜진 학생은 '오늘' 숙제가 자유입력+배부자료 기준으로.
  if (band === "mid") list.push({ key: "eng_naesin" + sfx, label: "영어 내신모드", icon: "cap", kind: "hub" });
  // 초등영어는 학생 화면에 커리큘럼이 보이므로, 그걸 수정하는 메뉴를 둔다.
  if (band === "elem") list.push(
    { key: "eng_cur" + sfx, label: "영어 오늘 뭐해요?", icon: "clipboard", kind: "hub" },
    { key: "eng_items" + sfx, label: "영어 오늘 한 것 수정", icon: "check", kind: "hub" }
  );
  list.push(
    { key: "eng_progress" + sfx, label: "영어 진도·교재관리", icon: "chart", kind: "hub" },
    { key: "eng_test" + sfx, label: "영어 테스트 기록", icon: "cap", kind: "hub" },
    // 학생 명단은 과목별로 나누지 않고 공통 「학생 명단」 하나로 단일화(단일 출처 원칙).
    { key: "eng_makeup" + sfx, label: "영어 보강 관리", icon: "refresh", kind: "hub" },
    { key: "eng_dash" + sfx, label: "영어 대시보드", icon: "dashboard", kind: "hub" }
  );
  return list;
}

const HOME: WsEntry = { key: "home", label: "홈", icon: "today", kind: "hub" };
const SCHEDULE: WsEntry = { key: "schedule_hub", label: "학원 일정", icon: "calplus", kind: "hub" };
const REQS: WsEntry = { key: "reqs", label: "시간표 변경", icon: "refresh", kind: "hub" };
const BOARD: WsEntry = { key: "board", label: "강사 업무 보드", icon: "board", kind: "hub" };
const NOTICES: WsEntry = { key: "notices", label: "공지사항", icon: "megaphone", kind: "hub" };
const WIKI: WsEntry = { key: "wiki", label: "바꿈 매뉴얼", icon: "book", kind: "hub" };
const SNS: WsEntry = { key: "sns", label: "SNS 관리", icon: "copy", kind: "hub" };
const MASTER: WsEntry = { key: "master", label: "학생 명단", icon: "students", kind: "hub" };
const RANKING: WsEntry = { key: "ranking", label: "포인트 랭킹", icon: "chart", kind: "hub" };
const MATERIALS: WsEntry = { key: "materials", label: "자료 배부", icon: "copy", kind: "hub" };
const ENGREPORT: WsEntry = { key: "engreport", label: "영어 월말리포트", icon: "fileText", kind: "hub" };
const ISSUES: WsEntry = { key: "issues", label: "오류·개선 요청", icon: "clipboard", kind: "hub" };
const CHECKIN: WsEntry = { key: "checkin", label: "등하원", icon: "today", kind: "hub" };
const ORDERS: WsEntry = { key: "orders", label: "주문 관리", icon: "copy", kind: "hub" };
const CHECKIN_REPORT: WsEntry = { key: "checkin_report", label: "수업시간 리포트", icon: "chart", kind: "hub" };
const GUIDE: WsEntry = { key: "guide", label: "사용 가이드", icon: "book", kind: "hub" };
const MEETINGS: WsEntry = { key: "meetings", label: "회의록", icon: "minutes", kind: "hub" };
const MAKEUP_ALL: WsEntry = { key: "makeup_all", label: "통합 보강관리", icon: "refresh", kind: "hub" };
const ACCOUNTS: WsEntry = { key: "accounts", label: "강사 관리", icon: "users", kind: "hub" };
const ADMIN_DASH: WsEntry = { key: "admin_dash", label: "원장 대시보드", icon: "dashboard", kind: "hub" };
const SETTINGS: WsEntry = { key: "settings", label: "설정", icon: "gear", kind: "hub" };

// 전체 시간표(공통) — 수학·영어 통합. 데스크 전용이던 화면을 모든 스태프 공통으로.
const ALL_TT: WsEntry = { key: "all_timetable", label: "전체 시간표", icon: "cal", kind: "hub" };
// 강사 정보 안내(공통) — 강사명·담당과목·추가 업무담당·전화번호. 데스크 '강사 계정 리스트'를 대체.
const TEACHER_GUIDE: WsEntry = { key: "teacher_guide", label: "강사 정보 안내", icon: "users", kind: "hub" };

/** 역할·배정에 따라 이 사용자의 사이드바 그룹을 만든다. */
export function sidebarFor(user: AuthUser): WsGroup[] {
  const areas = new Set(areasForUser(user));
  const role = user.role;
  const groups: WsGroup[] = [];

  // 상단(무제목): 홈 + 학원 일정(공용)
  const top: WsEntry[] = [HOME, SCHEDULE];
  top.push(NOTICES); // 공지사항 — 모든 스태프.
  groups.push({ entries: top });

  // 수학 수업관리 — 강사 업무 보드를 이 그룹 맨 위로(수학·원장만 열람).
  if (areas.has("math")) {
    const mathEntries = areas.has("board") ? [BOARD, ...MATH] : MATH;
    groups.push({ label: "수학 수업관리", entries: mathEntries });
  }

  // 영어 수업관리 — 영어 강사 + 원장(전체 열람). 원장은 초등·중고등 모두 본다.
  if (role === "english_mid" || role === "admin") groups.push({ label: "영어 수업관리 (중고등)", entries: engEntries("mid") });
  // 월말리포트(초등 전용)는 초등 영어 그룹 안에.
  if (role === "english_elem" || role === "admin") groups.push({ label: "영어 수업관리 (초등)", entries: [...engEntries("elem"), ENGREPORT] });

  // 데스크 전용 그룹은 없앴다 — 필요한 정보(전체 시간표·학생 명단·강사 정보 안내)는 모두 '공통'에 있다.

  // 공통 — 학생 명단(전과목 공통)·변경요청·특이사항·매뉴얼·SNS
  const common: WsEntry[] = [];
  if (areas.has("students")) common.push(MASTER);
  common.push(ALL_TT); // 전체 시간표(수학·영어 통합) — 모든 스태프 공통.
  common.push(TEACHER_GUIDE); // 강사 정보 안내 — 모든 스태프 공통(데스크 '강사 계정 리스트' 대체).
  common.push(RANKING); // 포인트 랭킹 안에 '포인트 항목' 점수 편집이 들어있음(별도 메뉴 없앰).
  // 자료 배부 — 강사·원장 공용(수학·영어 모두 같은 화면).
  const isTeacher = role === "admin" || areas.has("math") || role === "english_mid" || role === "english_elem";
  if (isTeacher) common.push(MATERIALS);
  common.push(ORDERS); // 교재·비품 주문 관리 — 공통(모든 스태프).
  if (isTeacher) common.push(MAKEUP_ALL); // 통합 보강관리 — 수학·영어 보강 모아보기(강사·원장).
  common.push(REQS);
  if (areas.has("wiki")) common.push(WIKI);
  if (areas.has("sns")) common.push(SNS);
  common.push(MEETINGS); // 회의록 — 음성/텍스트 AI 요약(모든 스태프).
  common.push(ISSUES); // 오류·개선 요청 — 모두 접근.
  common.push(GUIDE); // 사용 가이드 — 역할별 안내(모두 접근).
  if (common.length) groups.push({ label: "공통", entries: common });

  // 등하원 — 공통 카테고리(모든 스태프). 관리·발송 + 수업시간 리포트.
  groups.push({ label: "등하원", entries: [CHECKIN, CHECKIN_REPORT] });

  // 학생 메시지 — 원장·수학 담당 공통, 별도 카테고리(동일 위치).
  if (role === "admin" || role === "math") groups.push({ label: "학생 메시지", entries: [MSG] });

  // 원장 전용
  if (role === "admin") {
    groups.push({ label: "원장 전용", entries: [ADMIN_DASH, ACCOUNTS, SETTINGS] });
  }

  return groups;
}

/** 로그인 직후 기본 진입 항목. */
export function defaultEntry(user: AuthUser): string {
  // 원장(정민아 · 중고등 영어 담당)은 중고등 영어 '오늘'로 직행.
  // 개발자(displayRole="developer", 수학 강사 겸임)는 원장이 아니므로 아래 수학 분기로.
  if (shownRole(user) === "admin") return "eng_today_mid";
  if (areasForUser(user).includes("math")) return "today";
  if (user.role === "english_mid") return "eng_today_mid";
  if (user.role === "english_elem") return "eng_today_elem";
  if (user.role === "desk") return "desk_today";
  return "home";
}

/** 담당 표시 문구 — 로고 아래 한 줄. 예: "수학 · 원장". */
export function dutyLabel(user: AuthUser): string {
  switch (user.role) {
    case "admin":
      return "수학 · 원장";
    case "math":
      return "수학";
    case "english_mid":
      return "영어 중고등";
    case "english_elem":
      return "영어 초등";
    case "desk":
      return "데스크";
    default:
      return "";
  }
}
