// 수업 구분(카테고리) — 기본 초등/중등. 설정에서 직접 정의(이름+색).
// 모듈 캐시로 두고 gradeColor 등 leaf에서 prop 없이 읽음. 설정 변경 시 App이
// setCategories + 리렌더하면 캐시 갱신 + 화면 반영.

export type Tone = "blue" | "purple" | "pink" | "green" | "orange";
export const TONES: Tone[] = ["blue", "purple", "pink", "green", "orange"];

export interface Category {
  name: string;
  tone: Tone;
}

export const DEFAULT_CATEGORIES: Category[] = [
  { name: "초등", tone: "blue" },
  { name: "중등", tone: "purple" },
];

const KEY = "bk_categories";

function read(): Category[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const a = JSON.parse(raw) as Category[];
      if (Array.isArray(a) && a.length) return a;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_CATEGORIES;
}

let cache: Category[] = read();

export function getCategories(): Category[] {
  return cache;
}
export function setCategories(c: Category[]): void {
  cache = c.length ? c : DEFAULT_CATEGORIES;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}
export function toneOf(name: string): Tone {
  const c = cache.find((x) => x.name === name);
  return c ? c.tone : cache[0]?.tone || "blue";
}
/** category order index for sorting (unknown → end) */
export function catIndex(name: string): number {
  const i = cache.findIndex((x) => x.name === name);
  return i < 0 ? 999 : i;
}
export function toneColorVar(tone: Tone): string {
  return "var(--" + tone + ")";
}
