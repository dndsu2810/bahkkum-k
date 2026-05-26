// 간단한 효과음 (오디오 파일 없이 WebAudio 로 생성). 수업 중 끄기 쉽게 음소거 토글.
let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean): void {
  muted = m;
}

export function isMuted(): boolean {
  return muted;
}

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function beep(freq: number, type: OscillatorType, dur: number, vol: number) {
  if (muted) return;
  const c = audioCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") c.resume();
    const o = c.createOscillator();
    const g = c.createGain();
    o.connect(g);
    g.connect(c.destination);
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.start();
    o.stop(c.currentTime + dur);
  } catch {
    // 무시
  }
}

/** 정답: 청량한 "팅!" */
export function playCorrect(): void {
  beep(880, "triangle", 0.18, 0.14);
  setTimeout(() => beep(1320, "triangle", 0.12, 0.1), 60);
}

/** 오답: 살짝 풀 죽은 "뿅" */
export function playWrong(): void {
  beep(200, "sawtooth", 0.22, 0.12);
}

/** 콤보 응원 */
export function playCombo(): void {
  beep(660, "square", 0.1, 0.08);
  setTimeout(() => beep(990, "square", 0.12, 0.08), 80);
}

/** 카운트다운 비트 */
export function playBeep(): void {
  beep(520, "sine", 0.12, 0.1);
}

// ── 폭탄 게임 전용 ─────────────────────────────────
let _tickAlt = false;
/** 시계 초침 — 짧고 또렷한 '틱' (틱-톡 교대) */
export function playTick(): void {
  if (muted) return;
  const c = audioCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") c.resume();
    const o = c.createOscillator();
    const g = c.createGain();
    o.connect(g);
    g.connect(c.destination);
    o.type = "square";
    o.frequency.setValueAtTime(_tickAlt ? 1200 : 1600, c.currentTime);
    _tickAlt = !_tickAlt;
    g.gain.setValueAtTime(0.08, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.05);
    o.start();
    o.stop(c.currentTime + 0.06);
  } catch {
    // 무시
  }
}

/** 폭발음 — 저주파 스윕 + 화이트노이즈 버스트 */
export function playBoom(): void {
  if (muted) return;
  const c = audioCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") c.resume();
    // 저주파 스윕 (콰광)
    const o = c.createOscillator();
    const g = c.createGain();
    o.connect(g);
    g.connect(c.destination);
    o.type = "sawtooth";
    o.frequency.setValueAtTime(160, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(30, c.currentTime + 0.45);
    g.gain.setValueAtTime(0.3, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.6);
    o.start();
    o.stop(c.currentTime + 0.6);

    // 화이트노이즈 폭발 잔향
    const sec = 0.3;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * sec), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const noise = c.createBufferSource();
    noise.buffer = buf;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.22, c.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.001, c.currentTime + sec);
    noise.connect(ng);
    ng.connect(c.destination);
    noise.start();
  } catch {
    // 무시
  }
}
