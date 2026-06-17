import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { eventsApi, type EventItem } from "../lib/hubApi";
import { DOW, pad, parseD, todayStr } from "../lib/dates";
import { DateField } from "../components/DateControls";

const CATS = ["학원", "학교", "강사", "휴원", "할일"];
const catClass = (c: string) => "ev-cat ev-cat-" + (CATS.includes(c) ? c : "학원");

type Editing = { id?: string; date: string; endDate: string; title: string; category: string; memo: string } | null;

/** 학원 일정(공용) — 전 스태프가 보고 추가·수정. 월 단위 날짜별 목록. */
export function AcademySchedule() {
  const { user } = useAuth();
  const canEdit = user?.role !== "student";
  const [ym, setYm] = useState(() => todayStr().slice(0, 7)); // YYYY-MM
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<Editing>(null);
  const [view, setView] = useState<"cal" | "list">("cal");

  async function reload() {
    setLoading(true);
    try {
      // 넉넉히 이번 달 1일부터 가져와 다음 달 이동 시도 캐시 효과.
      setEvents(await eventsApi.list(ym + "-01"));
      setErr("");
    } catch {
      setErr("일정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym]);
  // 창에 다시 포커스가 오면(설정에서 노션 동기화 후 돌아오는 등) 최신 일정으로 새로고침 — 반영 지연 완화.
  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym]);

  const monthEvents = useMemo(
    () => events.filter((e) => e.date.slice(0, 7) === ym).sort((a, b) => a.date.localeCompare(b.date)),
    [events, ym]
  );
  // 목록용 — 시작일 1회(기간은 '~종료' 라벨로 표시).
  const byDate = useMemo(() => {
    const m: Record<string, EventItem[]> = {};
    for (const e of monthEvents) (m[e.date] ||= []).push(e);
    return m;
  }, [monthEvents]);

  function shiftMonth(delta: number) {
    const [y, mo] = ym.split("-").map(Number);
    const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
    setYm(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  }
  const dow = (s: string) => DOW[parseD(s).getDay()];

  async function remove(e: EventItem) {
    if (!window.confirm(`"${e.title}" 일정을 삭제할까요?`)) return;
    try {
      await eventsApi.remove(e.id);
      await reload();
    } catch {
      setErr("삭제에 실패했어요.");
    }
  }
  // 수정 모달(달력·목록 공용)에서 바로 삭제 — 달력에서도 삭제 가능하게.
  async function removeEditing() {
    if (!edit?.id) return;
    if (!window.confirm(`"${edit.title}" 일정을 삭제할까요?`)) return;
    try {
      await eventsApi.remove(edit.id);
      setEdit(null);
      await reload();
    } catch {
      setErr("삭제에 실패했어요.");
    }
  }
  // 드래그앤드롭 — 잡은 날(srcDay)에서 놓은 날(dstDay)만큼 일정 전체를 이동(기간이면 종료일도 같이).
  async function moveEvent(id: string, srcDay: string, dstDay: string) {
    if (!canEdit || srcDay === dstDay) return;
    const ev = events.find((e) => e.id === id);
    if (!ev) return;
    const delta = Math.round((parseD(dstDay).getTime() - parseD(srcDay).getTime()) / 86400000);
    if (!delta) return;
    const newDate = shiftDate(ev.date, delta);
    const newEnd = ev.endDate ? shiftDate(ev.endDate, delta) : "";
    // 낙관적 반영 후 저장.
    setEvents((list) => list.map((e) => (e.id === id ? { ...e, date: newDate, endDate: newEnd } : e)));
    try {
      await eventsApi.save({ id: ev.id, date: newDate, endDate: newEnd || undefined, title: ev.title, category: ev.category, memo: ev.memo });
      await reload();
    } catch {
      setErr("일정 이동에 실패했어요.");
      await reload();
    }
  }
  async function save() {
    if (!edit || !edit.date || !edit.title.trim()) return;
    try {
      await eventsApi.save({
        id: edit.id,
        date: edit.date,
        endDate: edit.endDate || undefined,
        title: edit.title.trim(),
        category: edit.category,
        memo: edit.memo,
      });
      setEdit(null);
      await reload();
    } catch {
      setErr("저장에 실패했어요.");
    }
  }

  const today = todayStr();
  return (
    <div className="sm-wrap">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">학원 일정</h1>
          <p className="sm-desc">모든 선생님이 함께 보고 추가·수정합니다.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canEdit && (
            <button className="btn primary" onClick={() => setEdit({ date: today, endDate: "", title: "", category: "학원", memo: "" })}>
              일정 추가
            </button>
          )}
        </div>
      </div>

      <div className="cal-nav">
        <button className="btn ghost sm" onClick={() => shiftMonth(-1)}>‹ 이전</button>
        <div className="cal-month">{ym.replace("-", ". ")}</div>
        <button className="btn ghost sm" onClick={() => shiftMonth(1)}>다음 ›</button>
        <button className="btn ghost sm" onClick={() => setYm(today.slice(0, 7))}>오늘</button>
        <div className="cal-viewtoggle" style={{ marginLeft: "auto" }}>
          <button className={"sm-fchip" + (view === "cal" ? " on" : "")} onClick={() => setView("cal")}>달력</button>
          <button className={"sm-fchip" + (view === "list" ? " on" : "")} onClick={() => setView("list")}>목록</button>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 12 }}>{err}</div>}

      {loading ? (
        <div className="hub-muted">불러오는 중…</div>
      ) : view === "cal" ? (
        <CalendarGrid
          ym={ym}
          events={events}
          today={today}
          canEdit={canEdit}
          onPickDate={(d) => canEdit && setEdit({ date: d, endDate: "", title: "", category: "학원", memo: "" })}
          onPickEvent={(e) => canEdit && setEdit({ id: e.id, date: e.date, endDate: e.endDate, title: e.title, category: e.category, memo: e.memo })}
          onMove={moveEvent}
        />
      ) : monthEvents.length === 0 ? (
        <div className="hub-muted" style={{ padding: 20 }}>
          이 달 일정이 없어요.{canEdit && " ‘일정 추가’로 등록해 보세요."}
        </div>
      ) : (
        <div className="cal-list">
          {Object.keys(byDate).sort().map((d) => (
            <div className={"cal-day" + (d === today ? " today" : "")} key={d}>
              <div className="cal-day-h">
                <span className="cal-day-d">{Number(d.slice(8, 10))}</span>
                <span className="cal-day-w">({dow(d)})</span>
                {d === today && <span className="cal-today-tag">오늘</span>}
              </div>
              <div className="cal-day-events">
                {byDate[d].map((e) => (
                  <div className="ev-row" key={e.id}>
                    <span className={catClass(e.category)}>{e.category}</span>
                    <div className="ev-main">
                      <div className="ev-title">
                        {e.title}
                        {e.endDate && e.endDate !== e.date && <span className="ev-range"> ~ {fmtShort(e.endDate)}</span>}
                      </div>
                      {e.memo && <div className="ev-memo">{e.memo}</div>}
                    </div>
                    {canEdit && (
                      <div className="ev-act">
                        <button className="btn ghost sm" onClick={() => setEdit({ id: e.id, date: e.date, endDate: e.endDate, title: e.title, category: e.category, memo: e.memo })}>수정</button>
                        <button className="btn ghost sm" onClick={() => remove(e)}>삭제</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <div className="prof-overlay" onClick={() => setEdit(null)}>
          <div className="prof" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="prof-top">
              <div className="prof-top-main"><div className="prof-name">{edit.id ? "일정 수정" : "일정 추가"}</div></div>
              <button className="modal-x" onClick={() => setEdit(null)} aria-label="닫기">✕</button>
            </div>
            <div className="prof-body">
              <label className="prof-field">
                <span className="prof-field-l">제목</span>
                <input className="inline-input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="예: 중간고사 대비 특강" />
              </label>
              <div className="prof-grid">
                <label className="prof-field">
                  <span className="prof-field-l">날짜</span>
                  <DateField value={edit.date} onChange={(v) => setEdit({ ...edit, date: v })} />
                </label>
                <label className="prof-field">
                  <span className="prof-field-l">종료일(선택)</span>
                  <DateField value={edit.endDate} onChange={(v) => setEdit({ ...edit, endDate: v })} placeholder="종료일 없음" />
                </label>
              </div>
              <label className="prof-field">
                <span className="prof-field-l">분류</span>
                <div className="sm-subj">
                  {CATS.map((c) => (
                    <button key={c} className={"sm-subj-chip" + (edit.category === c ? " on" : "")} onClick={() => setEdit({ ...edit, category: c })}>{c}</button>
                  ))}
                </div>
              </label>
              <label className="prof-field">
                <span className="prof-field-l">메모(선택)</span>
                <textarea className="input prof-memo" rows={3} value={edit.memo} onChange={(e) => setEdit({ ...edit, memo: e.target.value })} placeholder="상세 내용" />
              </label>
            </div>
            <div className="prof-foot">
              {edit.id && <button className="btn ghost" style={{ color: "var(--bad)", marginRight: "auto" }} onClick={removeEditing}>삭제</button>}
              <button className="btn ghost" onClick={() => setEdit(null)}>취소</button>
              <button className="btn primary" onClick={save} disabled={!edit.date || !edit.title.trim()}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtShort(s: string): string {
  const d = parseD(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
/** YYYY-MM-DD 에서 n일 이동한 날짜 문자열. */
function shiftDate(s: string, n: number): string {
  const d = parseD(s);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const catCls = (c: string) => "cg-ev cg-ev-" + (CATS.includes(c) ? c : "학원");

type Seg = { e: EventItem; startCol: number; endCol: number; lane: number; contL: boolean; contR: boolean };

/** 한 주(7칸)에서 일정 막대 구간 계산 — 기간 일정은 시작~종료를 가로 막대 하나로, 겹치면 레인(줄)을 나눔. */
function weekSegments(weekDates: (string | null)[], events: EventItem[], mFirst: string, mLast: string): Seg[] {
  const segs: Omit<Seg, "lane">[] = [];
  for (const e of events) {
    const es = e.date;
    const ee = e.endDate && e.endDate >= e.date ? e.endDate : e.date;
    const cs = es < mFirst ? mFirst : es; // 이번 달로 클램프
    const ce = ee > mLast ? mLast : ee;
    if (ce < cs) continue;
    let startCol = -1, endCol = -1;
    for (let i = 0; i < 7; i++) {
      const d = weekDates[i];
      if (d && d >= cs && d <= ce) { if (startCol < 0) startCol = i; endCol = i; }
    }
    if (startCol < 0) continue;
    segs.push({ e, startCol, endCol, contL: cs < (weekDates[startCol] as string), contR: ce > (weekDates[endCol] as string) });
  }
  // 시작 칸 → 긴 것 우선으로 정렬 후 레인 그리디 배정.
  segs.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol) || a.e.date.localeCompare(b.e.date));
  const laneEnd: number[] = []; // 레인별 마지막 점유 칸
  const out: Seg[] = [];
  for (const s of segs) {
    let lane = 0;
    while (lane < laneEnd.length && laneEnd[lane] >= s.startCol) lane++;
    laneEnd[lane] = s.endCol;
    out.push({ ...s, lane });
  }
  return out;
}

/** 월 달력(그리드) — 일~토 7열, 주 단위 막대. 칸 클릭=그날 추가, 막대 클릭=수정, 막대 드래그=날짜 이동. */
function CalendarGrid({
  ym,
  events,
  today,
  canEdit,
  onPickDate,
  onPickEvent,
  onMove,
}: {
  ym: string;
  events: EventItem[];
  today: string;
  canEdit: boolean;
  onPickDate: (d: string) => void;
  onPickEvent: (e: EventItem) => void;
  onMove: (id: string, srcDay: string, dstDay: string) => void;
}) {
  const [y, mo] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const startDow = first.getUTCDay(); // 0=일
  const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(`${ym}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const mFirst = `${ym}-01`;
  const mLast = `${ym}-${pad(daysIn)}`;

  // 드래그 중인 일정(id|시작일) · 드롭 대상 칸 하이라이트.
  const [drag, setDrag] = useState<{ id: string; src: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  return (
    <div className="cg">
      {canEdit && <div className="cg-hint">막대를 끌어다 다른 날짜로 옮길 수 있어요. 클릭하면 수정·삭제.</div>}
      <div className="cg-head">
        {DOW.map((w, i) => (
          <div key={w} className={"cg-hd" + (i === 0 ? " sun" : i === 6 ? " sat" : "")}>{w}</div>
        ))}
      </div>
      <div className="cg-weeks">
        {weeks.map((week, wi) => {
          const segs = weekSegments(week, events, mFirst, mLast);
          const lanes = segs.reduce((mx, s) => Math.max(mx, s.lane + 1), 0);
          return (
            <div className="cgw" key={wi} style={{ ["--lanes" as string]: lanes }}>
              <div className="cgw-bg">
                {week.map((d, i) => {
                  if (!d) return <div className="cg-cell empty" key={i} />;
                  return (
                    <div
                      className={"cg-cell" + (d === today ? " today" : "") + (over === d && drag ? " drop-over" : "")}
                      key={i}
                      onClick={() => onPickDate(d)}
                      onDragOver={(ev) => { if (drag) { ev.preventDefault(); if (over !== d) setOver(d); } }}
                      onDragLeave={() => setOver((o) => (o === d ? null : o))}
                      onDrop={(ev) => {
                        ev.preventDefault();
                        if (drag) onMove(drag.id, drag.src, d);
                        setDrag(null);
                        setOver(null);
                      }}
                    >
                      <div className={"cg-dnum" + (i === 0 ? " sun" : i === 6 ? " sat" : "")}>{Number(d.slice(8, 10))}</div>
                    </div>
                  );
                })}
              </div>
              <div className="cgw-bars">
                {segs.map((s) => (
                  <button
                    key={s.e.id}
                    className={catCls(s.e.category) + (s.contL ? " contL" : "") + (s.contR ? " contR" : "") + (drag?.id === s.e.id ? " dragging" : "")}
                    style={{ gridColumn: `${s.startCol + 1} / ${s.endCol + 2}`, gridRow: s.lane + 1 }}
                    title={`${s.e.title}${s.e.memo ? " · " + s.e.memo : ""}`}
                    draggable={canEdit}
                    onClick={(ev) => { ev.stopPropagation(); onPickEvent(s.e); }}
                    onDragStart={(ev) => { setDrag({ id: s.e.id, src: s.e.date }); ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", s.e.id); }}
                    onDragEnd={() => { setDrag(null); setOver(null); }}
                  >
                    {s.contL ? "◂ " : ""}{s.e.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
