import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { eventsApi, type EventItem } from "../lib/hubApi";
import { DOW, pad, parseD, todayStr } from "../lib/dates";

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
      setErr("일정을 불러오지 못했어요. (배포 환경에서만 동작)");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym]);

  const monthEvents = useMemo(
    () => events.filter((e) => e.date.slice(0, 7) === ym).sort((a, b) => a.date.localeCompare(b.date)),
    [events, ym]
  );
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
          byDate={byDate}
          today={today}
          onPickDate={(d) => canEdit && setEdit({ date: d, endDate: "", title: "", category: "학원", memo: "" })}
          onPickEvent={(e) => canEdit && setEdit({ id: e.id, date: e.date, endDate: e.endDate, title: e.title, category: e.category, memo: e.memo })}
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
                  <input className="inline-input" type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
                </label>
                <label className="prof-field">
                  <span className="prof-field-l">종료일(선택)</span>
                  <input className="inline-input" type="date" value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} />
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

const catCls = (c: string) => "cg-ev cg-ev-" + (CATS.includes(c) ? c : "학원");

/** 월 달력(그리드) — 일~토 7열. 칸 클릭=그날 추가, 일정 클릭=수정. */
function CalendarGrid({
  ym,
  byDate,
  today,
  onPickDate,
  onPickEvent,
}: {
  ym: string;
  byDate: Record<string, EventItem[]>;
  today: string;
  onPickDate: (d: string) => void;
  onPickEvent: (e: EventItem) => void;
}) {
  const [y, mo] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const startDow = first.getUTCDay(); // 0=일
  const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(`${ym}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="cg">
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
            <div className={"cg-cell" + (d === today ? " today" : "")} key={i} onClick={() => onPickDate(d)}>
              <div className={"cg-dnum" + (dom === 0 ? " sun" : dom === 6 ? " sat" : "")}>{Number(d.slice(8, 10))}</div>
              <div className="cg-evs">
                {evs.slice(0, 4).map((e) => (
                  <button
                    key={e.id}
                    className={catCls(e.category)}
                    title={`${e.title}${e.memo ? " · " + e.memo : ""}`}
                    onClick={(ev) => { ev.stopPropagation(); onPickEvent(e); }}
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
