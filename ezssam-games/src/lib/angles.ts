// 각도 사냥 게임 — 미션 생성 + 각도 계산 헬퍼.
// 5학년 각도 단원 (예각·직각·둔각·평각).

export type AngleMission = {
  text: string;
  short: string;
  target: number | null; // 특정 값(null이면 카테고리)
  category?: "acute" | "right" | "obtuse" | "straight";
  isMatch: (deg: number) => boolean;
};

const SPECIFIC: number[] = [30, 45, 60, 90, 120, 135, 150, 180];
const TOL = 12; // 특정 각도 허용 오차 ±12°

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

export function generateAngleMission(): AngleMission {
  // 60% 특정 각도, 40% 카테고리
  if (Math.random() < 0.6) {
    const t = pick(SPECIFIC);
    return {
      text: `${t}° 만들기`,
      short: `${t}°`,
      target: t,
      isMatch: (deg) => Math.abs(deg - t) <= TOL,
    };
  }
  const cat = pick(["acute", "right", "obtuse", "straight"] as const);
  if (cat === "acute")
    return {
      text: "예각 만들기 (90°보다 작게)",
      short: "예각",
      target: null,
      category: "acute",
      isMatch: (d) => d > 15 && d < 85,
    };
  if (cat === "right")
    return {
      text: "직각 만들기 (90°)",
      short: "직각",
      target: 90,
      category: "right",
      isMatch: (d) => Math.abs(d - 90) <= 8,
    };
  if (cat === "obtuse")
    return {
      text: "둔각 만들기 (90°보다 크게, 180°보다 작게)",
      short: "둔각",
      target: null,
      category: "obtuse",
      isMatch: (d) => d > 95 && d < 170,
    };
  return {
    text: "평각 만들기 (180°)",
    short: "평각",
    target: 180,
    category: "straight",
    isMatch: (d) => d >= 168,
  };
}

/** 두 벡터(어깨중심 기준 왼손 / 오른손) 사이 각도 (도). 0~180. */
export function angleBetween(
  cx: number,
  cy: number,
  lx: number,
  ly: number,
  rx: number,
  ry: number
): number {
  const ax = lx - cx;
  const ay = ly - cy;
  const bx = rx - cx;
  const by = ry - cy;
  const dot = ax * bx + ay * by;
  const ma = Math.hypot(ax, ay);
  const mb = Math.hypot(bx, by);
  if (ma === 0 || mb === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (ma * mb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function angleCategory(deg: number): "acute" | "right" | "obtuse" | "straight" {
  if (deg < 88) return "acute";
  if (deg <= 92) return "right";
  if (deg < 175) return "obtuse";
  return "straight";
}
