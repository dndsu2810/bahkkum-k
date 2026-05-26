// 레이저 수학 게임 — 문제 생성 + 숫자 인식(템플릿 매칭).
// 1단계 구현: 한 자리 답만 (구구단 일부 + 나눗셈). 두 자리 답은 다음 단계.

export type Problem = { text: string; answer: number };

function ri(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateProblem(): Problem {
  // 80% 나눗셈, 20% 한자리 답 곱셈
  if (Math.random() < 0.8) {
    const b = ri(2, 9);
    const k = ri(0, 9);
    const a = b * k;
    return { text: `${a} ÷ ${b}`, answer: k };
  }
  const opts: [number, number][] = [
    [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9],
    [2, 2], [2, 3], [2, 4],
    [3, 2], [3, 3],
    [4, 2],
  ];
  const [a, b] = opts[ri(0, opts.length - 1)];
  return { text: `${a} × ${b}`, answer: a * b };
}

// ── 숫자 인식 (템플릿 매칭) ────────────────────────────
// 그린 궤적을 28×28 비트맵으로 만들고, 폰트로 미리 그려둔 0~9 템플릿과
// 코사인 유사도를 계산해 상위 3개를 반환. (간단·외부 모델 의존 없음)
export const TEMPLATE_SIZE = 28;
let templatesCache: Float32Array[] | null = null;

function buildTemplates(): Float32Array[] {
  if (typeof document === "undefined") return [];
  const out: Float32Array[] = [];
  const c = document.createElement("canvas");
  c.width = TEMPLATE_SIZE;
  c.height = TEMPLATE_SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) return [];
  for (let d = 0; d <= 9; d++) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(d), TEMPLATE_SIZE / 2, TEMPLATE_SIZE / 2 + 1);
    const img = ctx.getImageData(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE).data;
    const arr = new Float32Array(TEMPLATE_SIZE * TEMPLATE_SIZE);
    for (let i = 0; i < arr.length; i++) arr[i] = img[i * 4] / 255;
    out.push(arr);
  }
  return out;
}

function ensureTemplates(): Float32Array[] {
  if (!templatesCache) templatesCache = buildTemplates();
  return templatesCache;
}

export type Point = { x: number; y: number };
export type Stroke = Point[];

/** 그린 획을 28×28 비트맵으로 (검은 배경 + 흰 선) 렌더링 */
function rasterizeStrokes(strokes: Stroke[]): Float32Array {
  const c = document.createElement("canvas");
  c.width = TEMPLATE_SIZE;
  c.height = TEMPLATE_SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) return new Float32Array(TEMPLATE_SIZE * TEMPLATE_SIZE);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE);

  // 바운딩 박스
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) return new Float32Array(TEMPLATE_SIZE * TEMPLATE_SIZE);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const margin = 3;
  const inner = TEMPLATE_SIZE - 2 * margin;
  const scale = Math.min(inner / w, inner / h);
  const offX = (TEMPLATE_SIZE - w * scale) / 2 - minX * scale;
  const offY = (TEMPLATE_SIZE - h * scale) / 2 - minY * scale;
  const mx = (x: number) => x * scale + offX;
  const my = (y: number) => y * scale + offY;

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    if (s.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(mx(s[0].x), my(s[0].y));
    for (let i = 1; i < s.length; i++) ctx.lineTo(mx(s[i].x), my(s[i].y));
    ctx.stroke();
  }

  const img = ctx.getImageData(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE).data;
  const arr = new Float32Array(TEMPLATE_SIZE * TEMPLATE_SIZE);
  for (let i = 0; i < arr.length; i++) arr[i] = img[i * 4] / 255;
  return arr;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na * nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export type Candidate = { digit: number; conf: number };

/** 그린 획에서 상위 3개 후보 숫자 반환 */
export function recognizeStrokes(strokes: Stroke[]): Candidate[] {
  if (strokes.length === 0) return [];
  const ts = ensureTemplates();
  if (ts.length === 0) return [];
  const v = rasterizeStrokes(strokes);
  const all: Candidate[] = [];
  for (let d = 0; d <= 9; d++) all.push({ digit: d, conf: cosine(v, ts[d]) });
  all.sort((a, b) => b.conf - a.conf);
  return all.slice(0, 3);
}
