// 수학 폭탄 돌리기 — 간단 연산 문제 + 4지 선다.

export type BombProblem = {
  text: string;
  answer: number;
  choices: number[]; // 4개, 정답 포함, 셔플됨
};

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

export function generateBombProblem(): BombProblem {
  const type = ri(0, 3);
  let text: string;
  let answer: number;
  if (type === 0) {
    // 한 자리 덧셈
    const a = ri(1, 9);
    const b = ri(1, 9);
    text = `${a} + ${b}`;
    answer = a + b;
  } else if (type === 1) {
    // 작은 뺄셈
    const a = ri(2, 15);
    const b = ri(1, a - 1);
    text = `${a} - ${b}`;
    answer = a - b;
  } else if (type === 2) {
    // 구구단
    const a = ri(2, 9);
    const b = ri(2, 9);
    text = `${a} × ${b}`;
    answer = a * b;
  } else {
    // 작은 나눗셈
    const b = ri(2, 9);
    const k = ri(1, 9);
    const a = b * k;
    text = `${a} ÷ ${b}`;
    answer = k;
  }
  // 오답 3개 (정답 근처, 중복 X, >= 0)
  const wrongs = new Set<number>();
  let guard = 0;
  while (wrongs.size < 3 && guard++ < 60) {
    const delta = ri(-5, 5);
    if (delta === 0) continue;
    const w = answer + delta;
    if (w < 0 || w === answer || wrongs.has(w)) continue;
    wrongs.add(w);
  }
  while (wrongs.size < 3) wrongs.add(answer + wrongs.size + 1);
  const choices = shuffle([answer, ...Array.from(wrongs)]);
  return { text, answer, choices };
}
