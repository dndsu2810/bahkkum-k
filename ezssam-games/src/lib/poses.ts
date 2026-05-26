// 수학 풍덩! 포즈 라이브러리.
// MediaPipe Pose 33점 기반. 인식은 좌우 구분 없이 관용적으로(아이들 친화).
// 같은 spec 으로 벽에 스틱피겨도 그린다.

export type LM = { x: number; y: number; visibility?: number };
export type ArmPos = "up" | "side" | "down" | "hip" | "chest";

export type Features = {
  arms: Record<ArmPos, number>;
  wristsTogether: boolean;
  spreadWide: boolean;
  kneeUp: "left" | "right" | null;
};

export type PoseSpec = {
  id: string;
  name: string;
  category: "A" | "B" | "C";
  la: ArmPos; // 그리기용 왼팔
  ra: ArmPos; // 그리기용 오른팔
  kneeUp?: "left" | "right";
  match: (f: Features) => boolean;
};

// 랜드마크 → 특징
export function computeFeatures(lm: LM[]): Features | null {
  const lsh = lm[11];
  const rsh = lm[12];
  const lhip = lm[23];
  const rhip = lm[24];
  const lw = lm[15];
  const rw = lm[16];
  if (!lsh || !rsh || !lhip || !rhip || !lw || !rw) return null;

  const shoulderY = (lsh.y + rsh.y) / 2;
  const hipY = (lhip.y + rhip.y) / 2;
  const centerX = (lsh.x + rsh.x) / 2;
  const SW = Math.abs(lsh.x - rsh.x) || 0.001;
  const TH = Math.abs(hipY - shoulderY) || 0.001;

  // 관용도 추가 완화 (실제 사용자 피드백 반영: 동작 인식이 잘 안 됨 → 더 너그럽게)
  const classify = (w: LM, hip: LM): ArmPos => {
    if (w.y < shoulderY - 0.18 * TH) return "up"; // 손목이 어깨보다 살짝만 위여도 '위'
    if (w.y > hipY - 0.02 * TH) {
      if (Math.abs(w.x - hip.x) < 0.7 * SW) return "hip";
      return "down";
    }
    if (Math.abs(w.x - centerX) < 0.65 * SW) return "chest";
    return "side";
  };

  const arms: Record<ArmPos, number> = {
    up: 0,
    side: 0,
    down: 0,
    hip: 0,
    chest: 0,
  };
  arms[classify(lw, lhip)]++;
  arms[classify(rw, rhip)]++;

  // 관용도 추가 완화
  const wristsTogether = Math.abs(lw.x - rw.x) < 0.8 * SW;
  const spreadWide =
    Math.abs(lw.x - centerX) > 0.65 * SW && Math.abs(rw.x - centerX) > 0.65 * SW;

  let kneeUp: "left" | "right" | null = null;
  const lkn = lm[25];
  const rkn = lm[26];
  const lan = lm[27];
  const ran = lm[28];
  if (lkn && rkn && lan && ran) {
    const legLen = Math.abs((lan.y + ran.y) / 2 - hipY) || 0.001;
    const diff = rkn.y - lkn.y;
    const th = 0.18 * legLen;
    if (diff > th) kneeUp = "left";
    else if (diff < -th) kneeUp = "right";
  }

  return { arms, wristsTogether, spreadWide, kneeUp };
}

export const POSES: PoseSpec[] = [
  // 카테고리 A — 쉬움
  {
    id: "t",
    name: "T자",
    category: "A",
    la: "side",
    ra: "side",
    match: (f) => f.arms.side === 2,
  },
  {
    id: "manse",
    name: "만세",
    category: "A",
    la: "up",
    ra: "up",
    match: (f) => f.arms.up === 2 && !f.wristsTogether && !f.spreadWide,
  },
  {
    id: "v",
    name: "V자",
    category: "A",
    la: "up",
    ra: "up",
    match: (f) => f.arms.up === 2 && f.spreadWide,
  },
  {
    id: "head",
    name: "양손 머리 위",
    category: "A",
    la: "up",
    ra: "up",
    match: (f) => f.arms.up === 2 && f.wristsTogether,
  },
  {
    id: "attention",
    name: "차렷",
    category: "A",
    la: "down",
    ra: "down",
    match: (f) => f.arms.down === 2,
  },
  {
    id: "x",
    name: "팔짱(X자)",
    category: "A",
    la: "chest",
    ra: "chest",
    match: (f) => f.arms.chest === 2,
  },
  // 카테고리 B — 변별력
  {
    id: "updown",
    name: "한 손 위, 한 손 아래",
    category: "B",
    la: "up",
    ra: "down",
    match: (f) => f.arms.up === 1 && f.arms.down === 1,
  },
  {
    id: "hero",
    name: "슈퍼히어로(양손 허리)",
    category: "B",
    la: "hip",
    ra: "hip",
    match: (f) => f.arms.hip === 2,
  },
  {
    id: "flamingo",
    name: "한쪽 무릎 들기",
    category: "B",
    la: "down",
    ra: "down",
    kneeUp: "left",
    match: (f) => f.kneeUp !== null,
  },
  // 카테고리 C — 웃김
  {
    id: "kpop",
    name: "한 손 위, 한 손 허리",
    category: "C",
    la: "up",
    ra: "hip",
    match: (f) => f.arms.up === 1 && f.arms.hip === 1,
  },
  {
    id: "punch",
    name: "펀치 자세",
    category: "C",
    la: "side",
    ra: "hip",
    match: (f) => f.arms.side === 1 && f.arms.hip === 1,
  },
  {
    id: "lpose",
    name: "한 손 위, 한 손 옆",
    category: "C",
    la: "up",
    ra: "side",
    match: (f) => f.arms.up === 1 && f.arms.side === 1,
  },
];

const BY_ID = Object.fromEntries(POSES.map((p) => [p.id, p]));

/** 생존 시간에 따른 포즈 풀.
 * 디버그 단계: 일단 카테고리 A만 활성화하고 인식이 안정적으로 되는지 검증.
 * A 100% 확인 → B 추가 → 그 다음 C 추가 (단계적 검증). */
const DEBUG_POSE_LEVEL: "A" | "AB" | "ABC" = "A";

export function poolFor(_survivalSec: number): PoseSpec[] {
  if (DEBUG_POSE_LEVEL === "A") return POSES.filter((p) => p.category === "A");
  if (DEBUG_POSE_LEVEL === "AB")
    return POSES.filter((p) => p.category === "A" || p.category === "B");
  return POSES;
}

/** 디버그: 현재 features 와 매칭되는 포즈 (전체 POSES 중) 찾기 — 자막용 */
export function findMatchingPose(f: Features | null): PoseSpec | null {
  if (!f) return null;
  for (const p of POSES) {
    if (p.match(f)) return p;
  }
  return null;
}

/** 같은 라운드에 서로 다른 포즈 2개 추첨 */
export function pickTwoPoses(survivalSec: number): [PoseSpec, PoseSpec] {
  const pool = poolFor(survivalSec);
  const a = pool[Math.floor(Math.random() * pool.length)];
  let b = pool[Math.floor(Math.random() * pool.length)];
  let guard = 0;
  while (b.id === a.id && guard++ < 20)
    b = pool[Math.floor(Math.random() * pool.length)];
  return [a, BY_ID[b.id]];
}

// ── 스틱피겨 그리기 ─────────────────────────────────
function armOffset(pos: ArmPos, sign: number, s: number): [number, number] {
  switch (pos) {
    case "up":
      return [sign * 0.05 * s, -0.5 * s];
    case "side":
      return [sign * 0.5 * s, 0];
    case "down":
      return [sign * 0.12 * s, 0.5 * s];
    case "hip":
      return [sign * 0.22 * s, 0.45 * s];
    case "chest":
      return [-sign * 0.18 * s, 0.12 * s];
  }
}

export function drawPoseFigure(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  spec: PoseSpec,
  color: string
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, 0.07 * s);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const shY = cy - 0.5 * s;
  const hipY = cy + 0.35 * s;
  const shX = 0.28 * s;

  // 머리
  ctx.beginPath();
  ctx.arc(cx, shY - 0.32 * s, 0.16 * s, 0, Math.PI * 2);
  ctx.fill();
  // 몸통
  ctx.beginPath();
  ctx.moveTo(cx, shY);
  ctx.lineTo(cx, hipY);
  ctx.stroke();
  // 어깨선
  ctx.beginPath();
  ctx.moveTo(cx - shX, shY);
  ctx.lineTo(cx + shX, shY);
  ctx.stroke();

  // 팔
  const drawArm = (pos: ArmPos, sign: number) => {
    const sx = cx + sign * shX;
    const [ox, oy] = armOffset(pos, sign, s);
    ctx.beginPath();
    ctx.moveTo(sx, shY);
    ctx.lineTo(sx + ox, shY + oy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx + ox, shY + oy, 0.06 * s, 0, Math.PI * 2);
    ctx.fill();
  };
  drawArm(spec.la, -1);
  drawArm(spec.ra, 1);

  // 다리
  const drawLeg = (sign: number, raised: boolean) => {
    const hx = cx + sign * 0.16 * s;
    ctx.beginPath();
    ctx.moveTo(cx, hipY);
    if (raised) {
      ctx.lineTo(hx + sign * 0.18 * s, hipY + 0.25 * s); // 무릎 옆으로
      ctx.lineTo(hx, hipY + 0.15 * s); // 발 살짝 위
    } else {
      ctx.lineTo(hx, hipY + 0.35 * s); // 무릎
      ctx.lineTo(hx, hipY + 0.7 * s); // 발
    }
    ctx.stroke();
  };
  drawLeg(-1, spec.kneeUp === "left");
  drawLeg(1, spec.kneeUp === "right");

  ctx.restore();
}
