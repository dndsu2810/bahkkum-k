// 손 제스처 헬퍼 (MediaPipe Hands 21점 기반).
// 그리기 게임에서 "펜 다운/펜 업" 구분 등.

export type HandLM = { x: number; y: number; z?: number; visibility?: number };

/** 엄지와 검지 끝이 모여 있는지 (핀치 제스처). 손 크기로 정규화. */
export function isPinching(lm: HandLM[], threshold = 0.5): boolean {
  if (!lm[0] || !lm[4] || !lm[8] || !lm[9]) return false;
  // 손 크기: 손목(0) → 중지 시작점(9) 거리
  const handSize = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
  if (handSize < 1e-6) return false;
  const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
  return pinchDist / handSize < threshold;
}

/** 핀치 시 펜끝 위치(엄지·검지 중점). 일반 위치는 검지 끝(landmark 8). */
export function penTip(lm: HandLM[]): { x: number; y: number } | null {
  if (!lm[4] || !lm[8]) return null;
  return { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 };
}
