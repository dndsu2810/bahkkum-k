import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useAuth } from "../auth";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { ProfileModal } from "../screens/StudentMaster";
import { DOW, DOW_ORDER, TODAY, fmtMD, mondayOf, parseD, timeToMin, ymd } from "../lib/dates";
import { activeStudents, attendsOn, effectiveLessons, gradeColor, studentById } from "../lib/logic";
import { holidayName } from "../lib/holidays";
import { getCategories, type Tone } from "../lib/categories";
import { Select } from "../components/ui";

interface Person { name: string; studentId: string }
interface RawEvt {
  name: string;
  studentId: string;
  start: number;
  dur: number;
  type: Tone;
  time: string;
}
interface Grp {
  people: Person[];
  start: number;
  dur: number;
  type: Tone;
  time: string;
}
// Merge students sharing the exact same slot (start+duration+grade) into ONE
// block — so a busy time shows one wide block with the names listed.
function groupSlots(list: RawEvt[]): Grp[] {
  const map = new Map<string, Grp>();
  for (const e of list) {
    const key = e.start + "|" + e.dur + "|" + e.type;
    let g = map.get(key);
    if (!g) {
      g = { people: [], start: e.start, dur: e.dur, type: e.type, time: e.time };
      map.set(key, g);
    }
    g.people.push({ name: e.name, studentId: e.studentId });
  }
  for (const g of map.values()) g.people.sort((a, b) => a.name.localeCompare(b.name));
  return [...map.values()];
}

const WEEK_OPTS = [
  { v: "-1", l: "지난주" },
  { v: "0", l: "이번주" },
  { v: "1", l: "다음주" },
  { v: "2", l: "2주 후" },
];

export function Timetable() {
  const { data } = useStore();
  const { user } = useAuth();
  const canEdit = !!user && user.role !== "student";
  const [curWeek, setCurWeek] = useState(0);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { getRoster().then(setRoster).catch(() => { /* 명단 없으면 이름은 보이되 클릭만 비활성 */ }); }, []);
  const openStudent = roster.find((r) => r.id === openId) || null;
  const applyLocal = (next: RosterStudent) => setRoster((cur) => cur.map((r) => (r.id === next.id ? next : r)));

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

  // events per weekday index (0=월 ... 6=일) — 각 날짜에 유효한 시간표(버전) 사용
  const evtByDay: RawEvt[][] = [[], [], [], [], [], [], []];
  activeStudents(data.students).forEach((s) =>
    DOW_ORDER.forEach((dow, di) => {
      const dateStr = ymd(dates[di]);
      if (holidayName(dateStr)) return; // 공휴일은 수업 없음
      if (!attendsOn(s, dateStr)) return;
      effectiveLessons(s, dateStr).forEach((l) => {
        if (l.day !== dow) return;
        evtByDay[di].push({
          name: s.name,
          studentId: s.id,
          start: timeToMin(l.time),
          dur: +l.duration,
          type: gradeColor(s.grade),
          time: l.time,
        });
      });
    })
  );
  // 이번 주 보강 (예정 + 완료 둘 다 표시) — 완료 처리해도 시간표에서 사라지지 않게.
  data.makeups.forEach((k) => {
    if ((k.status !== "scheduled" && k.status !== "done") || !k.makeupDate) return;
    const dd = parseD(k.makeupDate);
    dd.setHours(0, 0, 0, 0);
    if (dd >= mon && dd <= sun) {
      const di = DOW_ORDER.indexOf(DOW[dd.getDay()]);
      if (di < 0) return;
      const s = studentById(data.students, k.studentId);
      evtByDay[di].push({
        name: s ? s.name : "?",
        studentId: k.studentId,
        start: timeToMin(k.makeupTime),
        dur: +k.makeupDuration,
        type: "orange",
        time: k.makeupTime,
      });
    }
  });

  // 평일(월~금)은 항상, 토·일은 그 주에 수업/보강이 있을 때만 보여준다.
  const visIdx = [0, 1, 2, 3, 4, 5, 6].filter((i) => i < 5 || evtByDay[i].length > 0);
  const nCols = visIdx.length;
  const colStyle = { gridTemplateColumns: `repeat(${nCols}, minmax(150px, 1fr))`, minWidth: nCols * 150 };

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">수학 주간 시간표</h1>
          <div className="page-desc">{rangeLabel} · 정규 수업 및 보강</div>
        </div>
        <div className="head-actions">
          <Select value={String(curWeek)} onChange={(v) => setCurWeek(+v)} options={WEEK_OPTS} />
        </div>
      </div>

      <div className="card eng-week">
        <div className="eng-week-scroll">
          <div className="eng-week-grid" style={colStyle}>
            {visIdx.map((c) => {
              const isToday = dates[c].getTime() === TODAY.getTime();
              const hol = holidayName(ymd(dates[c]));
              const blocks = groupSlots(evtByDay[c]).sort((a, b) => a.start - b.start || a.dur - b.dur);
              return (
                <div className={"eng-wcol" + (isToday ? " today" : "")} key={c}>
                  <div className={"eng-whead" + (isToday ? " today" : "") + (hol ? " holiday" : "")}>
                    <div className="eng-wdow">{DOW_ORDER[c]}</div>
                    <div className="eng-wdate">{fmtMD(dates[c])}{hol ? " · " + hol : ""}</div>
                  </div>
                  <div className="eng-wbody">
                    {blocks.length === 0 ? (
                      <div className="eng-wempty">—</div>
                    ) : (
                      blocks.map((e, i) => (
                        <div className={"eng-wevt evt-" + e.type} key={i} title={`${e.time} · ${e.dur}분 (${e.people.length}명)`}>
                          <div className="eng-wtime">
                            {e.time}
                            <span className="eng-wdur">{e.dur}분</span>
                            {e.people.length > 1 && <span className="e-cnt">{e.people.length}</span>}
                          </div>
                          <div className="eng-wnames">
                            {e.people.map((p, j) =>
                              roster.some((r) => r.id === p.studentId) ? (
                                <button type="button" className="eng-wnm is-link" key={j} onClick={() => setOpenId(p.studentId)} title="학생 정보 보기">{p.name}</button>
                              ) : (
                                <span className="eng-wnm" key={j}>{p.name}</span>
                              )
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="tt-legend">
          {getCategories().map((c) => (
            <div className="tt-leg" key={c.name}>
              <span className="sw" style={{ background: "var(--" + c.tone + "-bg)" }} />
              {c.name}
            </div>
          ))}
          <div className="tt-leg">
            <span className="sw" style={{ background: "var(--orange-bg)", border: "1px solid #ffd9b8" }} />
            보강
          </div>
          <div className="tt-leg" style={{ marginLeft: "auto", color: "var(--text3)" }}>
            오늘은 파란색으로 강조됩니다
          </div>
        </div>
      </div>

      {openStudent && (
        <ProfileModal key={openStudent.id} student={openStudent} canEdit={canEdit} onClose={() => setOpenId(null)} onSaved={applyLocal} />
      )}
    </section>
  );
}
