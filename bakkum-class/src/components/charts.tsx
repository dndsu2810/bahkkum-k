import type { ReactNode } from "react";
import type { Student } from "../types";
import { DOW, DOW_ORDER, TODAY } from "../lib/dates";
import { pct } from "../lib/logic";
import { Icon, type IconName } from "../icons";

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
  tone: "blue" | "purple" | "pink" | "orange";
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

export function WeekdayBars({ enrolled }: { enrolled: Student[] }) {
  const counts: Record<string, number> = {};
  DOW_ORDER.forEach((d) => (counts[d] = 0));
  enrolled.forEach((s) =>
    (s.lessons || []).forEach((l) => {
      if (counts[l.day] != null) counts[l.day]++;
    })
  );
  const max = Math.max(1, Math.max(...DOW_ORDER.map((d) => counts[d])));
  const todayDow = DOW[TODAY.getDay()];
  return (
    <div className="bars">
      {DOW_ORDER.map((d) => {
        const v = counts[d];
        const h = Math.round((v / max) * 150) + (v ? 6 : 0);
        const weekend = d === "토" || d === "일";
        const isToday = d === todayDow;
        return (
          <div className={"bar-col" + (isToday ? " today" : "")} key={d}>
            <div className="bar-track">
              <div className={"bar" + (weekend ? " weekend" : "")} style={{ height: h }}>
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

export function Donut({ ele, mid }: { ele: number; mid: number }) {
  const total = ele + mid;
  const segs = [
    { label: "초등", value: ele, color: "var(--blue)" },
    { label: "중등", value: mid, color: "var(--purple)" },
  ];
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
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-1px" }}>{total}</div>
          <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600 }}>총 재적</div>
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
