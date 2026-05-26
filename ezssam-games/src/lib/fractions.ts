// 분수 비교 게임 문제 생성기 (5학년 분수 크기 비교).
// 난이도 5단계 + 가끔 '같은 값'(가운데 머무르기 정답) 출제.

export type Frac =
  | { kind: "frac"; num: number; den: number }
  | { kind: "mixed"; whole: number; num: number; den: number }
  | { kind: "decimal"; value: number };

export type Side = "left" | "right" | "center";
export type Pair = { left: Frac; right: Frac; answer: Side };

const EPS = 1e-6;

export function fracValue(f: Frac): number {
  if (f.kind === "frac") return f.num / f.den;
  if (f.kind === "mixed") return f.whole + f.num / f.den;
  return f.value;
}

function ri(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 1단계: 분모가 같은 분수 (분자 큰 게 큼)
function genStage1(): [Frac, Frac] {
  const d = ri(3, 10);
  let a = ri(1, d - 1);
  let b = ri(1, d - 1);
  while (b === a) b = ri(1, d - 1);
  return [
    { kind: "frac", num: a, den: d },
    { kind: "frac", num: b, den: d },
  ];
}

// 2단계: 분자가 같은 분수 (분모 작은 게 큼)
function genStage2(): [Frac, Frac] {
  const n = ri(1, 4);
  let d1 = ri(n + 1, 12);
  let d2 = ri(n + 1, 12);
  while (d2 === d1) d2 = ri(n + 1, 12);
  return [
    { kind: "frac", num: n, den: d1 },
    { kind: "frac", num: n, den: d2 },
  ];
}

// 3단계: 통분이 필요한 분수
function genStage3(): [Frac, Frac] {
  for (let i = 0; i < 50; i++) {
    const b = ri(2, 9);
    const d = ri(2, 9);
    const a = ri(1, b - 1);
    const c = ri(1, d - 1);
    if (b !== d && a !== c && a * d !== c * b) {
      return [
        { kind: "frac", num: a, den: b },
        { kind: "frac", num: c, den: d },
      ];
    }
  }
  return [
    { kind: "frac", num: 3, den: 4 },
    { kind: "frac", num: 5, den: 7 },
  ];
}

function genImproperOrMixed(): Frac {
  const q = ri(2, 5);
  const p = ri(q + 1, q * 3); // 가분수 (분자 > 분모)
  if (p % q !== 0 && Math.random() < 0.5) {
    return { kind: "mixed", whole: Math.floor(p / q), num: p % q, den: q };
  }
  return { kind: "frac", num: p, den: q };
}

// 4단계: 가분수·대분수 혼합
function genStage4(): [Frac, Frac] {
  for (let i = 0; i < 50; i++) {
    const l = genImproperOrMixed();
    const r = genImproperOrMixed();
    if (Math.abs(fracValue(l) - fracValue(r)) > EPS) return [l, r];
  }
  return [
    { kind: "frac", num: 7, den: 3 },
    { kind: "mixed", whole: 2, num: 1, den: 4 },
  ];
}

// 5단계: 분수와 소수 혼합
function genStage5(): [Frac, Frac] {
  for (let i = 0; i < 50; i++) {
    const q = ri(2, 8);
    const p = ri(1, q * 2);
    const frac: Frac = { kind: "frac", num: p, den: q };
    const dec: Frac = { kind: "decimal", value: ri(2, 18) / 10 };
    if (Math.abs(fracValue(frac) - fracValue(dec)) > EPS) {
      return Math.random() < 0.5 ? [frac, dec] : [dec, frac];
    }
  }
  return [
    { kind: "frac", num: 3, den: 4 },
    { kind: "decimal", value: 0.7 },
  ];
}

// 같은 값 (예: 1/2 vs 2/4) → 가운데 머무르기 정답
function genEqual(): [Frac, Frac] {
  const b = ri(2, 5);
  const a = ri(1, b - 1);
  const k = ri(2, 3);
  return [
    { kind: "frac", num: a, den: b },
    { kind: "frac", num: a * k, den: b * k },
  ];
}

export function generatePair(stage: number): Pair {
  // 1~3단계에서 가끔 같은 값 출제
  if (stage <= 3 && Math.random() < 0.12) {
    const [l, r] = genEqual();
    return { left: l, right: r, answer: "center" };
  }
  let raw: [Frac, Frac];
  switch (stage) {
    case 1:
      raw = genStage1();
      break;
    case 2:
      raw = genStage2();
      break;
    case 3:
      raw = genStage3();
      break;
    case 4:
      raw = genStage4();
      break;
    default:
      raw = genStage5();
  }
  // 두 분수의 큰 쪽/작은 쪽을 명시적으로 50:50으로 좌/우에 배치.
  // (생성 자체는 대칭이지만, 정답 쏠림 의혹을 원천 차단)
  const [a, b] = raw;
  const aVal = fracValue(a);
  const bVal = fracValue(b);
  if (Math.abs(aVal - bVal) < EPS) {
    return { left: a, right: b, answer: "center" };
  }
  const bigger = aVal > bVal ? a : b;
  const smaller = aVal > bVal ? b : a;
  const biggerOnLeft = Math.random() < 0.5;
  return {
    left: biggerOnLeft ? bigger : smaller,
    right: biggerOnLeft ? smaller : bigger,
    answer: biggerOnLeft ? "left" : "right",
  };
}

/** 디버그: N라운드 출제 시뮬레이션 — 좌/우/가운데 분포 */
export function simulateAnswerDistribution(
  stage: number,
  rounds: number
): { left: number; right: number; center: number; pairs: Pair[] } {
  const pairs: Pair[] = [];
  let left = 0;
  let right = 0;
  let center = 0;
  for (let i = 0; i < rounds; i++) {
    const p = generatePair(stage);
    pairs.push(p);
    if (p.answer === "left") left++;
    else if (p.answer === "right") right++;
    else center++;
  }
  return { left, right, center, pairs };
}

export const STAGE_INFO: { stage: number; name: string; time: number }[] = [
  { stage: 1, name: "분모가 같은 분수", time: 5 },
  { stage: 2, name: "분자가 같은 분수", time: 5 },
  { stage: 3, name: "통분이 필요한 분수", time: 4 },
  { stage: 4, name: "가분수·대분수", time: 3 },
  { stage: 5, name: "분수와 소수", time: 3 },
];

export function stageTime(stage: number): number {
  return STAGE_INFO[Math.min(Math.max(stage, 1), 5) - 1].time;
}

export function stageName(stage: number): string {
  return STAGE_INFO[Math.min(Math.max(stage, 1), 5) - 1].name;
}
