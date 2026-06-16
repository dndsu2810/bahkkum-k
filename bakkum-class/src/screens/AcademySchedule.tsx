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
  // 달력용 — 기간 일정은 시작~종료 모든 날짜 칸에 표시(이번 달 칸만).
  const byDateSpan = useMemo(() => {
    const m: Record<string, EventItem[]> = {};
    for (const e of events) {
      const end = e.endDate && e.endDate >= e.date ? e.endDate : e.date;
      let cur = e.date;
      for (let guard = 0; cur <= end && guard < 400; guard++) {
        if (cur.slice(0, 7) === ym) (m[cur] ||= []).push(e);
        cur = addDay(cur);
      }
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    return m;
  }, [events, ym]);

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
          byDate={byDateSpan}
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
/** YYYY-MM-DD 다음 날 문자열. */
function addDay(s: string): string {
  return shiftDate(s, 1);
}
/** YYYY-MM-DD 에서 n일 이동한 날짜 문자열. */
function shiftDate(s: string, n: number): string {
  const d = parseD(s);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const catCls = (c: string) => "cg-ev cg-ev-" + (CATS.includes(c) ? c : "학원");

/** 월 달력(그리드) — 일~토 7열. 칸 클릭=그날 추가, 일정 클릭=수정, 일정 드래그=날짜 이동. */
function CalendarGrid({
  ym,
  byDate,
  today,
  canEdit,
  onPickDate,
  onPickEvent,
  onMove,
}: {
  ym: string;
  byDate: Record<string, EventItem[]>;
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

  // 드래그 중인 일정(id|잡은날) · 드롭 대상 칸 하이라이트.
  const [drag, setDrag] = useState<{ id: string; src: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  return (
    <div className="cg">
      {canEdit && <div className="cg-hint">일정을 끌어다 다른 날짜로 옮길 수 있어요. 클릭하면 수정·삭제.</div>}
      <div className="cg-head">
        {DOW.map((w, i) => (
          <div key={w} className={"cg-hd" + (i === 0 ? " sun" : i === 6 ? " sat" : "")}>{w}</div>
        ))}
      </div>
      <div className="cg-grid">
        {cells.map((d, i) => {
          if (!d) return <div className="cg-cell empty" key={i} />;
          const evs = byDate[d] || [];
          const dom = i % 7;
          return (
            <div
              className={"cg-cell" + (d === today ? " today" : "") + (over === d && drag && drag.src !== d ? " drop-over" : "")}
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
              <div className={"cg-dnum" + (dom === 0 ? " sun" : dom === 6 ? " sat" : "")}>{Number(d.slice(8, 10))}</div>
              <div className="cg-evs">
                {evs.slice(0, 4).map((e) => (
                  <button
                    key={e.id}
                    className={catCls(e.category) + (drag?.id === e.id ? " dragging" : "")}
                    title={`${e.title}${e.memo ? " · " + e.memo : ""}`}
                    draggable={canEdit}
                    onClick={(ev) => { ev.stopPropagation(); onPickEvent(e); }}
                    onDragStart={(ev) => { setDrag({ id: e.id, src: d }); ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", e.id); }}
                    onDragEnd={() => { setDrag(null); setOver(null); }}
                  >
                    {e.title}
                  </button>
                ))}
                {evs.length > 4 && <div className="cg-more">+{evs.length - 4}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
