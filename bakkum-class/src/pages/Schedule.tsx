import { useEffect, useMemo, useState } from "react";
import { fetchSchedule, type ScheduleItem } from "../api";
import { todayStr, fmtMDDow, pad, DOW } from "../lib/dates";
import { Empty } from "../components/ui";
import { Icon } from "../icons";

/** 구분(노션 select) → 짧은 라벨 + 색 토큰. */
const CATS: { key: string; short: string; tone: string }[] = [
  { key: "학원 일정", short: "학원", tone: "blue" },
  { key: "학교 일정", short: "학교", tone: "purple" },
  { key: "강사 일정", short: "강사", tone: "green" },
  { key: "공휴일은 휴원합니다.", short: "휴원", tone: "red" },
  { key: "할일", short: "할일", tone: "orange" },
];
function catInfo(category: string) {
  return CATS.find((c) => c.key === category) || { key: category, short: category || "기타", tone: "gray" };
}
const monthKey = (d: string) => d.slice(0, 7);
const monthLabel = (ym: string) => `${+ym.slice(0, 4)}년 ${+ym.slice(5, 7)}월`;
const ymd = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

function StatusBadge({ s }: { s: string }) {
  if (s === "완료") return <span className="badge b-green">완료</span>;
  if (s === "취소") return <span className="badge b-gray">취소</span>;
  if (s === "진행 중") return <span className="badge b-orange">진행 중</span>;
  return null;
}

/* ---------- 목록 보기 ---------- */
function Row({ it }: { it: ScheduleItem }) {
  const c = catInfo(it.category);
  const dateText = it.dateEnd && it.dateEnd !== it.date ? `${fmtMDDow(it.date)} ~ ${fmtMDDow(it.dateEnd)}` : fmtMDDow(it.date);
  const cancelled = it.status === "취소";
  return (
    <div className="mk-item">
      <div className="sch-date">{dateText}</div>
      <div className="mk-main">
        <div className="mk-name" style={cancelled ? { textDecoration: "line-through", color: "var(--ink3)" } : undefined}>
          {it.title} <span className={"badge b-" + c.tone}>{c.short}</span>
        </div>
      </div>
      <StatusBadge s={it.status} />
    </div>
  );
}
function MonthCard({ ym, items }: { ym: string; items: ScheduleItem[] }) {
  return (
    <div className="card sec-gap">
      <div className="card-head">
        <div>
          <div className="card-title">{monthLabel(ym)}</div>
          <div className="card-sub">{items.length}건</div>
        </div>
      </div>
      <div className="mk-list" style={{ marginTop: 8 }}>
        {items.map((it) => (
          <Row key={it.id} it={it} />
        ))}
      </div>
    </div>
  );
}

/* ---------- 달력 보기 ---------- */
function Calendar({ ym, items, onShift }: { ym: string; items: ScheduleItem[]; onShift: (d: number) => void }) {
  const today = todayStr();
  const cells = useMemo(() => {
    const [y, m] = ym.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const count = Math.ceil((startDow + daysInMonth) / 7) * 7;
    return Array.from({ length: count }, (_, i) => new Date(y, m - 1, 1 - startDow + i));
  }, [ym]);
  const [y, m] = ym.split("-").map(Number);

  function eventsOn(dateStr: string) {
    return items.filter((it) => it.date <= dateStr && dateStr <= (it.dateEnd || it.date));
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="cal-head">
        <div className="cal-nav">
          <button className="rep-x" onClick={() => onShift(-1)} title="이전 달" style={{ transform: "rotate(90deg)" }}>
            <Icon name="chev" />
          </button>
          <div className="cal-month">{monthLabel(ym)}</div>
          <button className="rep-x" onClick={() => onShift(1)} title="다음 달" style={{ transform: "rotate(-90deg)" }}>
            <Icon name="chev" />
          </button>
        </div>
      </div>
      <div className="cal-grid">
        {DOW.map((d, i) => (
          <div key={d} className={"cal-dow" + (i === 0 ? " sun" : "")}>{d}</div>
        ))}
        {cells.map((dt) => {
          const ds = ymd(dt);
          const out = dt.getMonth() !== m - 1 || dt.getFullYear() !== y;
          const evs = out ? [] : eventsOn(ds);
          return (
            <div key={ds} className={"cal-cell" + (out ? " out" : "") + (ds === today ? " today" : "")}>
              <div className={"cal-daynum" + (dt.getDay() === 0 ? " sun" : "")}>{dt.getDate()}</div>
              {evs.slice(0, 3).map((it) => {
                const c = catInfo(it.category);
                return (
                  <div key={it.id} className={"cal-evt b-" + c.tone} title={`${it.title} (${c.short})`}>
                    {it.title}
                  </div>
                );
              })}
              {evs.length > 3 && <div className="cal-more">+{evs.length - 3}건</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Schedule() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [off, setOff] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [showPast, setShowPast] = useState(false);
  const [viewYm, setViewYm] = useState(todayStr().slice(0, 7));

  async function load() {
    setLoading(true);
    setError(undefined);
    const r = await fetchSchedule();
    setItems([...r.items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
    setError(r.error);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  const today = todayStr();
  const visible = items.filter((it) => !off.has(catInfo(it.category).short));
  const upcoming = visible.filter((it) => (it.dateEnd || it.date) >= today);
  const past = visible.filter((it) => (it.dateEnd || it.date) < today).reverse();

  function groupByMonth(list: ScheduleItem[]): { ym: string; items: ScheduleItem[] }[] {
    const map = new Map<string, ScheduleItem[]>();
    for (const it of list) (map.get(monthKey(it.date)) || map.set(monthKey(it.date), []).get(monthKey(it.date))!).push(it);
    return [...map.entries()].map(([ym, items]) => ({ ym, items }));
  }

  function toggleCat(short: string) {
    setOff((prev) => {
      const n = new Set(prev);
      if (n.has(short)) n.delete(short); else n.add(short);
      return n;
    });
  }
  function shiftMonth(delta: number) {
    const [y, m] = viewYm.split("-").map(Number);
    const dt = new Date(y, m - 1 + delta, 1);
    setViewYm(`${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`);
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <div className="page-title">학원 일정</div>
          <div className="page-desc">노션 ‘학원 일정’에서 불러옵니다 · 보기 전용</div>
        </div>
        <div className="head-actions">
          <div className="seg-toggle">
            <button className={view === "calendar" ? "on" : ""} onClick={() => setView("calendar")}>달력</button>
            <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>목록</button>
          </div>
          <button className="btn ghost" onClick={() => void load()} disabled={loading}>
            <span className={loading ? "spin" : undefined}><Icon name="refresh" /></span>
            새로고침
          </button>
        </div>
      </div>

      <div className="sch-filters">
        {CATS.map((c) => (
          <button key={c.key} className={"sch-chip b-" + c.tone + (off.has(c.short) ? " off" : "")} onClick={() => toggleCat(c.short)}>
            {c.short}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card"><Empty>불러오는 중…</Empty></div>
      ) : error ? (
        <div className="card">
          <div className="empty" style={{ flexDirection: "column", gap: 10 }}>
            <div style={{ fontWeight: 700, color: "var(--bad)" }}>일정을 불러오지 못했어요.</div>
            <div style={{ color: "var(--ink3)", fontSize: "var(--t-sm)" }}>
              {error}
              <br />
              노션에서 ‘학원 일정 DB’를 통합(integration)에 공유했는지 확인해 주세요.
            </div>
            <button className="btn primary" onClick={() => void load()}>다시 시도</button>
          </div>
        </div>
      ) : view === "calendar" ? (
        <Calendar ym={viewYm} items={visible} onShift={shiftMonth} />
      ) : (
        <>
          {groupByMonth(upcoming).length === 0 ? (
            <div className="card"><Empty>다가오는 일정이 없습니다.</Empty></div>
          ) : (
            groupByMonth(upcoming).map((g) => <MonthCard key={g.ym} ym={g.ym} items={g.items} />)
          )}
          {past.length > 0 && (
            <>
              <button className="btn ghost sm" style={{ margin: "4px 0 12px" }} onClick={() => setShowPast((v) => !v)}>
                <Icon name="chev" />
                지난 일정 {showPast ? "접기" : `보기 (${past.length})`}
              </button>
              {showPast && groupByMonth(past).map((g) => <MonthCard key={"p" + g.ym} ym={g.ym} items={g.items} />)}
            </>
          )}
        </>
      )}
    </section>
  );
}
