import type { IconName } from "../icons";

export type PageId =
  | "today"
  | "board"
  | "dashboard"
  | "schedule"
  | "attendance"
  | "students"
  | "timetable"
  | "makeup"
  | "homework"
  | "progress"
  | "tests"
  | "report"
  | "plan"
  | "settings";

export interface NavItem {
  id: PageId;
  label: string;
  icon: IconName;
}

export const ALL_NAV: NavItem[] = [
  { id: "today", label: "오늘", icon: "today" },
  { id: "board", label: "강사 업무", icon: "board" },
  { id: "dashboard", label: "대시보드", icon: "dashboard" },
  { id: "schedule", label: "학원 일정", icon: "calplus" },
  { id: "attendance", label: "출결 기록", icon: "clipboard" },
  { id: "students", label: "학생 관리", icon: "students" },
  { id: "timetable", label: "시간표", icon: "cal" },
  { id: "makeup", label: "보강 관리", icon: "refresh" },
  { id: "homework", label: "숙제 기록", icon: "book" },
  { id: "progress", label: "진도 기록", icon: "chart" },
  { id: "tests", label: "테스트 기록", icon: "cap" },
  { id: "report", label: "월말리포트", icon: "fileText" },
  { id: "settings", label: "설정", icon: "gear" },
];

/** 숨기거나 순서를 바꿀 수 없는 메뉴 */
export const ALWAYS: PageId[] = ["today", "settings"];

/** 사이드바 그룹(메인/수업/관리) — 표시용. 그룹 안에서는 사용자 순서를 따른다. */
export type NavGroup = "메인" | "수업 기록" | "관리";
export const GROUP_ORDER: NavGroup[] = ["메인", "수업 기록", "관리"];
export const GROUP_OF: Record<PageId, NavGroup> = {
  today: "메인",
  board: "메인",
  dashboard: "메인",
  schedule: "메인",
  attendance: "수업 기록",
  homework: "수업 기록",
  progress: "수업 기록",
  tests: "수업 기록",
  students: "관리",
  timetable: "메인",
  makeup: "관리",
  report: "관리",
  plan: "관리",
  settings: "관리",
};

/** 페이지 라벨(브레드크럼·제목용). */
export function navLabel(id: PageId): string {
  return ALL_NAV.find((n) => n.id === id)?.label ?? "";
}

export interface NavPrefs {
  order: PageId[];
  hidden: PageId[];
  /** 즐겨찾기한 메뉴 — 사이드바 맨 위 '즐겨찾기' 그룹에 모인다. */
  favorites: PageId[];
}

const KEY = "bk_navprefs";
/** 로그인 계정별로 메뉴 설정을 분리 저장(없으면 기기 공용 키). */
function keyFor(userId?: string): string {
  return userId ? `${KEY}:${userId}` : KEY;
}

/** 부분 객체/JSON을 안전한 NavPrefs로. (서버·로컬 공용) */
export function normalizeNavPrefs(p: Partial<NavPrefs> | null | undefined): NavPrefs {
  return { order: p?.order ?? [], hidden: p?.hidden ?? [], favorites: p?.favorites ?? [] };
}

export function loadNavPrefs(userId?: string): NavPrefs {
  const fallback: NavPrefs = { order: [], hidden: [], favorites: [] };
  const parse = (raw: string | null): NavPrefs | null => {
    if (!raw) return null;
    try {
      return normalizeNavPrefs(JSON.parse(raw) as Partial<NavPrefs>);
    } catch {
      return null;
    }
  };
  try {
    // 계정 전용 설정 우선, 없으면 예전 공용 설정을 1회 승계.
    return parse(localStorage.getItem(keyFor(userId))) ?? (userId ? parse(localStorage.getItem(KEY)) : null) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveNavPrefs(p: NavPrefs, userId?: string): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** 즐겨찾기한(숨김 아닌) 메뉴를 사용자 순서대로. 사이드바 '즐겨찾기' 그룹용. */
export function favoritesNav(prefs: NavPrefs): NavItem[] {
  const favSet = new Set(prefs.favorites || []);
  return orderedNav(prefs).filter((n) => favSet.has(n.id));
}

/** ALL_NAV을 prefs.order대로 정렬(없는 건 뒤에), 숨김 제외(설정은 항상 표시). */
export function orderedNav(prefs: NavPrefs): NavItem[] {
  const byId = new Map(ALL_NAV.map((n) => [n.id, n]));
  const seen = new Set<PageId>();
  const out: NavItem[] = [];
  for (const id of prefs.order) {
    const n = byId.get(id);
    if (n && !seen.has(id)) {
      out.push(n);
      seen.add(id);
    }
  }
  for (const n of ALL_NAV) if (!seen.has(n.id)) out.push(n);
  return out.filter((n) => ALWAYS.includes(n.id) || !prefs.hidden.includes(n.id));
}

/** 전체 순서(설정 화면용; 숨김 항목도 포함, 순서만 반영) */
export function fullOrdered(prefs: NavPrefs): NavItem[] {
  const byId = new Map(ALL_NAV.map((n) => [n.id, n]));
  const seen = new Set<PageId>();
  const out: NavItem[] = [];
  for (const id of prefs.order) {
    const n = byId.get(id);
    if (n && !seen.has(id)) {
      out.push(n);
      seen.add(id);
    }
  }
  for (const n of ALL_NAV) if (!seen.has(n.id)) out.push(n);
  return out;
}
