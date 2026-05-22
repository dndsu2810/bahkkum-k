// 마법 거울 설정 + 음성 질문 해석.
// 모각공 연동(출결/숙제)은 아직 미연결 → 해당 질문은 안내만. 나머지는 로컬에서 동작.

export type Student = { id: string; name: string; photo?: string };
export type Teacher = {
  id: string;
  name: string;
  photo?: string;
  keywords: string[]; // 예: ["예쁜","최고","멋진"]
};
export type MirrorSettings = {
  students: Student[];
  teachers: Teacher[];
  blocked: string[];
  theme: "snow" | "orient";
};

const KEY = "ezssam_mirror";

export const DEFAULT_BLOCKED = [
  "제일못",
  "꼴찌",
  "최악",
  "제일늦",
  "제일게으",
  "바보",
  "멍청",
  "못생",
];

export function getMirrorSettings(): MirrorSettings {
  if (typeof window === "undefined")
    return { students: [], teachers: [], blocked: DEFAULT_BLOCKED, theme: "snow" };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw)
      return {
        students: [],
        teachers: [],
        blocked: DEFAULT_BLOCKED,
        theme: "snow",
      };
    const s = JSON.parse(raw) as MirrorSettings;
    return {
      students: s.students ?? [],
      teachers: s.teachers ?? [],
      blocked: s.blocked?.length ? s.blocked : DEFAULT_BLOCKED,
      theme: s.theme ?? "snow",
    };
  } catch {
    return { students: [], teachers: [], blocked: DEFAULT_BLOCKED, theme: "snow" };
  }
}

export function saveMirrorSettings(s: MirrorSettings): void {
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

// ── 질문 해석 ───────────────────────────────────────
export type MirrorAction =
  | { kind: "praise"; teacher: Teacher | null; title: string; score: string }
  | { kind: "pick"; students: Student[]; label: string }
  | { kind: "groups"; groups: Student[][]; label: string }
  | { kind: "safety"; message: string }
  | { kind: "mogakgong"; message: string }
  | { kind: "none"; message: string };

const SAFETY_DODGES = [
  "거울도 차마 그런 건 말 못 해… 친구잖아!",
  "어머, 거울도 그건 비밀로 할래.",
  "거울은 이런 답은 안 해줘~",
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 한국어 수 세기 (한~열, 또는 숫자) — "두 명", "3명", "모둠 네 개"
function extractCount(q: string): number | null {
  const m = q.match(/(\d+)\s*(명|개|모둠|팀|그룹)/);
  if (m) return parseInt(m[1], 10);
  const words: Record<string, number> = {
    한: 1,
    두: 2,
    세: 3,
    네: 4,
    다섯: 5,
    여섯: 6,
    일곱: 7,
    여덟: 8,
    아홉: 9,
    열: 10,
  };
  for (const [w, n] of Object.entries(words)) {
    if (new RegExp(`${w}\\s*(명|개|모둠|팀|그룹)`).test(q)) return n;
  }
  return null;
}

function makePick(students: Student[], n: number, label: string): MirrorAction {
  if (students.length === 0)
    return {
      kind: "none",
      message: "먼저 관리자 화면에서 학생을 등록해 주세요!",
    };
  const picked = shuffle(students).slice(0, Math.min(n, students.length));
  return { kind: "pick", students: picked, label };
}

function makeGroups(students: Student[], n: number): MirrorAction {
  if (students.length === 0)
    return {
      kind: "none",
      message: "먼저 관리자 화면에서 학생을 등록해 주세요!",
    };
  const groups: Student[][] = Array.from({ length: n }, () => []);
  shuffle(students).forEach((s, i) => groups[i % n].push(s));
  return { kind: "groups", groups, label: `모둠 ${n}개` };
}

export function parseQuery(
  transcript: string,
  s: MirrorSettings
): MirrorAction {
  const q = transcript.replace(/\s/g, "");

  // 1) 안전장치 (항상 최우선)
  for (const b of s.blocked) {
    const bb = b.replace(/\s/g, "");
    if (bb && q.includes(bb))
      return {
        kind: "safety",
        message: SAFETY_DODGES[Math.floor(Math.random() * SAFETY_DODGES.length)],
      };
  }

  // 2) 모둠 짜기
  if (q.includes("모둠") || q.includes("그룹") || q.includes("팀")) {
    const n = extractCount(q) ?? 2;
    return makeGroups(s.students, Math.max(2, n));
  }

  // 3) 칭찬·장난 (쌤/선생)
  if (/(쌤|선생)/.test(q)) {
    const teacher =
      s.teachers.find((t) => t.keywords.some((k) => q.includes(k.replace(/\s/g, "")))) ??
      s.teachers[0] ??
      null;
    const isScary = q.includes("무서");
    const title = isScary
      ? "오늘의 무서운 쌤"
      : q.includes("최고") || q.includes("수학")
        ? "오늘의 수학 최고 쌤"
        : "오늘의 1위";
    const score = `${(90 + Math.random() * 9.9).toFixed(1)}%`;
    return { kind: "praise", teacher, title, score };
  }

  // 4) 모각공 연동 질문 (출결/숙제) — 아직 미연결
  if (/(결석|출석|숙제|안한|미완|안온|안 온)/.test(q)) {
    return {
      kind: "mogakgong",
      message: "출결·숙제는 모각공이 연결되면 알려줄게! (지금은 준비 중이에요)",
    };
  }

  // 5) 여러 명 뽑기
  const cnt = extractCount(q);
  if (cnt && cnt > 1) return makePick(s.students, cnt, `${cnt}명 뽑기`);

  // 6) 한 명 뽑기 (발표/당번/청소… 또는 기본)
  let label = "오늘의 주인공";
  if (q.includes("발표")) label = "오늘의 발표자";
  else if (q.includes("청소") || q.includes("당번")) label = "오늘의 당번";
  else if (q.includes("문제")) label = "문제 풀 사람";
  return makePick(s.students, 1, label);
}
