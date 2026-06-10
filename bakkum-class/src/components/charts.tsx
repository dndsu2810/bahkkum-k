import type { ReactNode } from "react";
import type { Student } from "../types";
import { DOW, TODAY } from "../lib/dates";
import { pct } from "../lib/logic";
import { Icon, type IconName } from "../icons";
import type { Tone } from "../lib/categories";

export function Kpi({
  label,
  num,
  unit,
  tone,
  icon,
  foot,
}: {
  label: string;
  num: number;
  unit: string;
  tone: Tone;
  icon: IconName;
  foot: ReactNode;
}) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className={"kpi-ic ic-" + tone}>
          <Icon name={icon} />
        </span>
      </div>
      <div className="kpi-num">
        {num}
        <span className="kpi-unit">{unit}</span>
      </div>
      <div className="kpi-foot">{foot}</div>
    </div>
  );
}

// 주말(토·일)은 수업이 없어 분포에서 제외 — 평일만 표시.
const WEEKDAYS = ["월", "화", "수", "목", "금"];
export function WeekdayBars({ enrolled }: { enrolled: Student[] }) {
  const counts: Record<string, number> = {};
  WEEKDAYS.forEach((d) => (counts[d] = 0));
  enrolled.forEach((s) =>
    (s.lessons || []).forEach((l) => {
      if (counts[l.day] != null) counts[l.day]++;
    })
  );
  const max = Math.max(1, Math.max(...WEEKDAYS.map((d) => counts[d])));
  const todayDow = DOW[TODAY.getDay()];
  return (
    <div className="bars">
      {WEEKDAYS.map((d) => {
        const v = counts[d];
        const h = Math.round((v / max) * 76) + (v ? 5 : 0);
        const isToday = d === todayDow;
        return (
          <div className={"bar-col" + (isToday ? " today" : "")} key={d}>
            <div className="bar-track">
              <div className="bar" style={{ height: h }}>
                {v ? <span className="bar-val">{v}</span> : null}
              </div>
            </div>
            <div className="bar-lab">{d}</div>
          </div>
        );
      })}
    </div>
  );
}

export function Donut({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const segs = segments;
  const total = segs.reduce((a, s) => a + s.value, 0);
  const r = 52;
  const C = 2 * Math.PI * r;
  let off = 0;
  const circles: ReactNode[] = [];
  if (total === 0) {
    circles.push(
      <circle key="empty" cx="70" cy="70" r={r} fill="none" stroke="var(--border)" strokeWidth="20" />
    );
  } else {
    segs.forEach((s, i) => {
      if (!s.value) return;
      const len = (s.value / total) * C;
      circles.push(
        <circle
          key={i}
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth="20"
          strokeDasharray={`${len} ${C - len}`}
          strokeDashoffset={-off}
          strokeLinecap="butt"
        />
      );
      off += len;
    });
  }
  return (
    <div className="donut-wrap">
      <div style={{ position: "relative", width: 140, height: 140 }}>
        <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: "rotate(-90deg)" }}>
          {circles}
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-1px" }}>{total}</div>
          <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600 }}>총 재적</div>
        </div>
      </div>
      <div className="donut-legend">
        {segs.map((s) => (
          <div className="leg-item" key={s.label}>
            <span className="leg-dot" style={{ background: s.color }} />
            <span className="leg-name">{s.label}</span>
            <span className="leg-val">{s.value}명</span>
            <span className="leg-pct">{pct(s.value, total)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
