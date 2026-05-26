// 도형 그리기 게임 — 그린 손가락 궤적의 도형 분류.
// 5학년 도형 단원. 단순화(RDP) + 꼭짓점 개수 + 폐곡선 + 별모양 검사.

import type { Point, Stroke } from "@/lib/laser";

export type ShapeLabel = "삼각형" | "사각형" | "오각형" | "원" | "별" | "?";

export type ShapeMission = {
  label: ShapeLabel;
  text: string;
  hint: string;
};

export const MISSIONS: ShapeMission[] = [
  { label: "삼각형", text: "삼각형 그리기", hint: "꼭짓점 3개" },
  { label: "사각형", text: "사각형 그리기", hint: "꼭짓점 4개" },
  { label: "원", text: "원 그리기", hint: "둥글게 한 번에" },
  { label: "별", text: "별 그리기", hint: "삐죽삐죽 5각 별" },
];

export function pickMission(prevLabel?: ShapeLabel): ShapeMission {
  const pool = prevLabel
    ? MISSIONS.filter((m) => m.label !== prevLabel)
    : MISSIONS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── 분석 ─────────────────────────────────────────────
function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Ramer-Douglas-Peucker 단순화 */
function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  let maxD = 0;
  let idx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDist(points[i], first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > epsilon) {
    const left = rdp(points.slice(0, idx + 1), epsilon);
    const right = rdp(points.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function pointLineDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return dist(p, a);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  const cx = a.x + tc * dx;
  const cy = a.y + tc * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** 도형 분류 결과 + 디버그 정보 */
export type ShapeResult = {
  label: ShapeLabel;
  corners: number;
  closed: boolean;
  starScore: number;
  circScore: number;
};

/** 그린 획들을 한 경로로 펴고 분석 */
export function classifyShape(strokes: Stroke[]): ShapeResult {
  // 모든 점을 시간순으로 합치기
  const pts: Point[] = [];
  for (const s of strokes) for (const p of s) pts.push(p);
  if (pts.length < 6)
    return { label: "?", corners: 0, closed: false, starScore: 0, circScore: 0 };

  // 인접 중복 제거
  const flat: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = flat[flat.length - 1];
    if (dist(prev, pts[i]) > 1.5) flat.push(pts[i]);
  }
  if (flat.length < 6)
    return { label: "?", corners: 0, closed: false, starScore: 0, circScore: 0 };

  // 바운딩 박스
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of flat) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const diag = Math.hypot(w, h);

  // 폐곡선 여부: 시작·끝 거리 < bbox 짧은변 × 0.30
  const startEnd = dist(flat[0], flat[flat.length - 1]);
  const closed = startEnd < Math.min(w, h) * 0.3;

  // RDP 단순화 — epsilon은 bbox 대각선의 6%
  const eps = diag * 0.06;
  const simplified = rdp(flat, eps);

  // 폐곡선이면 마지막=첫번째 (cyclic) 처리
  let verts = simplified.slice();
  if (closed && verts.length > 2) {
    // 시작과 끝이 가까우면 마지막 제거 (중복)
    if (dist(verts[0], verts[verts.length - 1]) < eps * 1.5) verts = verts.slice(0, -1);
  }

  // 꼭짓점 각도 변화 측정 → sharp corner 개수
  let sharpCorners = 0;
  const angleChanges: number[] = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n];
    const cur = verts[i];
    const next = verts[(i + 1) % n];
    const d1x = cur.x - prev.x;
    const d1y = cur.y - prev.y;
    const d2x = next.x - cur.x;
    const d2y = next.y - cur.y;
    const a1 = Math.atan2(d1y, d1x);
    const a2 = Math.atan2(d2y, d2x);
    let turn = a2 - a1;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    angleChanges.push(turn);
    if (Math.abs(turn) > Math.PI / 4) sharpCorners += 1;
  }

  // 중심으로부터 점들 거리 — 원 점수
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let radSum = 0;
  let radSqSum = 0;
  for (const p of flat) {
    const r = Math.hypot(p.x - cx, p.y - cy);
    radSum += r;
    radSqSum += r * r;
  }
  const meanR = radSum / flat.length;
  const varR = radSqSum / flat.length - meanR * meanR;
  const stdR = Math.sqrt(Math.max(0, varR));
  // 원: closed + 표준편차/평균반지름이 작음
  const circScore = closed ? Math.max(0, 1 - (stdR / Math.max(1, meanR)) * 2.5) : 0;

  // 별: sharp corners ~ 10 (5각 별 = 5 외각 + 5 내각), 좌우 방향 부호 교대
  let alternations = 0;
  for (let i = 0; i < angleChanges.length; i++) {
    const a = angleChanges[i];
    const b = angleChanges[(i + 1) % angleChanges.length];
    if (Math.sign(a) !== Math.sign(b) && Math.abs(a) > Math.PI / 6 && Math.abs(b) > Math.PI / 6)
      alternations += 1;
  }
  const starScore =
    closed && sharpCorners >= 8 && alternations >= 6 ? 1 : 0;

  // 분류
  let label: ShapeLabel = "?";
  if (starScore >= 1) label = "별";
  else if (circScore > 0.65 && sharpCorners <= 4) label = "원";
  else if (sharpCorners === 3) label = "삼각형";
  else if (sharpCorners === 4) label = "사각형";
  else if (sharpCorners === 5) label = "오각형";
  else if (closed && circScore > 0.5) label = "원";
  else if (sharpCorners >= 3 && sharpCorners <= 4) {
    label = sharpCorners === 3 ? "삼각형" : "사각형";
  } else label = "?";

  return { label, corners: sharpCorners, closed, starScore, circScore };
}
