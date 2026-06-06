import type { IconName } from "../icons";

export type PageId =
  | "today"
  | "dashboard"
  | "attendance"
  | "students"
  | "timetable"
  | "makeup"
  | "homework"
  | "progress"
  | "report"
  | "settings";

export interface NavItem {
  id: PageId;
  label: string;
  icon: IconName;
}

export const ALL_NAV: NavItem[] = [
  { id: "today", label: "오늘", icon: "today" },
  { id: "dashboard", label: "대시보드", icon: "dashboard" },
  { id: "attendance", label: "출결 체크", icon: "clipboard" },
  { id: "students", label: "학생 관리", icon: "students" },
  { id: "timetable", label: "시간표", icon: "cal" },
  { id: "makeup", label: "보강 관리", icon: "refresh" },
  { id: "homework", label: "숙제 관리", icon: "book" },
  { id: "progress", label: "진도 관리", icon: "chart" },
  { id: "report", label: "월말리포트", icon: "fileText" },
  { id: "settings", label: "설정", icon: "gear" },
];

/** 숨기거나 순서를 바꿀 수 없는 메뉴 */
export const ALWAYS: PageId[] = ["today", "settings"];

export interface NavPrefs {
  order: PageId[];
  hidden: PageId[];
}

const KEY = "bk_navprefs";

export function loadNavPrefs(): NavPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<NavPrefs>;
      return { order: p.order ?? [], hidden: p.hidden ?? [] };
    }
  } catch {
    /* ignore */
  }
  return { order: [], hidden: [] };
}

export function saveNavPrefs(p: NavPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
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
