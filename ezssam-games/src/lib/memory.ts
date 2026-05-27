// 수학 짝 맞추기 — 식 카드 + 답 카드 쌍 생성기.
// 답이 서로 다른 N개를 골라 각 답마다 식 하나씩 만든다.

export type MemoryPair = { eq: string; ans: number };

function ri(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type MemoryLevel = "easy" | "normal" | "hard";

/** 주어진 답을 만들어내는 식 문자열 (덧셈/뺄셈/곱셈/나눗셈 중 하나) */
function makeEqForAnswer(ans: number, hard: boolean): string {
  const candidates: string[] = [];

  // 덧셈: a + b = ans
  if (ans >= 2 && ans <= 18) {
    const a = ri(1, Math.min(9, ans - 1));
    candidates.push(`${a} + ${ans - a}`);
  }

  // 뺄셈: (ans+b) − b = ans
  if (ans >= 1) {
    const b = ri(1, 9);
    candidates.push(`${ans + b} − ${b}`);
  }

  // 곱셈: ans = a × b
  const factors: [number, number][] = [];
  const limit = hard ? 12 : 9;
  for (let i = 2; i <= limit; i++) {
    if (ans % i === 0) {
      const j = ans / i;
      if (j >= 2 && j <= limit) factors.push([i, j]);
    }
  }
  if (factors.length > 0) {
    const f = factors[Math.floor(Math.random() * factors.length)];
    candidates.push(`${f[0]} × ${f[1]}`);
  }

  // 나눗셈: (ans*b) ÷ b = ans
  if (ans >= 1 && ans <= 12) {
    const b = ri(2, 9);
    if (ans * b <= 99) candidates.push(`${ans * b} ÷ ${b}`);
  }

  return candidates[Math.floor(Math.random() * candidates.length)] ?? `${ans} + 0`;
}

/** N개의 (식, 답) 쌍 — 답은 모두 서로 다름 */
export function generatePairs(n: number, level: MemoryLevel): MemoryPair[] {
  const range = level === "hard" ? [12, 99] : [1, 9];
  const pool: number[] = [];
  for (let v = range[0]; v <= range[1]; v++) pool.push(v);
  const chosen = shuffle(pool).slice(0, n);
  const hard = level === "hard";
  return chosen.map((ans) => ({ eq: makeEqForAnswer(ans, hard), ans }));
}

/** 레벨별 카드 설정 */
export const LEVELS: Record<
  MemoryLevel,
  { name: string; pairs: number; cols: number; desc: string }
> = {
  easy: { name: "쉬움", pairs: 4, cols: 4, desc: "4쌍 · 한 자리 답" },
  normal: { name: "보통", pairs: 6, cols: 4, desc: "6쌍 · 한 자리 답" },
  hard: { name: "어려움", pairs: 8, cols: 4, desc: "8쌍 · 두 자리 답" },
};

/** 점수 계산: 쌍 수가 많고 실수가 적고 빠를수록 높음 */
export function calcMemoryScore(
  pairs: number,
  failedTries: number,
  elapsedSec: number
): number {
  const raw = pairs * 100 - failedTries * 30 - Math.round(elapsedSec) * 2;
  return Math.max(0, raw);
}
