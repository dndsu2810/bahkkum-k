import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { studentApi, STUDENT_LOG_ITEMS, type StudentPageData, type CurriculumItem, type StudentLogRow } from "../lib/studentApi";
import { DOW, DOW_ORDER, fmtFull, fmtMDDow, parseD, timeToMin, todayStr } from "../lib/dates";

/** 학생 개별 페이지(시간표 · 커리큘럼 · 일지 입력/이력).
 *  - 학생 본인: studentId 생략(본인). 일지 입력 가능, 커리큘럼 조회.
 *  - 강사/원장: studentId 지정. 커리큘럼 편집 + 일지 대리 입력. */
export function StudentPage({ studentId, embedded }: { studentId?: string; embedded?: boolean }) {
  const [data, setData] = useState<StudentPageData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const d = await studentApi.page(studentId);
      setData(d);
      setErr("");
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  if (loading) return <div className="sp-empty">불러오는 중…</div>;
  if (err || !data) return <div className="sp-empty">불러오지 못했어요{err ? ` (${err})` : ""}.</div>;

  const canEditCur = data.canEditCurriculum;
  const s = data.student;

  return (
    <div className={"sp" + (embedded ? " is-embed" : "")}>
      {/* 헤더 — 학생 프로필 */}
      <div className="sp-head">
        {s.photo ? <img className="sp-avatar" src={s.photo} alt="" /> : <div className="sp-avatar sp-avatar-empty">{s.name.slice(0, 1)}</div>}
        <div className="sp-head-info">
          <h2>{s.name}</h2>
          <div className="sp-sub">
            {[s.grade, s.school, s.band === "elem" ? "초등 영어" : s.band === "mid" ? "중고등 영어" : ""].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      <div className="sp-grid">
        {/* 시간표 */}
        <section className="sp-card">
          <h3 className="sp-card-h">수업 시간표</h3>
          <Timetable slots={data.engSlots} />
        </section>

        {/* 커리큘럼 */}
        <section className="sp-card">
          <h3 className="sp-card-h">커리큘럼</h3>
          {canEditCur ? (
            <CurriculumEditor studentId={s.id} items={data.curriculum} onSaved={load} />
          ) : (
            <CurriculumView items={data.curriculum} />
          )}
        </section>
      </div>

      {/* 일지 입력 */}
      <section className="sp-card">
        <h3 className="sp-card-h">{canEditCur ? "수업 일지 입력" : "오늘 수업 일지"}</h3>
        <LogEditor studentId={canEditCur ? s.id : undefined} existing={data.daily} slots={data.engSlots} onSaved={load} />
      </section>

      {/* 일지 이력 */}
      <section className="sp-card">
        <h3 className="sp-card-h">지난 일지</h3>
        <LogHistory rows={data.daily} />
      </section>
    </div>
  );
}

/* ---------------- 시간표 ---------------- */
function Timetable({ slots }: { slots: { day: string; time: string; duration: number }[] }) {
  if (!slots.length) return <div className="sp-muted">등록된 영어 수업 시간이 없어요.</div>;
  const byDay: Record<string, { time: string; duration: number }[]> = {};
  for (const sl of slots) (byDay[sl.day] ||= []).push({ time: sl.time, duration: sl.duration });
  const days = DOW_ORDER.filter((d) => byDay[d]);
  return (
    <div className="sp-tt">
      {days.map((d) => (
        <div className="sp-tt-row" key={d}>
          <span className="sp-tt-day">{d}</span>
          <span className="sp-tt-times">
            {byDay[d]
              .sort((a, b) => timeToMin(a.time) - timeToMin(b.time))
              .map((t, i) => (
                <span className="sp-tt-chip" key={i}>
                  {t.time}
                  {t.duration ? <em> · {t.duration}분</em> : null}
                </span>
              ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- 커리큘럼(조회) ---------------- */
function CurriculumView({ items }: { items: CurriculumItem[] }) {
  if (!items.length) return <div className="sp-muted">아직 커리큘럼이 등록되지 않았어요.</div>;
  return (
    <dl className="sp-cur">
      {items.map((it, i) => (
        <div className="sp-cur-row" key={i}>
          <dt>{it.label}</dt>
          <dd>{it.value || <span className="sp-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- 커리큘럼(편집, 강사) ---------------- */
function CurriculumEditor({ studentId, items, onSaved }: { studentId: string; items: CurriculumItem[]; onSaved: () => void }) {
  const [rows, setRows] = useState<CurriculumItem[]>(items);
  const [saving, setSaving] = useState(false);
  useEffect(() => setRows(items), [items]);

  const dirty = JSON.stringify(rows) !== JSON.stringify(items);

  async function save() {
    setSaving(true);
    try {
      await studentApi.saveCurriculum(studentId, rows.filter((r) => r.label.trim()));
      onSaved();
    } finally {
      setSaving(false);
    }
  }
  async function fillDefaults() {
    const defs = await studentApi.curriculumDefaults();
    const have = new Set(rows.map((r) => r.label));
    setRows([...rows, ...defs.filter((d) => !have.has(d)).map((label) => ({ label, value: "" }))]);
  }

  return (
    <div className="sp-cur-edit">
      {rows.map((r, i) => (
        <div className="sp-cur-erow" key={i}>
          <input
            className="input sp-cur-label"
            value={r.label}
            placeholder="항목 (예: 단어시험)"
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
          <input
            className="input sp-cur-value"
            value={r.value}
            placeholder="내용 (예: 30개 / Insight Link)"
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <button className="sp-x" onClick={() => setRows(rows.filter((_, j) => j !== i))} title="삭제">×</button>
        </div>
      ))}
      <div className="sp-cur-actions">
        <button className="btn ghost sm" onClick={() => setRows([...rows, { label: "", value: "" }])}>+ 항목</button>
        {!rows.length && <button className="btn ghost sm" onClick={fillDefaults}>기본 항목 채우기</button>}
        <button className="btn primary sm" onClick={save} disabled={!dirty || saving}>{saving ? "저장 중…" : dirty ? "커리큘럼 저장" : "저장됨"}</button>
      </div>
    </div>
  );
}

/* ---------------- 일지 입력 ---------------- */
/** 현재 시각 'HH:MM'. */
function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** 'HH:MM' + 분 → 'HH:MM' (수업 길이로 끝시간 계산). */
function addMin(hm: string, min: number): string {
  const [h, m] = hm.split(":").map(Number);
  const t = h * 60 + m + min;
  const hh = Math.floor((t % 1440) / 60);
  const mm = t % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function LogEditor({ studentId, existing, slots, onSaved }: { studentId?: string; existing: StudentLogRow[]; slots: { day: string; time: string; duration: number }[]; onSaved: () => void }) {
  const [date, setDate] = useState(todayStr());
  const [bookNo, setBookNo] = useState("");
  const [wordTest, setWordTest] = useState("");
  const [doneItems, setDoneItems] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  // 선택한 날짜에 이미 기록이 있으면 불러와 이어 적기.
  useEffect(() => {
    const row = existing.find((r) => r.date === date);
    setBookNo(row?.bookNo || "");
    setWordTest(row?.wordTest || "");
    setDoneItems(row?.doneItems || []);
    setStartTime(row?.startTime || "");
    setEndTime(row?.endTime || "");
    setComment(row?.comment || "");
  }, [date, existing]);

  // 선택한 날짜의 요일에 잡힌 수업시간(자동입력용).
  const dow = DOW[parseD(date).getDay()];
  const scheduled = slots.find((s) => s.day === dow);

  function fillScheduled() {
    if (!scheduled) return;
    setStartTime(scheduled.time);
    if (scheduled.duration) setEndTime(addMin(scheduled.time, scheduled.duration));
  }

  async function save() {
    setSaving(true);
    setSavedMsg("");
    try {
      await studentApi.saveLog({ studentId, date, bookNo, wordTest, doneItems, startTime, endTime, comment });
      setSavedMsg("저장됐어요 ✓");
      onSaved();
    } catch (e) {
      setSavedMsg("저장 실패: " + String((e as Error)?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sp-log-edit">
      <div className="sp-f">
        <span>날짜</span>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {/* 수업 시간 — '지금' 버튼으로 한 번에 찍기 + 시간표 자동입력 */}
      <div className="sp-f">
        <span>수업 시간</span>
        <div className="sp-time">
          <div className="sp-time-one">
            <label>시작</label>
            <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <button type="button" className="sp-now" onClick={() => setStartTime(nowHM())}>지금</button>
          </div>
          <span className="sp-time-tilde">~</span>
          <div className="sp-time-one">
            <label>끝</label>
            <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            <button type="button" className="sp-now" onClick={() => setEndTime(nowHM())}>지금</button>
          </div>
        </div>
        {scheduled && (
          <button type="button" className="sp-time-auto" onClick={fillScheduled}>
            🕑 오늘 수업시간 자동입력 ({scheduled.time}{scheduled.duration ? `~${addMin(scheduled.time, scheduled.duration)}` : ""})
          </button>
        )}
      </div>

      <div className="sp-f">
        <span>원서 진도번호</span>
        <input className="input" value={bookNo} onChange={(e) => setBookNo(e.target.value)} placeholder="예: 145" />
      </div>

      {/* 오늘 한 것 — 체크박스, 체크하면 줄이 그어져 '완료' 표시 */}
      <div className="sp-f">
        <span>오늘 한 것 (한 것에 체크!)</span>
        <div className="sp-checks">
          {STUDENT_LOG_ITEMS.map((it) => {
            const on = doneItems.includes(it);
            return (
              <label key={it} className={"sp-check" + (on ? " on" : "")}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setDoneItems(on ? doneItems.filter((x) => x !== it) : [...doneItems, it])}
                />
                <span className="sp-check-box" aria-hidden="true" />
                <span className="sp-check-label">{it}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="sp-f">
        <span>단어시험</span>
        <input className="input" value={wordTest} onChange={(e) => setWordTest(e.target.value)} placeholder="예: 18/20" />
      </div>

      <div className="sp-f">
        <span>학습 내용 · 메모</span>
        <textarea className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="오늘 배운 내용, 느낀 점을 적어요." />
      </div>

      <div className="sp-log-save">
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? "저장 중…" : "일지 저장"}</button>
        {savedMsg && <span className="sp-saved">{savedMsg}</span>}
      </div>
    </div>
  );
}

/* ---------------- 일지 이력(월별) ---------------- */
/** 'YYYY-MM' → '2026년 6월'. */
function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}
function LogHistory({ rows }: { rows: StudentLogRow[] }) {
  // 데이터에 있는 월 목록(최신순).
  const months = Array.from(new Set(rows.map((r) => r.date.slice(0, 7)))).sort().reverse();
  const [month, setMonth] = useState<string>(months[0] || "");
  // 데이터가 바뀌어 선택 월이 사라지면 가장 최근 월로.
  useEffect(() => {
    if (months.length && !months.includes(month)) setMonth(months[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  if (!rows.length) return <div className="sp-muted">아직 작성한 일지가 없어요.</div>;

  const shown = rows.filter((r) => r.date.slice(0, 7) === month);

  return (
    <div>
      <div className="sp-months">
        {months.map((ym) => (
          <button key={ym} className={"sp-month" + (ym === month ? " on" : "")} onClick={() => setMonth(ym)}>
            {fmtMonth(ym)}
            <em>{rows.filter((r) => r.date.slice(0, 7) === ym).length}</em>
          </button>
        ))}
      </div>
      <div className="sp-hist">
        {shown.map((r) => (
          <div className="sp-hist-row" key={r.date}>
            <div className="sp-hist-date">
              <b>{fmtMDDow(r.date)}</b>
              {(r.startTime || r.endTime) && <span className="sp-hist-time">{r.startTime}{r.endTime ? `~${r.endTime}` : ""}</span>}
              {r.attStatus && <span className={"sp-att sp-att-" + (r.attStatus === "결석" ? "x" : r.attStatus === "지각" ? "l" : "o")}>{r.attStatus}</span>}
            </div>
            <div className="sp-hist-body">
              {r.bookNo && <span className="sp-tag">원서 {r.bookNo}</span>}
              {r.wordTest && <span className="sp-tag">단어 {r.wordTest}</span>}
              {r.doneItems.map((it) => (
                <span className="sp-tag sp-tag-done" key={it}>✓ {it}</span>
              ))}
            </div>
            {r.comment && <div className="sp-hist-note">{r.comment}</div>}
          </div>
        ))}
        {!shown.length && <div className="sp-muted">이 달에 작성한 일지가 없어요.</div>}
      </div>
    </div>
  );
}

/* ---------------- 학생 본인 셸(로그인 후 첫 화면) ---------------- */
export function StudentHome() {
  const { user, logout } = useAuth();
  return (
    <div className="sp-shell">
      <header className="sp-shell-top">
        <div className="sp-shell-brand">
          <div className="hub-logo">바</div>
          <div>
            <b>바꿈 영어</b>
            <span>{fmtFull(parseD(todayStr()))}</span>
          </div>
        </div>
        <button className="btn ghost" onClick={() => logout()}>로그아웃</button>
      </header>
      <main className="sp-shell-body">
        <StudentPage />
      </main>
      {user && <div className="sp-shell-foot">{user.name} 학생 · 본인 기록</div>}
      <footer className="maker-credit">제작자 EZ</footer>
    </div>
  );
}
