// 수학 풍덩! 문제 생성기. 생존 시간이 길수록 어려워짐.
export type Problem = { text: string; answer: number };

function ri(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function mixedNoParen(): Problem {
  return pick([
    () => {
      const a = ri(2, 20);
      const b = ri(2, 9);
      const c = ri(2, 9);
      return { text: `${a} + ${b} × ${c}`, answer: a + b * c };
    },
    () => {
      const b = ri(2, 9);
      const c = ri(2, 9);
      const a = ri(b * c, b * c + 20);
      return { text: `${a} - ${b} × ${c}`, answer: a - b * c };
    },
    () => {
      const q = ri(2, 9);
      const k = ri(2, 9);
      const r = ri(1, 20);
      return { text: `${q * k} ÷ ${q} + ${r}`, answer: k + r };
    },
    () => {
      const q = ri(2, 9);
      const k = ri(3, 9);
      const r = ri(1, k - 1);
      return { text: `${q * k} ÷ ${q} - ${r}`, answer: k - r };
    },
  ])();
}

function mixedParen(): Problem {
  return pick([
    () => {
      const a = ri(2, 12);
      const b = ri(2, 12);
      const c = ri(2, 9);
      return { text: `(${a} + ${b}) × ${c}`, answer: (a + b) * c };
    },
    () => {
      const a = ri(5, 15);
      const b = ri(1, a - 1);
      const c = ri(2, 9);
      return { text: `(${a} - ${b}) × ${c}`, answer: (a - b) * c };
    },
    () => {
      const q1 = ri(2, 6);
      const q2 = ri(2, 6);
      const k = ri(2, 6);
      const m = ri(2, 5);
      const p = (q1 + q2) * k;
      return { text: `${p} ÷ (${q1} + ${q2}) × ${m}`, answer: k * m };
    },
  ])();
}

function mixedHard(): Problem {
  const a = ri(5, 12);
  const b = ri(1, a - 1);
  const k = ri(2, 6);
  const c = ri(2, 6);
  const d = ri(2, 6);
  const p = (a - b) * k;
  return { text: `${p} ÷ (${a} - ${b}) + ${c} × ${d}`, answer: k + c * d };
}

export function generateProblem(survivalSec: number): Problem {
  if (survivalSec < 10) {
    const a = ri(2, 9);
    const b = ri(2, 9);
    return { text: `${a} × ${b}`, answer: a * b };
  }
  if (survivalSec < 25) {
    const a = ri(11, 29);
    const b = ri(2, 9);
    return { text: `${a} × ${b}`, answer: a * b };
  }
  if (survivalSec < 45) return mixedNoParen();
  if (survivalSec < 60) return mixedParen();
  return mixedHard();
}

/** 정답과 헷갈리기 좋은 오답 보기 (정답과 다르고 0 이상) */
export function generateWrong(answer: number): number {
  const candidates = [
    answer + ri(1, 9),
    answer - ri(1, 9),
    answer + ri(10, 20),
    Math.round(answer * 1.5),
    Math.max(0, answer - ri(10, 20)),
  ].filter((n) => n !== answer && n >= 0);
  return candidates.length > 0 ? pick(candidates) : answer + 1;
}
