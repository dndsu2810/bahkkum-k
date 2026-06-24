import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { studentApi, STUDENT_LOG_ITEMS, type StudentPageData, type Curriculum, type CurriculumSection, type CurriculumRow, type StudentLogRow, type StudentGoal } from "../lib/studentApi";
import { messageApi, type Message } from "../lib/messageApi";
import { DOW, DOW_ORDER, fmtFull, fmtMDDow, fmtWhen, parseD, timeToMin, todayStr } from "../lib/dates";
import { NoticeBanner } from "../components/NoticeBanner";
import { DateField } from "../components/DateControls";
import { getCachedLogo } from "../lib/configApi";
import { IssueBoard } from "./IssueBoard";
import { Guide } from "./Guide";
import { Notices } from "./Notices";
import { postApi } from "../lib/postApi";
import { DailyTests } from "./English";
import { Icon } from "../icons";
import { HexAvatar, CombGauge, Bee, SoezLogo } from "../soez";
import { Scoreboard } from "../components/Scoreboard";
import { baseballApi } from "../lib/baseballApi";
import type { MathBoard, BaseballRule, BaseballConfig } from "../lib/baseball";

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
  // 조용히 새로고침(로딩표시 없이) — 선생님이 체크한 게 학생 화면에 바로 반영되게.
  // 내용이 그대로면 상태를 바꾸지 않아 리렌더를 막는다(입력 중 화면이 튀지 않게).
  async function reloadSilent() {
    try { const d = await studentApi.page(studentId); setData((cur) => (JSON.stringify(cur) === JSON.stringify(d) ? cur : d)); } catch { /* 폴링 실패는 무시 */ }
  }
  useEffect(() => {
    load();
    const iv = setInterval(reloadSilent, 15000);
    const onFocus = () => void reloadSilent();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  if (loading) return <div className="sp-empty">불러오는 중…</div>;
  if (err || !data) return <div className="sp-empty">불러오지 못했어요{err ? ` (${err})` : ""}.</div>;

  const canEditCur = data.canEditCurriculum;
  const s = data.student;
  const isMidBand = s.band === "mid" || s.band === "bridge"; // 중고등 — '오늘 뭐해요?'(초등 커리큘럼)·자율학습 카드 숨김

  // 이번 달 출석 — 벌집 게이지(출석/조퇴/지각을 출석으로). 기록이 있을 때만.
  const ym = todayStr().slice(0, 7);
  const monthRecs = data.daily.filter((r) => r.date.slice(0, 7) === ym && r.attStatus);
  const presentDays = monthRecs.filter((r) => ["출석", "지각", "조퇴"].includes(r.attStatus)).length;

  return (
    <div className={"sp" + (embedded ? " is-embed" : "")}>
      {/* 헤더 — 학생 프로필 */}
      <div className="sp-head">
        <HexAvatar name={s.name} photo={s.photo} size={56} className="sp-avatar-hex" />
        <div className="sp-head-info">
          <h2>{s.name}</h2>
          <div className="sp-sub">
            {[s.grade, s.school, s.band === "elem" ? "초등 영어" : s.band === "mid" ? "중고등 영어" : ""].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      {monthRecs.length > 0 && (
        <div className="sp-att-gauge">
          <span className="sp-att-label">이번 달 출석</span>
          <CombGauge value={presentDays} total={monthRecs.length} size={16} />
          <b className="sp-att-num">{presentDays}<span>/{monthRecs.length}일</span></b>
        </div>
      )}

      <div className="sp-grid">
        {/* 시간표 */}
        <section className="sp-card">
          <h3 className="sp-card-h">수업 시간표</h3>
          <Timetable slots={data.engSlots} />
        </section>

        {/* 오늘 뭐해요? (구 '커리큘럼') — 초등영어 전용. 중고등은 숨김. */}
        {!isMidBand && (
          <section className="sp-card">
            <h3 className="sp-card-h">오늘 뭐해요?</h3>
            {canEditCur ? (
              <CurriculumEditor studentId={s.id} cur={data.curriculum} onSaved={reloadSilent} />
            ) : (
              <CurriculumView cur={data.curriculum} />
            )}
            {/* 학생이 스스로 반복할 학습을 추가(강사 커리큘럼과 별개). */}
            <SelfLearning items={data.selfCurriculum} studentId={canEditCur ? s.id : undefined} onSaved={reloadSilent} />
          </section>
        )}
      </div>

      {/* 일지 입력 */}
      <section className="sp-card">
        <h3 className="sp-card-h">{canEditCur ? "수업 일지 입력" : "오늘 수업 일지"}</h3>
        {data.progressBooks && data.progressBooks.length > 0 && (
          <div className="sp-progbooks">
            <span className="sp-progbooks-l">현재 교재</span>
            {data.progressBooks.map((b) => <span className="sp-hw-chip" key={b}>{b}</span>)}
          </div>
        )}
        <LogEditor studentId={canEditCur ? s.id : undefined} tid={s.id} existing={data.daily} slots={data.engSlots} options={data.doneItemOptions} band={s.band} progressBooks={data.progressBooks || []} examMode={data.examMode || false} onSaved={reloadSilent} />
      </section>

      {/* 일지 이력 */}
      <section className="sp-card">
        <h3 className="sp-card-h">지난 일지</h3>
        <LogHistory rows={data.daily} band={s.band} />
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
function CurriculumView({ cur }: { cur: Curriculum }) {
  if (!cur.sections.length) return <div className="sp-muted">아직 등록된 학습이 없어요.</div>;
  return (
    <div className="sp-cur">
      {cur.note && <div className="sp-cur-note"><Icon name="info" /> {cur.note}</div>}
      {cur.sections.map((sec, si) => (
        <div className="sp-cur-sec" key={si}>
          {sec.title && <div className="sp-cur-sectitle">{sec.title}</div>}
          <ol className="sp-cur-rows">
            {sec.rows.map((r, ri) => (
              <li className="sp-cur-row" key={ri}>
                <span className="sp-cur-name">{r.name}</span>
                {r.amount && <span className="sp-cur-amt">{r.amount}</span>}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

/* ---------------- 내가 추가한 학습(학생 본인이 자율 추가) ---------------- */
function SelfLearning({ items, studentId, onSaved }: { items: CurriculumRow[]; studentId?: string; onSaved: () => void }) {
  const [rows, setRows] = useState<CurriculumRow[]>(items);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => setRows(items), [items]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(items);
  const add = () => setRows([...rows, { name: "", amount: "" }]);
  const setRow = (i: number, patch: Partial<CurriculumRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const del = (i: number) => setRows(rows.filter((_, j) => j !== i));
  async function save() {
    setSaving(true);
    setMsg("");
    try {
      await studentApi.saveSelfCurriculum(rows.filter((r) => r.name.trim() || r.amount.trim()), studentId);
      setMsg("저장됐어요 ✓");
      onSaved();
    } catch {
      setMsg("저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="sp-self">
      <div className="sp-self-h">내가 추가한 학습 <span className="sp-self-sub">스스로 반복할 학습을 추가해요</span></div>
      {rows.length === 0 && <div className="sp-muted">아직 추가한 학습이 없어요. 아래 ‘추가’로 넣어보세요.</div>}
      {rows.map((r, i) => (
        <div className="sp-self-row" key={i}>
          <input className="input" value={r.name} placeholder="학습 (예: 단어 복습)" onChange={(e) => setRow(i, { name: e.target.value })} />
          <input className="input sp-self-amt" value={r.amount} placeholder="분량(선택)" onChange={(e) => setRow(i, { amount: e.target.value })} />
          <button type="button" className="sp-self-del" onClick={() => del(i)} aria-label="삭제"><Icon name="x" /></button>
        </div>
      ))}
      <div className="sp-self-act">
        <button type="button" className="btn ghost sm" onClick={add}><Icon name="plus" /> 추가</button>
        <button type="button" className="btn primary sm" onClick={save} disabled={!dirty || saving}>{saving ? "저장 중…" : "저장"}</button>
        {msg && <span className="sp-saved">{msg}</span>}
      </div>
    </div>
  );
}

/* ---------------- 커리큘럼(편집, 초등영어 권한자) ---------------- */
export function CurriculumEditor({ studentId, cur, onSaved }: { studentId: string; cur: Curriculum; onSaved: () => void }) {
  const [draft, setDraft] = useState<Curriculum>(cur);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(cur), [cur]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(cur);
  const setSec = (si: number, patch: Partial<CurriculumSection>) => setDraft((d) => ({ ...d, sections: d.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)) }));
  const setRow = (si: number, ri: number, patch: Partial<CurriculumRow>) =>
    setSec(si, { rows: draft.sections[si].rows.map((r, i) => (i === ri ? { ...r, ...patch } : r)) });

  async function save() {
    setSaving(true);
    try {
      await studentApi.saveCurriculum(studentId, draft);
      onSaved();
    } finally {
      setSaving(false);
    }
  }
  async function loadTemplate() {
    setDraft(await studentApi.curriculumDefaults());
  }

  return (
    <div className="sp-cur-edit">
      <textarea
        className="input sp-cur-noteinput"
        rows={2}
        value={draft.note}
        placeholder="안내 문구 (예: 1개의 학습을 완전히 마무리 하고 다음 학습으로 넘어가세요.)"
        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
      />
      {draft.sections.map((sec, si) => (
        <div className="sp-cur-esec" key={si}>
          <div className="sp-cur-esec-head">
            <input
              className="input sp-cur-sectinput"
              value={sec.title}
              placeholder="섹션 이름 (예: 매일 반복)"
              onChange={(e) => setSec(si, { title: e.target.value })}
            />
            <button className="sp-x" title="섹션 삭제" onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_, i) => i !== si) })}>×</button>
          </div>
          {sec.rows.map((r, ri) => (
            <div className="sp-cur-erow" key={ri}>
              <span className="sp-cur-num">{ri + 1}</span>
              <input className="input sp-cur-name-i" value={r.name} placeholder="학습 (예: 단어시험)" onChange={(e) => setRow(si, ri, { name: e.target.value })} />
              <input className="input sp-cur-amt-i" value={r.amount} placeholder="내용 (예: 10개씩)" onChange={(e) => setRow(si, ri, { amount: e.target.value })} />
              <button className="sp-x" title="삭제" onClick={() => setSec(si, { rows: sec.rows.filter((_, i) => i !== ri) })}>×</button>
            </div>
          ))}
          <button className="btn ghost sm" onClick={() => setSec(si, { rows: [...sec.rows, { name: "", amount: "" }] })}>+ 항목</button>
        </div>
      ))}
      <div className="sp-cur-actions">
        <button className="btn ghost sm" onClick={() => setDraft({ ...draft, sections: [...draft.sections, { title: "", rows: [{ name: "", amount: "" }] }] })}>+ 섹션</button>
        {!draft.sections.length && <button className="btn ghost sm" onClick={loadTemplate}>기본 양식 불러오기</button>}
        <button className="btn primary sm" onClick={save} disabled={!dirty || saving}>{saving ? "저장 중…" : dirty ? "저장" : "저장됨"}</button>
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

/* 지난 일지 이력의 숙제 3분류 태그 색상. */
const hwTagCls = (v: string) => (v === "완료" ? "sp-tag-done" : v === "미흡" ? "sp-tag-warn" : v === "안함" ? "sp-tag-bad" : "");

function LogEditor({ studentId, tid, existing, slots, options, band, progressBooks = [], examMode = false, onSaved }: { studentId?: string; tid: string; existing: StudentLogRow[]; slots: { day: string; time: string; duration: number }[]; options?: string[]; band: string; progressBooks?: string[]; examMode?: boolean; onSaved: () => void }) {
  const items = options && options.length ? options : STUDENT_LOG_ITEMS;
  const isMid = band === "mid" || band === "bridge"; // 중고등(Bridge 포함) — 숙제 3분류·교재 진도
  const [date, setDate] = useState(todayStr());
  const [goals, setGoals] = useState<StudentGoal[]>([]);
  const [goalText, setGoalText] = useState("");
  const [bookNo, setBookNo] = useState("");
  // 숙제 검사(지난 수업 숙제) — 강사가 낸 지난 숙제. 학생이 '했다' 체크하면 줄긋기(강사와 양방향).
  const [hwCheck, setHwCheck] = useState<{ text: string; status: string }[]>([]);
  // 오늘의 숙제 — 선생님이 낸 숙제·배부 자료 + 학생도 직접 추가(강사와 양방향).
  const [hwAssign, setHwAssign] = useState<string[]>([]);
  const [hwText, setHwText] = useState("");
  const [doneItems, setDoneItems] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [studentNote, setStudentNote] = useState("");
  // 선생님 코멘트(수업·숙제) — 강사가 작성, 학생은 읽기 전용.
  const teacherComment = existing.find((r) => r.date === date)?.comment || "";
  const teacherHwComment = existing.find((r) => r.date === date)?.hwComment || "";
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const dirtyRef = useRef(false); // 학생이 입력 중인지 — 폴링이 입력을 덮어쓰지 않게
  const dateRef = useRef(date);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 선택한 날짜에 이미 기록이 있으면 불러와 이어 적기. 날짜가 바뀌면 항상 갱신,
  // 같은 날짜 폴링 갱신은 학생이 입력 중이 아닐 때만(선생님 입력 반영).
  useEffect(() => {
    const dateChanged = dateRef.current !== date;
    dateRef.current = date;
    if (!dateChanged && dirtyRef.current) return;
    const row = existing.find((r) => r.date === date);
    setGoals(row?.goals || []);
    setHwCheck(row?.hwCheck || []);
    setHwAssign(row?.hwAssign || []);
    setBookNo(row?.bookNo || "");
    setDoneItems(row?.doneItems || []);
    setStartTime(row?.startTime || "");
    setEndTime(row?.endTime || "");
    setStudentNote(row?.studentNote || "");
    dirtyRef.current = false;
  }, [date, existing]);

  // 자동 저장 — 아이들이 '저장'을 안 눌러도 입력하면 잠시 뒤 저절로 저장(잃어버리지 않게).
  useEffect(() => {
    if (!dirtyRef.current) return; // 로드·폴링 갱신은 저장하지 않음(사용자 입력만)
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => { void save(); }, 1200);
    return () => { if (autoTimer.current) clearTimeout(autoTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals, hwCheck, hwAssign, bookNo, doneItems, startTime, endTime, studentNote]);

  // 선택한 날짜의 요일에 잡힌 수업시간(자동입력용).
  const dow = DOW[parseD(date).getDay()];
  const scheduled = slots.find((s) => s.day === dow);

  function fillScheduled() {
    if (!scheduled) return;
    dirtyRef.current = true;
    setStartTime(scheduled.time);
    if (scheduled.duration) setEndTime(addMin(scheduled.time, scheduled.duration));
  }

  // 학생이 직접 학습 목표 추가 — 강사와 같은 목표 목록 공유(양방향).
  function addGoal() {
    const t = goalText.trim();
    if (!t) return;
    dirtyRef.current = true;
    setGoals([...goals, { text: t, done: false }]);
    setGoalText("");
  }
  // 받은 숙제 추가/삭제 — 강사 '내줄 숙제'와 같은 칸을 공유(양방향).
  function addHw() {
    const t = hwText.trim();
    if (!t || hwAssign.includes(t)) return;
    dirtyRef.current = true;
    setHwAssign([...hwAssign, t]);
    setHwText("");
  }
  function removeHw(idx: number) {
    dirtyRef.current = true;
    setHwAssign(hwAssign.filter((_, i) => i !== idx));
  }

  async function save() {
    dirtyRef.current = false; // 저장 시작 시점 — 저장 도중 새로 입력하면 다시 dirty가 되어 보존됨
    setSaving(true);
    setSavedMsg("");
    try {
      await studentApi.saveLog({ studentId, date, goals, hwCheck, hwAssign, bookNo, doneItems, startTime, endTime, studentNote });
      setSavedMsg("저장됐어요 ✓");
      onSaved();
    } catch (e) {
      setSavedMsg("저장 실패: " + String((e as Error)?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sp-log-edit" onChangeCapture={() => { dirtyRef.current = true; }}>
      <div className="sp-f">
        <span>날짜</span>
        <DateField value={date} onChange={setDate} />
      </div>

      {/* 수업 시간 — '지금' 버튼으로 한 번에 찍기 + 시간표 자동입력 */}
      <div className="sp-f">
        <span>수업 시간</span>
        <div className="sp-time">
          <div className="sp-time-one">
            <label>시작</label>
            <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <button type="button" className="sp-now" onClick={() => { dirtyRef.current = true; setStartTime(nowHM()); }}>지금</button>
          </div>
          <span className="sp-time-tilde">~</span>
          <div className="sp-time-one">
            <label>끝</label>
            <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            <button type="button" className="sp-now" onClick={() => { dirtyRef.current = true; setEndTime(nowHM()); }}>지금</button>
          </div>
        </div>
        {scheduled && (
          <button type="button" className="sp-time-auto" onClick={fillScheduled}>
            <Icon name="clock" /> 오늘 수업시간 자동입력 ({scheduled.time}{scheduled.duration ? `~${addMin(scheduled.time, scheduled.duration)}` : ""})
          </button>
        )}
      </div>

      {/* 학습 목표 — 선생님·학생이 함께. 직접 추가하고, 한 것에 체크하면 선생님 화면에도 똑같이 반영돼요. */}
      <div className="sp-f">
        <span>학습 목표 (직접 추가하고, 한 것에 체크!)</span>
        {goals.length > 0 && (
          <div className="sp-goals">
            {goals.map((g, i) => {
              const on = g.done;
              return (
                <label key={i} className={"sp-check" + (on ? " on" : "")}>
                  <input type="checkbox" checked={on} onChange={() => { dirtyRef.current = true; setGoals(goals.map((x, j) => (j === i ? { ...x, done: !x.done } : x))); }} />
                  <span className="sp-check-box" aria-hidden="true" />
                  <span className="sp-check-label">{g.text}</span>
                  <button type="button" className="sp-hw-x" onClick={(e) => { e.preventDefault(); dirtyRef.current = true; setGoals(goals.filter((_, j) => j !== i)); }} aria-label="삭제">×</button>
                </label>
              );
            })}
          </div>
        )}
        {/* 진행중 교재 칩 — 누르면 목표 입력칸에 채워져요. 내용을 더해 목표로 추가하면 돼요. 내신기간엔 숨겨요. */}
        {!examMode && progressBooks.length > 0 && (
          <div className="today-bookchips" style={{ marginTop: 6 }}>
            <span className="today-bookchips-lbl">진행중 교재</span>
            {progressBooks.map((b) => (
              <button type="button" className="today-bookchip" key={b} title="이 교재로 목표 채우기" onClick={() => { dirtyRef.current = true; setGoalText(b + " "); }}>{b}</button>
            ))}
          </div>
        )}
        <div className="sp-self-row" style={{ marginTop: 6 }}>
          <input className="input" value={goalText} onChange={(e) => setGoalText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) addGoal(); }} placeholder="학습 목표 추가 (예: 단어 50개 외우기)" />
          <button type="button" className="btn ghost sm" onClick={addGoal} disabled={!goalText.trim()}><Icon name="plus" /> 추가</button>
        </div>
      </div>

      {/* 교재·진도(중고등)·원서 진도번호(초등) — 내신기간엔 진도를 안 쓰므로 숨겨요. */}
      {!examMode && (
        <div className="sp-f">
          <span>{isMid ? "교재 · 진도" : "원서 진도번호"}</span>
          <input className="input" value={bookNo} onChange={(e) => setBookNo(e.target.value)} placeholder={isMid ? "예: 그래머인유즈 3과 p.40~45" : "예: 145"} />
        </div>
      )}

      {isMid ? (
        /* 숙제 검사 (지난 수업 숙제) — 강사가 낸 지난 숙제. 학생이 한 것에 체크하면 줄긋기(강사와 공유). */
        <div className="sp-f">
          <span>숙제 검사 (지난 수업 숙제)</span>
          {hwCheck.length === 0 ? (
            <div className="sp-muted">아직 검사할 숙제가 없어요.</div>
          ) : (
            <div className="sp-checks">
              {hwCheck.map((c, i) => {
                const on = c.status === "완료";
                return (
                  <label key={i} className={"sp-check" + (on ? " on" : "")}>
                    <input type="checkbox" checked={on} onChange={() => { dirtyRef.current = true; setHwCheck(hwCheck.map((x, j) => (j === i ? { ...x, status: on ? "" : "완료" } : x))); }} />
                    <span className="sp-check-box" aria-hidden="true" />
                    <span className="sp-check-label">{c.text}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* 오늘 한 것 — 체크박스, 체크하면 줄이 그어져 '완료' 표시 */
        <div className="sp-f">
          <span>오늘 한 것 (한 것에 체크!)</span>
          <div className="sp-checks">
            {items.map((it) => {
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
      )}

      {/* 오늘의 숙제 입력 — 선생님이 낸 숙제·배부 자료 + 내가 받은 숙제를 직접 추가. 선생님 화면과 공유돼요. */}
      {isMid && (
        <div className="sp-f">
          <span>오늘의 숙제 입력</span>
          {hwAssign.length > 0 && (
            <div className="sp-hw">
              {hwAssign.map((t, i) => (
                <span className="sp-hw-chip" key={i}>{t}<button type="button" className="sp-hw-x" onClick={() => removeHw(i)} aria-label="삭제">×</button></span>
              ))}
            </div>
          )}
          <div className="sp-self-row" style={{ marginTop: 6 }}>
            <input className="input" value={hwText} onChange={(e) => setHwText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) addHw(); }} placeholder="오늘 받은 숙제 추가 (예: 단어 3과 외우기)" />
            <button type="button" className="btn ghost sm" onClick={addHw} disabled={!hwText.trim()}><Icon name="plus" /> 추가</button>
          </div>
        </div>
      )}

      {/* 숙제 코멘트 — 선생님이 숙제에 대해 남긴 글(읽기 전용). */}
      {isMid && teacherHwComment.trim() && (
        <div className="sp-f">
          <span>숙제 코멘트</span>
          <div className="sp-teacher-comment">{teacherHwComment}</div>
        </div>
      )}

      {/* 시험 — 강사 화면과 동일한 UI(class_eng_test 공유). 학생이 입력한 시험이 강사 화면에도 똑같이 보여요. */}
      <DailyTests studentId={tid} date={date} />

      <div className="sp-f">
        <span>선생님께 (학습 내용 · 메모)</span>
        <textarea className="input" rows={3} value={studentNote} onChange={(e) => setStudentNote(e.target.value)} placeholder="오늘 배운 내용, 느낀 점, 선생님께 남길 말을 적어요." />
      </div>

      {/* 수업 코멘트 — 선생님이 수업에 대해 남긴 글(읽기 전용). */}
      {teacherComment.trim() && (
        <div className="sp-f">
          <span>수업 코멘트</span>
          <div className="sp-teacher-comment">{teacherComment}</div>
        </div>
      )}

      <div className="sp-log-save">
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? "저장 중…" : "지금 저장"}</button>
        <span className="sp-saved">{saving ? "저장 중…" : savedMsg || "입력하면 자동으로 저장돼요"}</span>
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
function LogHistory({ rows, band }: { rows: StudentLogRow[]; band: string }) {
  const isMid = band === "mid" || band === "bridge";
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
              {r.bookNo && <span className="sp-tag">{isMid ? "교재" : "원서"} {r.bookNo}</span>}
              {isMid && r.bookNext && <span className="sp-tag">다음 {r.bookNext}</span>}
              {r.wordTest && <span className="sp-tag">단어 {r.wordTest}</span>}
              {isMid ? (
                <>
                  {r.hwWord && r.hwWord !== "없음" && <span className={"sp-tag " + hwTagCls(r.hwWord)}>단어숙제 {r.hwWord}</span>}
                  {r.hwReading && r.hwReading !== "없음" && <span className={"sp-tag " + hwTagCls(r.hwReading)}>리딩 {r.hwReading}</span>}
                  {r.hwGrammar && r.hwGrammar !== "없음" && <span className={"sp-tag " + hwTagCls(r.hwGrammar)}>문법 {r.hwGrammar}</span>}
                  {r.wrongCheck && <span className="sp-tag sp-tag-done">✓ 틀단확인</span>}
                </>
              ) : (
                r.doneItems.map((it) => (
                  <span className="sp-tag sp-tag-done" key={it}>✓ {it}</span>
                ))
              )}
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
  const [showIssue, setShowIssue] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [noticeUnseen, setNoticeUnseen] = useState(0);
  const [board, setBoard] = useState<MathBoard | null>(null); // 수학 전광판(수학생만)
  const [boardPhoto, setBoardPhoto] = useState(""); // 학생 사진(모달 헤더)
  const [boardRules, setBoardRules] = useState<BaseballRule[]>([]); // 상벌점 항목(선생님 수정 시 반영)
  const [boardCfg, setBoardCfg] = useState<BaseballConfig | undefined>(undefined);
  const [boardOpen, setBoardOpen] = useState(false);
  const logo = getCachedLogo();
  useEffect(() => {
    let alive = true;
    const load = () => postApi.unseen().then((n) => { if (alive) setNoticeUnseen(n); }).catch(() => {});
    void load();
    const onSeen = () => void load();
    window.addEventListener("posts-seen", onSeen);
    return () => { alive = false; window.removeEventListener("posts-seen", onSeen); };
  }, []);
  // 본인 수학 전광판 — 선생님이 볼/출결 반영하면 학생 화면에 부드럽게 갱신(15초·focus).
  useEffect(() => {
    let alive = true;
    const load = () => baseballApi.board().then((r) => { if (alive) { setBoard(r.board); setBoardPhoto(r.photo || ""); setBoardRules(r.rules || []); setBoardCfg(r.cfg); } }).catch(() => {});
    void load();
    const iv = window.setInterval(load, 15000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);
  // 모달 ESC·뒤로가기로 닫기.
  useEffect(() => {
    if (!boardOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBoardOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boardOpen]);
  return (
    <div className="sp-shell">
      <header className="sp-shell-top">
        <div className="sp-shell-brand">
          {logo.url ? <img className="hub-logo logo-img" src={logo.url} alt="바꿈영수학원" /> : <span className="hub-logo logo-bee"><Bee size={34} /></span>}
          <div>
            <b className="sp-shell-name">바꿈영수학원 <SoezLogo size={18} className="sp-shell-soez" /></b>
            <span>{fmtFull(parseD(todayStr()))}</span>
          </div>
        </div>
        <div className="sp-shell-actions">
          <StudentMessages />
          {/* 수학 전광판 — 수학 수강생만. 공지사항 옆 상단에. */}
          {board && (
            <button className="bb-chip bb-chip-top" onClick={() => setBoardOpen(true)} aria-haspopup="dialog">
              <span className="bb-chip-ic"><Icon name="baseball" /></span> 수학 전광판
            </button>
          )}
          <button className="btn ghost sm" onClick={() => setShowGuide(true)}><Icon name="book" /> 사용 안내</button>
          <button className="btn ghost sm sp-notice-btn" onClick={() => setShowNotice(true)}>
            <Icon name="megaphone" /> 공지사항
            {noticeUnseen > 0 && <span className="nav-badge new" style={{ minWidth: "auto", marginLeft: 4 }}>new {noticeUnseen}</span>}
          </button>
          <button className="btn ghost sm" onClick={() => setShowIssue(true)}><Icon name="alert" /> 오류 신고</button>
          <button className="btn ghost" onClick={() => logout()}>로그아웃</button>
        </div>
      </header>
      <main className="sp-shell-body">
        <NoticeBanner />
        <StudentPage />
      </main>
      {user && <div className="sp-shell-foot">{user.name} 학생 · 본인 기록</div>}
      <footer className="maker-credit">제작자 EZ</footer>

      {/* 수학 전광판 모달 — X·바깥 여백·ESC로 닫고, 카드 안쪽은 안 닫힘 */}
      {boardOpen && board && (
        <div className="prof-overlay bb-overlay" onClick={() => setBoardOpen(false)} role="dialog" aria-modal="true" aria-label="수학 전광판">
          <div className="bb-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x bb-modal-x" onClick={() => setBoardOpen(false)} aria-label="닫기"><Icon name="x" /></button>
            <div className="bb-modal-head">
              <HexAvatar name={user?.name || ""} photo={boardPhoto} size={46} />
              <div>
                <p className="bb-modal-name">{user?.name}</p>
                <p className="bb-modal-sub">수학 전광판 · {board.monthLabel.replace("-", ".")}</p>
              </div>
            </div>
            <Scoreboard board={board} rules={boardRules} cfg={boardCfg} />
          </div>
        </div>
      )}

      {showIssue && (
        <div className="prof-overlay sp-overlay" onClick={() => setShowIssue(false)}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x sp-modal-x" onClick={() => setShowIssue(false)} aria-label="닫기">✕</button>
            <IssueBoard defaultPage="학생 화면" />
          </div>
        </div>
      )}

      {showGuide && (
        <div className="prof-overlay sp-overlay" onClick={() => setShowGuide(false)}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x sp-modal-x" onClick={() => setShowGuide(false)} aria-label="닫기">✕</button>
            <Guide forceRole="student" embedded />
          </div>
        </div>
      )}

      {showNotice && (
        <div className="prof-overlay sp-overlay" onClick={() => setShowNotice(false)}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x sp-modal-x" onClick={() => setShowNotice(false)} aria-label="닫기">✕</button>
            <Notices readOnly />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- 학생 메시지함 (종 + 배지 + 일시 강조 + 답장 1회) ---------------- */
function StudentMessages() {
  const [list, setList] = useState<Message[]>([]);
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState(false);
  const firstLoad = useRef(true);
  const lastTs = useRef(0); // 지금까지 본 가장 최신 메시지 시각
  const popupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashPopup = () => {
    setPopup(true);
    if (popupTimer.current) clearTimeout(popupTimer.current);
    popupTimer.current = setTimeout(() => setPopup(false), 6000);
  };
  const reload = () =>
    messageApi.inbox().then((msgs) => {
      setList(msgs);
      const newestAll = msgs.reduce((mx, m) => Math.max(mx, m.createdAt), 0);
      // 첫 로드에 안 읽은 게 있거나, 이전에 못 본 새 안읽음 메시지가 오면 강조 팝업.
      if (firstLoad.current) {
        firstLoad.current = false;
        if (msgs.some((m) => m.readAt === 0)) flashPopup();
      } else if (msgs.some((m) => m.readAt === 0 && m.createdAt > lastTs.current)) {
        flashPopup();
      }
      lastTs.current = Math.max(lastTs.current, newestAll);
    }).catch(() => {});
  useEffect(() => {
    void reload();
    // 새로고침 없이도 곧 보이도록 자주 확인(15초). 새 탭 포커스 시에도 즉시 갱신.
    const iv = window.setInterval(() => void reload(), 15000);
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unread = list.filter((m) => m.readAt === 0).length;

  function openBox() { setOpen(true); setPopup(false); }
  async function markRead(m: Message) {
    if (m.readAt) return;
    setList((cur) => cur.map((x) => (x.id === m.id ? { ...x, readAt: Date.now() } : x)));
    await messageApi.read(m.id).catch(() => {});
  }
  async function reply(m: Message, text: string) {
    await messageApi.reply(m.id, text);
    setList((cur) => cur.map((x) => (x.id === m.id ? { ...x, replyBody: text, replyAt: Date.now(), readAt: x.readAt || Date.now() } : x)));
  }

  // 날짜별 묶음(최신 날짜 먼저).
  const groups = useMemo(() => {
    const m = new Map<string, Message[]>();
    for (const x of list) {
      const d = new Date(x.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const arr = m.get(key);
      if (arr) arr.push(x);
      else m.set(key, [x]);
    }
    return [...m.entries()];
  }, [list]);

  return (
    <>
      <button className="topbell" onClick={openBox} aria-label="메시지" title="메시지">
        <Icon name="bell" />
        {unread > 0 && <span className="topbell-badge">{unread}</span>}
      </button>
      {popup && (
        <button className="msg-pop" onClick={openBox}>
          <Icon name="bell" /> 선생님이 메시지를 보냈어요
        </button>
      )}
      {open && (
        <div className="prof-overlay sp-overlay" onClick={() => setOpen(false)}>
          <div className="sp-modal msg-inbox" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x sp-modal-x" onClick={() => setOpen(false)} aria-label="닫기">✕</button>
            <h2 className="msg-inbox-h">메시지함</h2>
            {list.length === 0 ? (
              <div className="hub-muted" style={{ padding: "20px 4px" }}>받은 메시지가 없어요.</div>
            ) : (
              groups.map(([day, msgs]) => (
                <div className="msg-day" key={day}>
                  <div className="msg-day-h">{fmtMDDow(day)}</div>
                  {msgs.map((m) => <StudentMsgCard key={m.id} m={m} onRead={() => markRead(m)} onReply={(t) => reply(m, t)} />)}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

function StudentMsgCard({ m, onRead, onReply }: { m: Message; onRead: () => void; onReply: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const replied = m.replyAt > 0;
  const unread = m.readAt === 0;
  async function doReply() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setErr("");
    try {
      await onReply(body);
      setText("");
    } catch {
      setErr("이미 답장했거나 보내지 못했어요.");
    } finally {
      setSending(false);
    }
  }
  return (
    <div className={"msg-card" + (unread ? " unread" : "")}>
      <div className="msg-card-top">
        {unread && <span className="msg-card-dot" />}
        <span className="msg-card-from">{m.senderName || "선생님"}</span>
        <span className="msg-card-when">{fmtWhen(m.createdAt)}</span>
      </div>
      <div className="msg-card-body">{m.body}</div>
      {replied ? (
        <div className="msg-card-replied"><span className="msg-card-replied-l">내 답장</span> {m.replyBody}</div>
      ) : (
        <div className="msg-card-reply">
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="답장 (한 번만 보낼 수 있어요)"
            onKeyDown={(e) => { if (e.key === "Enter") void doReply(); }}
          />
          <button className="btn primary sm" onClick={doReply} disabled={!text.trim() || sending}>{sending ? "보내는 중…" : "답장"}</button>
          {unread && <button className="btn ghost sm" onClick={onRead}>읽음</button>}
        </div>
      )}
      {err && <div className="auth-err" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}
