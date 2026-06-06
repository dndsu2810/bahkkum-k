import { useState } from "react";
import { useStore } from "../store";
import {
  DOW,
  DOW_ORDER,
  ROW_H,
  TODAY,
  TT_END,
  TT_START,
  fmtMD,
  mondayOf,
  parseD,
  timeToMin,
} from "../lib/dates";
import { activeStudents, gradeColor, studentById } from "../lib/logic";
import { Select } from "../components/ui";

interface Evt {
  name: string;
  start: number;
  dur: number;
  type: "blue" | "purple" | "orange";
  time: string;
  end: number;
  _col: number;
  _cols: number;
  _span: number;
}

// Calendar-style packing: events only narrow for the classes they ACTUALLY
// overlap, and expand to fill any free space to their right.
function laneEvents(list: Omit<Evt, "end" | "_col" | "_cols" | "_span">[]): Evt[] {
  if (!list.length) return [];
  const evs = list.map((e) => ({ ...e, end: e.start + e.dur })) as Evt[];
  evs.sort((a, b) => a.start - b.start || a.end - b.end);
  let columns: Evt[][] = [];
  let lastEnd: number | null = null;
  function flush() {
    const n = columns.length;
    columns.forEach((col, ci) => {
      col.forEach((e) => {
        let span = 1;
        for (let c = ci + 1; c < n; c++) {
          const free = columns[c].every((o) => o.start >= e.end || o.end <= e.start);
          if (free) span++;
          else break;
        }
        e._col = ci;
        e._cols = n;
        e._span = span;
      });
    });
    columns = [];
    lastEnd = null;
  }
  evs.forEach((e) => {
    if (lastEnd !== null && e.start >= lastEnd) flush();
    let placed = false;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col[col.length - 1].end <= e.start) {
        col.push(e);
        placed = true;
        break;
      }
    }
    if (!placed) columns.push([e]);
    lastEnd = lastEnd === null ? e.end : Math.max(lastEnd, e.end);
  });
  if (columns.length) flush();
  return evs;
}

const WEEK_OPTS = [
  { v: "-1", l: "지난주" },
  { v: "0", l: "이번주" },
  { v: "1", l: "다음주" },
  { v: "2", l: "2주 후" },
];

export function Timetable() {
  const { data } = useStore();
  const [curWeek, setCurWeek] = useState(0);

  const mon = mondayOf(TODAY, curWeek);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const rangeLabel = fmtMD(mon) + " ~ " + fmtMD(sun);

  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(mon);
    dd.setDate(mon.getDate() + i);
    dates.push(dd);
  }

  // events per weekday index (0=월 ... 6=일)
  const evtByDay: Omit<Evt, "end" | "_col" | "_cols" | "_span">[][] = [[], [], [], [], [], [], []];
  activeStudents(data.students).forEach((s) =>
    (s.lessons || []).forEach((l) => {
      const di = DOW_ORDER.indexOf(l.day);
      if (di < 0) return;
      evtByDay[di].push({
        name: s.name,
        start: timeToMin(l.time),
        dur: +l.duration,
        type: gradeColor(s.grade),
        time: l.time,
      });
    })
  );
  // scheduled makeups in this week
  data.makeups.forEach((k) => {
    if (k.status !== "scheduled" || !k.makeupDate) return;
    const dd = parseD(k.makeupDate);
    dd.setHours(0, 0, 0, 0);
    if (dd >= mon && dd <= sun) {
      const di = DOW_ORDER.indexOf(DOW[dd.getDay()]);
      if (di < 0) return;
      const s = studentById(data.students, k.studentId);
      evtByDay[di].push({
        name: s ? s.name : "?",
        start: timeToMin(k.makeupTime),
        dur: +k.makeupDuration,
        type: "orange",
        time: k.makeupTime,
      });
    }
  });

  const hours: number[] = [];
  for (let h = TT_START; h < TT_END; h++) hours.push(h);

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <div className="page-title">주간 시간표</div>
          <div className="page-desc">{rangeLabel} · 정규 수업 및 보강</div>
        </div>
        <div className="head-actions">
          <Select value={String(curWeek)} onChange={(v) => setCurWeek(+v)} options={WEEK_OPTS} />
        </div>
      </div>

      <div className="card tt-card">
        <div className="tt-scroll">
          <div className="tt-grid">
            <div className="tt-corner" />
            {DOW_ORDER.map((dow, c) => {
              const isToday = dates[c].getTime() === TODAY.getTime();
              return (
                <div className={"tt-dayhead" + (isToday ? " today" : "")} key={dow}>
                  <div className="tt-dow">{dow}</div>
                  <div className="tt-date">{fmtMD(dates[c])}</div>
                </div>
              );
            })}
            <div className="tt-gutter">
              {hours.map((h) => (
                <div className="tt-hour" key={h}>
                  {h}:00
                </div>
              ))}
            </div>
            {dates.map((dt, ci) => {
              const todayCol = dt.getTime() === TODAY.getTime();
              const events = laneEvents(evtByDay[ci]);
              return (
                <div className={"tt-col" + (todayCol ? " today" : "")} key={ci}>
                  {hours.map((h) => (
                    <div className="tt-rowline" key={h} />
                  ))}
                  {events.map((e, i) => {
                    const top = ((e.start - TT_START * 60) / 60) * ROW_H;
                    const hgt = Math.max((e.dur / 60) * ROW_H - 3, 24);
                    const w = (e._span / e._cols) * 100;
                    const left = (e._col / e._cols) * 100;
                    return (
                      <div
                        className={"tt-evt evt-" + e.type}
                        key={i}
                        style={{
                          top,
                          height: hgt,
                          left: `calc(${left}% + 3px)`,
                          width: `calc(${w}% - 6px)`,
                        }}
                      >
                        <div className="e-name">{e.name}</div>
                        <div className="e-time">
                          {e.time} · {e.dur}분
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <div className="tt-legend">
          <div className="tt-leg">
            <span className="sw" style={{ background: "var(--blue-bg)", border: "1px solid #cfe0fb" }} />
            초등
          </div>
          <div className="tt-leg">
            <span className="sw" style={{ background: "var(--purple-bg)", border: "1px solid #e6d8fc" }} />
            중등
          </div>
          <div className="tt-leg">
            <span className="sw" style={{ background: "var(--orange-bg)", border: "1px solid #ffd9b8" }} />
            보강
          </div>
          <div className="tt-leg" style={{ marginLeft: "auto", color: "var(--text3)" }}>
            오늘 컬럼은 파란색으로 강조됩니다
          </div>
        </div>
      </div>
    </section>
  );
}
