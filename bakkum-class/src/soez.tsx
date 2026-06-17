// 쏘이지(Soez) 브랜드 일러스트 — 꿀벌/꿀/벌집 인라인 SVG 컴포넌트.
// 색은 디자인 토큰(--honey-*, --comb-700, --ink) 사용. 업무용 통계/리포트엔 쓰지 않는다(가드레일).
import { useId, type CSSProperties } from "react";

const INK = "#2A2926";

/** 꿀벌 심볼 — 로고·뱃지·빈 화면. 둥근 꿀색 몸통 + 차콜 줄무늬 3선 + 흰 날개 + 더듬이. */
export function Bee({ size = 44, className, title }: { size?: number; className?: string; title?: string }) {
  const u = useId().replace(/[:]/g, "");
  return (
    <svg width={size} height={Math.round((size * 60) / 64)} viewBox="0 0 64 60" className={className} role="img" aria-label={title || "꿀벌"}>
      <defs>
        <linearGradient id={u + "g"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FAC775" />
          <stop offset="1" stopColor="#F4A93C" />
        </linearGradient>
        <clipPath id={u + "c"}><ellipse cx="32" cy="36" rx="19" ry="16" /></clipPath>
      </defs>
      {/* 더듬이 */}
      <path d="M27 16 Q23 7 19 6" stroke={INK} strokeWidth="1.7" fill="none" strokeLinecap="round" />
      <circle cx="19" cy="6" r="2" fill={INK} />
      <path d="M37 16 Q41 7 45 6" stroke={INK} strokeWidth="1.7" fill="none" strokeLinecap="round" />
      <circle cx="45" cy="6" r="2" fill={INK} />
      {/* 날개 (몸통 뒤) */}
      <ellipse cx="22" cy="20" rx="9" ry="11.5" fill="#fff" stroke={INK} strokeWidth="1.7" transform="rotate(-20 22 20)" />
      <ellipse cx="42" cy="20" rx="9" ry="11.5" fill="#fff" stroke={INK} strokeWidth="1.7" transform="rotate(20 42 20)" />
      {/* 몸통 */}
      <ellipse cx="32" cy="36" rx="19" ry="16" fill={`url(#${u}g)`} stroke={INK} strokeWidth="1.7" />
      {/* 줄무늬 3선 (몸통에 클립) */}
      <g clipPath={`url(#${u}c)`}>
        <path d="M11 29 Q32 33 53 29" stroke={INK} strokeWidth="3.6" fill="none" />
        <path d="M10 38 Q32 42 54 38" stroke={INK} strokeWidth="3.6" fill="none" />
        <path d="M12 47 Q32 51 52 47" stroke={INK} strokeWidth="3.6" fill="none" />
      </g>
    </svg>
  );
}

const HEX = "M24 1.6 L46.4 14 L46.4 40 L24 52.4 L1.6 40 L1.6 14 Z";

/** 벌집 아바타 — 사진 없으면 육각 칸 + 이름 초성. 사진 있으면 육각으로 잘라 보여줌. */
export function HexAvatar({ name, photo, size = 44, className }: { name?: string; photo?: string; size?: number; className?: string }) {
  const u = useId().replace(/[:]/g, "");
  const initial = (name || "").trim().slice(0, 1) || "?";
  const w = Math.round((size * 48) / 54);
  return (
    <svg width={w} height={size} viewBox="0 0 48 54" className={"hexav " + (className || "")} aria-hidden="true">
      <defs><clipPath id={u}><path d={HEX} /></clipPath></defs>
      {photo ? (
        <image href={photo} x="1.6" y="1.6" width="44.8" height="50.8" clipPath={`url(#${u})`} preserveAspectRatio="xMidYMid slice" />
      ) : (
        <>
          <path d={HEX} fill="var(--honey-100)" />
          <text x="24" y="34" textAnchor="middle" fontFamily="var(--font-logo)" fontSize="21" fill="var(--comb-700)">{initial}</text>
        </>
      )}
      <path d={HEX} fill="none" stroke="var(--comb-700)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/** 꿀방울 — 포인트(꿀) 단위 아이콘. */
export function HoneyDrop({ size = 15, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 3 C12 3 5 11 5 15.5 A7 7 0 0 0 19 15.5 C19 11 12 3 12 3 Z" fill="var(--honey-500)" stroke="var(--comb-700)" strokeWidth="1.4" strokeLinejoin="round" />
      <ellipse cx="9.4" cy="14" rx="1.5" ry="2.3" fill="#fff" opacity="0.5" />
    </svg>
  );
}

/** 여왕벌 왕관 — 랭킹 1등 아바타 위에 올림. */
export function Crown({ size = 22, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={Math.round((size * 20) / 28)} viewBox="0 0 28 20" className={className} style={style} aria-hidden="true">
      <path d="M2.5 17 L2.5 7 L9 11.5 L14 3 L19 11.5 L25.5 7 L25.5 17 Z" fill="var(--honey-300)" stroke="var(--comb-700)" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="14" cy="3" r="1.8" fill="var(--honey-500)" stroke="var(--comb-700)" strokeWidth="1.2" />
    </svg>
  );
}

/** 벌집 게이지 — 칸이 하나씩 차오르는 진행률(막대 대신). 목표·출석보상 전용. 통계 그래프엔 금지. */
export function CombGauge({ value, total, size = 18, gap = 3 }: { value: number; total: number; size?: number; gap?: number }) {
  const cells = Math.max(1, Math.min(total, 24));
  const filled = Math.max(0, Math.min(cells, Math.round((value / total) * cells)));
  const w = (size * 46) / 54;
  return (
    <span className="comb-gauge" role="img" aria-label={`${value} / ${total}`} style={{ display: "inline-flex", gap }}>
      {Array.from({ length: cells }).map((_, i) => (
        <svg key={i} width={w} height={size} viewBox="0 0 48 54" aria-hidden="true">
          <path d={HEX} fill={i < filled ? "var(--honey-500)" : "var(--surface-2)"} stroke="var(--comb-700)" strokeWidth={i < filled ? 1.6 : 1.4} strokeLinejoin="round" opacity={i < filled ? 1 : 0.55} />
        </svg>
      ))}
    </span>
  );
}

/** 빈 화면 — 빈 벌집 + 꿀벌, "아직 모인 꿀이 없어요". */
export function EmptyHive({ caption = "아직 모인 꿀이 없어요", sub }: { caption?: string; sub?: string }) {
  // 빈 벌집 셀 몇 개(아웃라인) 위에 꿀벌 한 마리.
  const cell = (cx: number, cy: number, key: string, fill = false) => {
    const r = 13;
    const p = [
      [cx, cy - r], [cx + r * 0.866, cy - r * 0.5], [cx + r * 0.866, cy + r * 0.5],
      [cx, cy + r], [cx - r * 0.866, cy + r * 0.5], [cx - r * 0.866, cy - r * 0.5],
    ].map((q) => q.map((n) => n.toFixed(1)).join(" ")).join(" L ");
    return <path key={key} d={`M ${p} Z`} fill={fill ? "var(--honey-100)" : "none"} stroke="var(--comb-700)" strokeWidth="1.5" strokeLinejoin="round" opacity={fill ? 0.9 : 0.4} />;
  };
  return (
    <div className="soez-empty">
      <div className="soez-empty-art">
        <svg width="132" height="70" viewBox="0 0 132 70" aria-hidden="true">
          {cell(38, 42, "a")}
          {cell(61, 42, "b", true)}
          {cell(84, 42, "c")}
          {cell(49.5, 22, "d")}
          {cell(72.5, 22, "e")}
        </svg>
        <span className="soez-empty-bee"><Bee size={42} /></span>
      </div>
      <div className="soez-empty-cap">{caption}</div>
      {sub && <div className="soez-empty-sub">{sub}</div>}
    </div>
  );
}
