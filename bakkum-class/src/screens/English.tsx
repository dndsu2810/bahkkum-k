import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { engApi, type EngDaily, type EngMakeup, type EngProgress, type EngTest, type Goal } from "../lib/engApi";
import { MID_ENG_TIMETABLE } from "../lib/engTimetableSeed";
import { DOW, DOW_ORDER, TODAY, fmtFull, fmtMD, mondayOf, parseD, timeToMin, todayStr, ymd } from "../lib/dates";
import { holidayName } from "../lib/holidays";
import { Select } from "../components/ui";
import { useApprovedChanges, approvedFor, findSlotConflicts } from "../lib/changeReqLive";
import { ConflictPopup, ApprovedBanner } from "../components/ChangeReqLive";

type Band = "elem" | "mid";
type Tab = "today" | "tt" | "att" | "hw" | "progress" | "test" | "makeup" | "board";

const WEEK_OPTS = [
  { v: "-1", l: "지난주" },
  { v: "0", l: "이번주" },
  { v: "1", l: "다음주" },
  { v: "2", l: "2주 후" },
];

/* 주간 시간표(수학 동일 방식) — 같은 시간·종류 학생 한 블록에 묶고, 겹치면 칸 분할. */
type EvType = "blue" | "orange"; // blue=정규, orange=보강
interface RawEvt { name: string; start: number; dur: number; time: string; type: EvType }
interface Grp { names: string[]; start: number; dur: number; time: string; type: EvType }
function groupSlots(list: RawEvt[]): Grp[] {
  const map = new Map<string, Grp>();
  for (const e of list) {
    const key = e.start + "|" + e.dur + "|" + e.type;
    let g = map.get(key);
    if (!g) { g = { names: [], start: e.start, dur: e.dur, time: e.time, type: e.type }; map.set(key, g); }
    g.names.push(e.name);
  }
  for (const g of map.values()) g.names.sort();
  return [...map.values()];
}

const blankDaily = (studentId: string, date: string): EngDaily => ({
  studentId,
  date,
  attended: false,
  attStatus: "",
  lateMin: 0,
  absentReason: "",
  goals: [],
  homework: "",
  hwChecked: false,
  comment: "",
  materials: "",
  updatedAt: 0,
});

/** 영어 영역 — 초등(elem)/중고등(mid) band별. 학습일지 중심. */
export function English({ band, tab: initialTab }: { band: Band; tab?: Tab }) {
  const { user } = useAuth();
  const tab: Tab = initialTab || "today"; // 탭은 사이드바에서 선택(화면 내 탭바 없음)
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const reloadRoster = () => getRoster().then(setRoster).catch(() => {});
  const [date, setDate] = useState(todayStr());
  const [daily, setDaily] = useState<Record<string, EngDaily>>({});
  const [sel, setSel] = useState("");
  const [err, setErr] = useState("");

  const students = useMemo(
    () => roster.filter((s) => s.subjects.includes("english") && s.englishBand === band),
    [roster, band]
  );

  useEffect(() => {
    getRoster().then(setRoster).catch(() => setErr("명단을 불러오지 못했어요. (배포 환경에서만 동작)"));
  }, []);

  // 날짜별 일일기록 로드
  useEffect(() => {
    engApi
      .dailyByDate(date)
      .then((list) => {
        const m: Record<string, EngDaily> = {};
        for (const d of list) m[d.studentId] = d;
        setDaily(m);
      })
      .catch(() => {});
  }, [date]);

  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of students) m[s.id] = s.name;
    return m;
  }, [students]);

  function getDaily(sid: string): EngDaily {
    return daily[sid] || blankDaily(sid, date);
  }

  async function saveDaily(d: EngDaily) {
    setDaily((cur) => ({ ...cur, [d.studentId]: d }));
    try {
      await engApi.saveDaily(d);
      setErr("");
    } catch {
      setErr("저장에 실패했어요.");
    }
  }
  // 출결 상태 지정 — 지각은 분, 결석은 사유를 받는다. 결석은 백엔드에서 보강 자동연결.
  function setStatus(sid: string, status: "출석" | "지각" | "결석" | "") {
    const d = getDaily(sid);
    if (status === "지각") {
      const m = Number(window.prompt("지각 몇 분?", String(d.lateMin || 10)) || 0);
      void saveDaily({ ...d, attStatus: "지각", lateMin: m, attended: true });
    } else if (status === "결석") {
      const r = window.prompt("결석 사유", d.absentReason || "") ?? "";
      void saveDaily({ ...d, attStatus: "결석", absentReason: r, attended: false });
    } else {
      void saveDaily({ ...d, attStatus: status, attended: status === "출석" });
    }
  }

  // 날짜 이동 — 수학 '오늘'과 동일하게 화살표(어제/내일) + '오늘로'.
  const isToday = date === todayStr();
  const shiftDate = (delta: number) => {
    const d = parseD(date);
    d.setDate(d.getDate() + delta);
    setDate(ymd(d));
  };

  // 오늘 등원 예정(선택 날짜의 요일에 영어 수업이 있는) 학생 우선.
  const dowSel = DOW[parseD(date).getDay()];
  const scheduledIds = useMemo(() => new Set(students.filter((s) => s.engSlots.some((sl) => sl.day === dowSel)).map((s) => s.id)), [students, dowSel]);
  const slotTimeOf = (s: RosterStudent) => s.engSlots.find((sl) => sl.day === dowSel)?.time || "";
  // 예정 학생 먼저(수업 시간순), 그다음 '추가 등원'(예정 아니지만 기록 있는 학생).
  const todayList = useMemo(() => {
    const sched = students.filter((s) => scheduledIds.has(s.id)).sort((a, b) => slotTimeOf(a).localeCompare(slotTimeOf(b)));
    const extra = students.filter((s) => !scheduledIds.has(s.id) && (daily[s.id]?.attStatus || daily[s.id]?.attended));
    return [...sched, ...extra];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, scheduledIds, daily]);
  const addable = students.filter((s) => !scheduledIds.has(s.id) && !(daily[s.id]?.attStatus || daily[s.id]?.attended));

  // 시간표 변경요청 — 그 날짜 승인된 변경(영어) 표시 + 수학↔영어 시간 겹침 자동 감지.
  const approvedChanges = useApprovedChanges(date);
  const conflicts = useMemo(() => findSlotConflicts(students, date), [students, date]);
  const showLive = tab === "today" || tab === "att";

  const bandLabel = band === "elem" ? "초등 영어" : "중고등 영어";
  const TITLE: Record<Tab, string> = {
    today: "오늘",
    tt: "주간 시간표",
    att: "출결 기록",
    hw: "숙제 기록",
    progress: "진도 기록",
    test: "테스트 기록",
    makeup: "보강 관리",
    board: "현황",
  };
  // 부제는 '이 화면에서 무엇을 하는지'만 사람 말로. (내부 동작 설명 X)
  const DESC: Record<Tab, string> = {
    today: "오늘 등원 학생의 목표·숙제·코멘트를 기록하세요.",
    tt: "이번 주 수업 시간표를 봅니다.",
    att: "오늘 등원/지각/결석을 표시하세요. 결석은 보강 관리로 이어집니다.",
    hw: "지난 숙제 검사와 오늘 내줄 숙제를 기록하세요.",
    progress: "학생별 교재·진도를 기록하세요.",
    test: "단어시험·테스트 점수를 기록하세요.",
    makeup: "결석으로 생긴 보강 일정을 잡고 관리하세요.",
    board: "이 반 학생들의 출결·진도·테스트 현황을 한눈에 봅니다.",
  };

  // 시간표는 수학 주간 시간표와 동일 레이아웃(자체 page-head·주차 선택).
  if (tab === "tt") {
    return (
      <div className="eng">
        <EngTimetable
          students={students}
          bandLabel={bandLabel}
          canImport={user?.role === "admin" && band === "mid"}
          onImported={reloadRoster}
        />
      </div>
    );
  }

  return (
    <div className="eng">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">{bandLabel} · {TITLE[tab]}</h1>
          <p className="sm-desc">{DESC[tab]}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {(tab === "today" || tab === "att") && (
            <div className="date-nav">
              <button className="date-arrow" onClick={() => shiftDate(-1)} title="어제" aria-label="어제로">‹</button>
              <div className="date-cur">{fmtFull(parseD(date))}{!isToday && <span className="date-off"> · 오늘 아님</span>}</div>
              <button className="date-arrow" onClick={() => shiftDate(1)} title="내일" aria-label="내일로">›</button>
              {!isToday && <button className="btn ghost sm date-today" onClick={() => setDate(todayStr())}>오늘로</button>}
            </div>
          )}
          <div className="sm-count">{students.length}명</div>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
      {showLive && <ApprovedBanner changes={approvedChanges} subject="english" />}
      {showLive && <ConflictPopup conflicts={conflicts} date={date} />}
      {students.length === 0 && (
        <div className="hub-muted">
          이 반에 배정된 영어 학생이 없어요. <b>학생 명단</b>에서 학생에 영어 + {band === "elem" ? "초등" : "중고등"}을 지정하세요.
        </div>
      )}

      {tab === "board" ? (
        <EngDashboard students={students} daily={daily} band={band} />
      ) : tab === "makeup" ? (
        <EngMakeupPanel students={students} />
      ) : tab === "att" ? (
        <EngAttendance list={todayList} addable={addable} date={date} daily={daily} scheduledIds={scheduledIds} slotTimeOf={slotTimeOf} onStatus={setStatus} />
      ) : tab === "hw" ? (
        <EngHomework students={students} />
      ) : (
        <div className="eng-split">
          <div className="eng-side">
            {(tab === "today" ? todayList : students).length === 0 && (
              <div className="eng-side-empty">
                {tab === "today"
                  ? "오늘 등원 예정 학생이 없어요. 아래 ‘추가 등원’으로 학생을 추가하세요."
                  : "표시할 학생이 없어요."}
              </div>
            )}
            {(tab === "today" ? todayList : students).map((s) => {
              const d = daily[s.id];
              const st = d?.attStatus || "";
              return (
                <div key={s.id} className={"eng-stu" + (sel === s.id ? " on" : "")}>
                  {tab === "today" && (
                    <div className="eng-att-seg">
                      <button className={"eas" + (st === "출석" ? " on g" : "")} onClick={() => setStatus(s.id, st === "출석" ? "" : "출석")} title={st === "출석" ? "출석 취소" : "출석"}>출</button>
                      <button className={"eas" + (st === "지각" ? " on w" : "")} onClick={() => setStatus(s.id, st === "지각" ? "" : "지각")} title={st === "지각" ? "지각 취소" : "지각"}>지</button>
                      <button className={"eas" + (st === "결석" ? " on b" : "")} onClick={() => setStatus(s.id, st === "결석" ? "" : "결석")} title={st === "결석" ? "결석 취소" : "결석"}>결</button>
                    </div>
                  )}
                  <button className="eng-stu-name" onClick={() => setSel(s.id)}>
                    {s.name}
                    {tab === "today" && scheduledIds.has(s.id) && slotTimeOf(s) && <span className="eng-stu-time">{slotTimeOf(s)}</span>}
                    {tab === "today" && (() => { const ch = approvedFor(approvedChanges, s.id, "english"); return ch ? <span className="eng-stu-chg" title="승인된 시간 변경">→{ch.toTime}</span> : null; })()}
                    {tab === "today" && st === "지각" && d?.lateMin ? <span className="eng-stu-late">{d.lateMin}분</span> : null}
                    {tab === "today" && d?.hwChecked && <span className="eng-dot ok" title="숙제검사 완료" />}
                  </button>
                </div>
              );
            })}
            {tab === "today" && addable.length > 0 && (
              <div className="eng-add-att">
                <select className="sm-input" value="" onChange={(e) => { if (e.target.value) setStatus(e.target.value, "출석"); }}>
                  <option value="">+ 추가 등원</option>
                  {addable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="eng-main">
            {!sel ? (
              <div className="hub-muted" style={{ padding: 20 }}>
                {tab === "today"
                  ? "왼쪽에서 학생을 선택하면 오늘 학습일지(목표·숙제·코멘트)를 기록할 수 있어요."
                  : tab === "progress"
                    ? "왼쪽에서 학생을 선택하면 교재·진도를 기록할 수 있어요."
                    : "왼쪽에서 학생을 선택하면 테스트 점수를 기록할 수 있어요."}
              </div>
            ) : tab === "today" ? (
              <DailyEditor key={sel + date} student={nameOf[sel] || ""} studentId={sel} band={band} value={getDaily(sel)} onSave={saveDaily} />
            ) : tab === "progress" ? (
              <ProgressPanel studentId={sel} name={nameOf[sel] || ""} />
            ) : (
              <TestPanel studentId={sel} name={nameOf[sel] || ""} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- 일일 학습일지 편집 ---------------- */
function DailyEditor({ student, studentId, band, value, onSave }: { student: string; studentId: string; band: Band; value: EngDaily; onSave: (d: EngDaily) => void }) {
  const showHw = band !== "elem"; // 초등영어는 숙제 없음
  const [d, setD] = useState<EngDaily>(value);
  const [prevHw, setPrevHw] = useState<{ date: string; homework: string } | null>(null);
  const dirty = JSON.stringify(d) !== JSON.stringify(value);

  // 지난 숙제 = 그 학생의 직전(오늘 이전) 기록 중 숙제가 있는 가장 최근 것.
  useEffect(() => {
    engApi
      .dailyByStudent(studentId)
      .then((list) => {
        const prev = list.filter((x) => x.date < value.date && x.homework.trim()).sort((a, b) => b.date.localeCompare(a.date))[0];
        setPrevHw(prev ? { date: prev.date, homework: prev.homework } : null);
      })
      .catch(() => {});
  }, [studentId, value.date]);

  function setGoals(goals: Goal[]) {
    setD({ ...d, goals });
  }

  return (
    <div className="eng-daily">
      <div className="eng-daily-h">
        <h2>{student} · {d.date}</h2>
      </div>

      <div className="eng-field">
        <div className="eng-label">출결</div>
        <div className="sm-subj">
          <button className={"sm-subj-chip" + (d.attStatus === "출석" ? " on" : "")} onClick={() => setD({ ...d, attStatus: d.attStatus === "출석" ? "" : "출석", attended: d.attStatus !== "출석" })}>출석</button>
          <button className={"sm-subj-chip" + (d.attStatus === "지각" ? " on" : "")} onClick={() => setD({ ...d, attStatus: d.attStatus === "지각" ? "" : "지각", attended: d.attStatus !== "지각" })}>지각</button>
          <button className={"sm-subj-chip" + (d.attStatus === "결석" ? " on" : "")} onClick={() => setD({ ...d, attStatus: d.attStatus === "결석" ? "" : "결석", attended: false })}>결석</button>
        </div>
        {d.attStatus === "지각" && (
          <label className="eng-late-row">지각 <input className="sm-input" style={{ maxWidth: 90 }} type="number" min={0} step={5} value={d.lateMin || 0} onChange={(e) => setD({ ...d, lateMin: Number(e.target.value) || 0 })} /> 분</label>
        )}
        {d.attStatus === "결석" && (
          <input className="input" style={{ marginTop: 6 }} value={d.absentReason} onChange={(e) => setD({ ...d, absentReason: e.target.value })} placeholder="결석 사유 (보강 관리에 자동 연결됩니다)" />
        )}
      </div>

      <div className="eng-field">
        <div className="eng-label">학습 목표 (체크)</div>
        {d.goals.map((g, i) => (
          <div className="eng-goal" key={i}>
            <input type="checkbox" checked={g.done} onChange={(e) => setGoals(d.goals.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
            <input
              className="sm-input"
              value={g.text}
              onChange={(e) => setGoals(d.goals.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              placeholder="목표"
            />
            <button className="eng-goal-x" onClick={() => setGoals(d.goals.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button className="btn ghost sm" onClick={() => setGoals([...d.goals, { text: "", done: false }])}>+ 목표 추가</button>
      </div>

      {showHw && (
        <div className="eng-field">
          <div className="eng-label">지난 숙제{prevHw ? ` · ${prevHw.date}` : ""}</div>
          <div className="eng-prev-hw">{prevHw ? prevHw.homework : "지난 숙제 없음"}</div>
          <label className="eng-check"><input type="checkbox" checked={d.hwChecked} onChange={(e) => setD({ ...d, hwChecked: e.target.checked })} /> 숙제검사 완료 (지난 숙제 확인)</label>
        </div>
      )}

      {showHw && (
        <div className="eng-field">
          <div className="eng-label">오늘 내줄 숙제</div>
          <textarea className="input" rows={2} value={d.homework} onChange={(e) => setD({ ...d, homework: e.target.value })} placeholder="오늘 내줄 숙제 (다음 시간에 ‘지난 숙제’로 표시됩니다)" />
        </div>
      )}

      <div className="eng-field">
        <div className="eng-label">코멘트</div>
        <textarea className="input" rows={2} value={d.comment} onChange={(e) => setD({ ...d, comment: e.target.value })} placeholder="수업 코멘트" />
      </div>

      <div className="eng-field">
        <div className="eng-label">자료 배부</div>
        <input className="input" value={d.materials} onChange={(e) => setD({ ...d, materials: e.target.value })} placeholder="배부 자료 (예: 워크시트, 단어장)" />
      </div>

      <button className="btn primary" onClick={() => onSave(d)} disabled={!dirty}>{dirty ? "저장" : "저장됨"}</button>
    </div>
  );
}

/* ---------------- 진도 ---------------- */
function ProgressPanel({ studentId, name }: { studentId: string; name: string }) {
  const [list, setList] = useState<EngProgress[]>([]);
  const [book, setBook] = useState("");
  const [level, setLevel] = useState("");
  const reload = () => engApi.progress(studentId).then(setList).catch(() => {});
  useEffect(() => { void reload(); }, [studentId]);

  async function add() {
    if (!book.trim()) return;
    await engApi.saveProgress({ studentId, book: book.trim(), level: level.trim(), status: "진행", startDate: todayStr() });
    setBook(""); setLevel("");
    void reload();
  }
  async function setStatus(p: EngProgress, status: string) {
    await engApi.saveProgress({ ...p, status });
    void reload();
  }
  async function remove(p: EngProgress) {
    if (!window.confirm("이 진도를 삭제할까요?")) return;
    await engApi.removeProgress(p.id);
    void reload();
  }

  return (
    <div className="eng-panel">
      <h2>{name} · 진도</h2>
      <div className="eng-add-row">
        <input className="input" value={book} onChange={(e) => setBook(e.target.value)} placeholder="교재명 (예: Insight Link L1)" />
        <input className="input" style={{ maxWidth: 140 }} value={level} onChange={(e) => setLevel(e.target.value)} placeholder="레벨/단계" />
        <button className="btn primary" onClick={add} disabled={!book.trim()}>추가</button>
      </div>
      <div className="eng-rows">
        {list.map((p) => (
          <div className="eng-row" key={p.id}>
            <div className="eng-row-main"><b>{p.book}</b>{p.level && <span className="eng-lv">{p.level}</span>}</div>
            <select className="sm-input" value={p.status} onChange={(e) => setStatus(p, e.target.value)}>
              <option value="진행">진행</option>
              <option value="완료">완료</option>
              <option value="보류">보류</option>
            </select>
            <button className="btn ghost sm" onClick={() => remove(p)}>삭제</button>
          </div>
        ))}
        {list.length === 0 && <div className="hub-muted">진도 기록이 없어요.</div>}
      </div>
    </div>
  );
}

/* ---------------- 테스트 ---------------- */
function TestPanel({ studentId, name }: { studentId: string; name: string }) {
  const [list, setList] = useState<EngTest[]>([]);
  const [nm, setNm] = useState("단어시험");
  const [score, setScore] = useState("");
  const [total, setTotal] = useState("100");
  const reload = () => engApi.tests(studentId).then(setList).catch(() => {});
  useEffect(() => { void reload(); }, [studentId]);

  async function add() {
    if (!nm.trim()) return;
    await engApi.saveTest({ studentId, name: nm.trim(), score: Number(score) || 0, total: Number(total) || 100, date: todayStr() });
    setScore("");
    void reload();
  }
  async function remove(t: EngTest) {
    if (!window.confirm("이 테스트를 삭제할까요?")) return;
    await engApi.removeTest(t.id);
    void reload();
  }

  return (
    <div className="eng-panel">
      <h2>{name} · 테스트</h2>
      <div className="eng-add-row">
        <input className="input" style={{ maxWidth: 160 }} value={nm} onChange={(e) => setNm(e.target.value)} placeholder="시험명 (예: 단어시험)" />
        <input className="input" style={{ maxWidth: 90 }} inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value.replace(/[^0-9]/g, ""))} placeholder="점수" />
        <span className="eng-slash">/</span>
        <input className="input" style={{ maxWidth: 90 }} inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value.replace(/[^0-9]/g, ""))} placeholder="만점" />
        <button className="btn primary" onClick={add} disabled={!nm.trim()}>추가</button>
      </div>
      <div className="eng-rows">
        {list.map((t) => (
          <div className="eng-row" key={t.id}>
            <div className="eng-row-main"><b>{t.name}</b><span className="eng-lv">{t.date}</span></div>
            <span className="eng-score">{t.score}<span className="eng-total"> / {t.total}</span></span>
            <button className="btn ghost sm" onClick={() => remove(t)}>삭제</button>
          </div>
        ))}
        {list.length === 0 && <div className="hub-muted">테스트 기록이 없어요.</div>}
      </div>
    </div>
  );
}

/* ---------------- 출결 기록 (출석/지각/결석, 예정 우선) ---------------- */
function EngAttendance({
  list, addable, date, daily, scheduledIds, slotTimeOf, onStatus,
}: {
  list: RosterStudent[];
  addable: RosterStudent[];
  date: string;
  daily: Record<string, EngDaily>;
  scheduledIds: Set<string>;
  slotTimeOf: (s: RosterStudent) => string;
  onStatus: (sid: string, status: "출석" | "지각" | "결석" | "") => void;
}) {
  const cnt = (st: string) => list.filter((s) => daily[s.id]?.attStatus === st).length;
  // 키보드 단축키 — 현재 행에 1 출석·2 지각·3 결석, Enter/↓ 다음·↑ 이전.
  const [cur, setCur] = useState(0);
  useEffect(() => { if (cur > list.length - 1) setCur(Math.max(0, list.length - 1)); }, [list.length, cur]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (!list.length) return;
      const s = list[Math.min(cur, list.length - 1)];
      const cs = daily[s.id]?.attStatus || ""; // 같은 키 다시 누르면 취소(토글)
      if (e.key === "1") { onStatus(s.id, cs === "출석" ? "" : "출석"); e.preventDefault(); }
      else if (e.key === "2") { onStatus(s.id, cs === "지각" ? "" : "지각"); e.preventDefault(); }
      else if (e.key === "3") { onStatus(s.id, cs === "결석" ? "" : "결석"); e.preventDefault(); }
      else if (e.key === "Enter" || e.key === "ArrowDown") { setCur((c) => Math.min(c + 1, list.length - 1)); e.preventDefault(); }
      else if (e.key === "ArrowUp") { setCur((c) => Math.max(c - 1, 0)); e.preventDefault(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, cur, onStatus, daily]);
  return (
    <div className="eng-attp">
      <p className="hub-muted" style={{ marginBottom: 10 }}>{date} · 등원 예정 학생이 위에 옵니다. 출석/지각/결석을 표시하세요. 결석은 보강 관리로 연결됩니다.</p>
      <p className="eng-att-hint">키보드: <b>1</b> 출석 · <b>2</b> 지각 · <b>3</b> 결석 · <b>Enter/↓</b> 다음 · <b>↑</b> 이전</p>
      <div className="dash-kpis" style={{ gridTemplateColumns: "repeat(3,1fr)", maxWidth: 480, marginBottom: 14 }}>
        <div className="kpi"><div className="kpi-v">{cnt("출석") + cnt("지각")}<span className="kpi-u">명</span></div><div className="kpi-l">출석</div></div>
        <div className="kpi"><div className="kpi-v" style={{ color: "var(--warn)" }}>{cnt("지각")}<span className="kpi-u">명</span></div><div className="kpi-l">지각</div></div>
        <div className="kpi"><div className="kpi-v" style={{ color: "var(--bad)" }}>{cnt("결석")}<span className="kpi-u">명</span></div><div className="kpi-l">결석</div></div>
      </div>
      <div className="eng-att-rows">
        {list.map((s, i) => {
          const d = daily[s.id];
          const st = d?.attStatus || "";
          return (
            <div className={"eng-att-row" + (scheduledIds.has(s.id) ? "" : " extra") + (i === cur ? " cur" : "")} key={s.id} onClick={() => setCur(i)}>
              <div className="eng-att-info">
                <b>{s.name}</b>
                {scheduledIds.has(s.id) && slotTimeOf(s) && <span className="eng-att-time">{slotTimeOf(s)}</span>}
                {st === "지각" && d?.lateMin ? <span className="eng-att-detail warn">{d.lateMin}분 지각</span> : null}
                {st === "결석" && <span className="eng-att-detail bad">결석{d?.absentReason ? ` · ${d.absentReason}` : ""}</span>}
              </div>
              <div className="eng-att-seg">
                <button className={"eas" + (st === "출석" ? " on g" : "")} onClick={() => onStatus(s.id, st === "출석" ? "" : "출석")}>출</button>
                <button className={"eas" + (st === "지각" ? " on w" : "")} onClick={() => onStatus(s.id, st === "지각" ? "" : "지각")}>지</button>
                <button className={"eas" + (st === "결석" ? " on b" : "")} onClick={() => onStatus(s.id, st === "결석" ? "" : "결석")}>결</button>
              </div>
            </div>
          );
        })}
        {list.length === 0 && <div className="hub-muted">표시할 학생이 없어요.</div>}
      </div>
      {addable.length > 0 && (
        <div className="eng-add-att" style={{ marginTop: 12, maxWidth: 240 }}>
          <select className="sm-input" value="" onChange={(e) => { if (e.target.value) onStatus(e.target.value, "출석"); }}>
            <option value="">+ 추가 등원</option>
            {addable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

/* ---------------- 숙제 기록 (학생별 누적) ---------------- */
function EngHomework({ students }: { students: RosterStudent[] }) {
  const [sel, setSel] = useState("");
  const [list, setList] = useState<EngDaily[]>([]);
  const reload = () => { if (sel) engApi.dailyByStudent(sel).then(setList).catch(() => {}); };
  useEffect(() => { setList([]); reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sel]);

  async function patch(d: EngDaily, p: Partial<EngDaily>) {
    const next = { ...d, ...p };
    setList((cur) => cur.map((x) => (x.date === d.date ? next : x)));
    try { await engApi.saveDaily(next); } catch { /* ignore */ }
  }
  const withHw = list.filter((d) => d.homework || d.hwChecked);
  const name = students.find((s) => s.id === sel)?.name || "";

  return (
    <div className="eng-split">
      <div className="eng-side">
        {students.map((s) => (
          <div key={s.id} className={"eng-stu" + (sel === s.id ? " on" : "")}>
            <button className="eng-stu-name" onClick={() => setSel(s.id)}>{s.name}</button>
          </div>
        ))}
      </div>
      <div className="eng-main">
        {!sel ? (
          <div className="hub-muted" style={{ padding: 20 }}>왼쪽에서 학생을 선택하면 숙제 기록을 볼 수 있어요.</div>
        ) : (
          <div className="eng-panel">
            <h2>{name} · 숙제 기록</h2>
            {withHw.length === 0 ? (
              <div className="hub-muted">숙제 기록이 없어요. ‘오늘(일일기록)’에서 숙제를 입력하면 여기 누적됩니다.</div>
            ) : (
              <div className="eng-hw-list">
                {withHw.map((d) => (
                  <div className="eng-hw-row" key={d.date}>
                    <div className="eng-hw-date">{d.date}</div>
                    <textarea className="input" rows={2} value={d.homework} onChange={(e) => patch(d, { homework: e.target.value })} placeholder="숙제 내용" />
                    <label className="eng-check"><input type="checkbox" checked={d.hwChecked} onChange={(e) => patch(d, { hwChecked: e.target.checked })} /> 숙제검사 완료</label>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 주간 시간표 (수학과 동일 레이아웃) ---------------- */
function EngTimetable({
  students,
  bandLabel,
  canImport,
  onImported,
}: {
  students: RosterStudent[];
  bandLabel: string;
  canImport?: boolean;
  onImported?: () => void;
}) {
  const [importing, setImporting] = useState(false);
  const [curWeek, setCurWeek] = useState(0);
  const [makeups, setMakeups] = useState<EngMakeup[]>([]);

  const ids = useMemo(() => new Set(students.map((s) => s.id)), [students]);
  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of students) m[s.id] = s.name;
    return m;
  }, [students]);
  // 학생별 영어 수업 평균 길이(보강 블록 기본 길이로 사용)
  const durOf = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of students) m[s.id] = s.engSlots[0]?.duration || 60;
    return m;
  }, [students]);

  useEffect(() => {
    engApi.makeups().then((all) => setMakeups(all.filter((mk) => ids.has(mk.studentId)))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students]);

  async function importTimetable() {
    if (importing) return;
    if (!window.confirm("구글시트의 중고등 영어 시간표를 가져옵니다. 이름이 일치하는 학생의 영어 수업시간을 교체합니다(수학은 그대로). 진행할까요?")) return;
    setImporting(true);
    try {
      const r = await fetch("/api/sync/eng-timetable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ students: MID_ENG_TIMETABLE }),
      });
      const j = (await r.json().catch(() => ({}))) as { matched?: number; unmatched?: string[]; error?: string };
      if (!r.ok || j.error) throw new Error(j.error || "fail");
      onImported?.();
      window.alert(`반영 완료 · ${j.matched ?? 0}명` + (j.unmatched && j.unmatched.length ? `\n명단에 없어 건너뜀: ${j.unmatched.join(", ")}` : ""));
    } catch {
      window.alert("가져오기에 실패했어요. (원장만 가능 · 배포 환경에서만 동작)");
    } finally {
      setImporting(false);
    }
  }

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

  // 요일별 이벤트(0=월 … 6=일) — 정규 수업(매주 반복) + 이번 주 보강. 공휴일은 비움.
  const evtByDay: RawEvt[][] = [[], [], [], [], [], [], []];
  for (const s of students)
    for (const l of s.engSlots) {
      const di = DOW_ORDER.indexOf(l.day);
      if (di < 0) continue;
      if (holidayName(ymd(dates[di]))) continue;
      evtByDay[di].push({ name: s.name, start: timeToMin(l.time), dur: l.duration, time: l.time, type: "blue" });
    }
  for (const mk of makeups) {
    if (mk.status === "취소" || !mk.makeupDate) continue;
    const dd = parseD(mk.makeupDate);
    dd.setHours(0, 0, 0, 0);
    if (dd < mon || dd > sun) continue;
    const di = DOW_ORDER.indexOf(DOW[dd.getDay()]);
    if (di < 0) continue;
    evtByDay[di].push({
      name: (nameOf[mk.studentId] || "?") + " (보강)",
      start: timeToMin(mk.makeupTime || "16:00"),
      dur: durOf[mk.studentId] || 60,
      time: mk.makeupTime || "16:00",
      type: "orange",
    });
  }

  // 평일은 항상, 토·일은 수업/보강 있을 때만 표시.
  const visIdx = [0, 1, 2, 3, 4, 5, 6].filter((i) => i < 5 || evtByDay[i].length > 0);
  const nCols = visIdx.length;
  const total = evtByDay.reduce((n, d) => n + d.length, 0);
  const colStyle = { gridTemplateColumns: `repeat(${nCols}, minmax(150px, 1fr))`, minWidth: nCols * 150 };

  return (
    <>
      <div className="sm-head">
        <div>
          <h1 className="sm-title">{bandLabel} · 주간 시간표</h1>
          <p className="sm-desc">{rangeLabel} · 정규 수업 및 보강</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {canImport && (
            <button className="btn ghost" onClick={importTimetable} disabled={importing}>
              {importing ? "가져오는 중…" : "중고등 시간표 가져오기"}
            </button>
          )}
          <Select value={String(curWeek)} onChange={(v) => setCurWeek(+v)} options={WEEK_OPTS} />
        </div>
      </div>

      {total === 0 ? (
        <div className="hub-muted" style={{ padding: 20 }}>
          이 주에 표시할 영어 수업이 없어요. <b>학생 명단</b>에서 학생 프로필 → 영어 수업시간을 입력하세요.
        </div>
      ) : (
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
                          <div className={"eng-wevt evt-" + e.type} key={i} title={`${e.time} · ${e.dur}분 (${e.names.length}명)`}>
                            <div className="eng-wtime">
                              {e.time}
                              <span className="eng-wdur">{e.dur}분</span>
                              {e.names.length > 1 && <span className="e-cnt">{e.names.length}</span>}
                            </div>
                            <div className="eng-wnames">
                              {e.names.map((n, j) => (
                                <span className="eng-wnm" key={j}>{n}</span>
                              ))}
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
            <div className="tt-leg"><span className="sw" style={{ background: "var(--brand-soft)", border: "1px solid #cfe0fb" }} />정규 수업</div>
            <div className="tt-leg"><span className="sw" style={{ background: "var(--warn-soft)", border: "1px solid #ffd9b8" }} />보강</div>
            <div className="tt-leg" style={{ marginLeft: "auto", color: "var(--ink3)" }}>오늘은 파란색으로 강조됩니다</div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------- 보강 관리 ---------------- */
function EngMakeupPanel({ students }: { students: RosterStudent[] }) {
  const ids = useMemo(() => new Set(students.map((s) => s.id)), [students]);
  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of students) m[s.id] = s.name;
    return m;
  }, [students]);
  const [list, setList] = useState<EngMakeup[]>([]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ studentId: "", absentDate: todayStr(), makeupDate: todayStr(), makeupTime: "16:00", memo: "" });

  const reload = () => engApi.makeups().then((all) => setList(all.filter((mk) => ids.has(mk.studentId)))).catch(() => {});
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [students]);

  async function add() {
    if (!f.studentId) return;
    await engApi.saveMakeup(f);
    setAdding(false);
    setF({ studentId: "", absentDate: todayStr(), makeupDate: todayStr(), makeupTime: "16:00", memo: "" });
    void reload();
  }
  async function setStatus(mk: EngMakeup, status: string) {
    await engApi.saveMakeup({ ...mk, status });
    void reload();
  }
  async function remove(mk: EngMakeup) {
    if (!window.confirm("이 보강을 삭제할까요?")) return;
    await engApi.removeMakeup(mk.id);
    void reload();
  }

  const pending = list.filter((m) => m.status === "예정");
  const others = list.filter((m) => m.status !== "예정");

  return (
    <div className="eng-makeup">
      <div className="eng-add-row" style={{ marginBottom: 12 }}>
        {adding ? (
          <>
            <select className="sm-input" value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })}>
              <option value="">학생 선택</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input className="sm-input" type="date" value={f.absentDate} onChange={(e) => setF({ ...f, absentDate: e.target.value })} title="결석일" />
            <span className="eng-slash">→</span>
            <input className="sm-input" type="date" value={f.makeupDate} onChange={(e) => setF({ ...f, makeupDate: e.target.value })} title="보강일" />
            <input className="sm-input" type="time" value={f.makeupTime} onChange={(e) => setF({ ...f, makeupTime: e.target.value })} title="보강시간" />
            <input className="input" value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="메모(선택)" />
            <button className="btn primary" onClick={add} disabled={!f.studentId}>등록</button>
            <button className="btn ghost" onClick={() => setAdding(false)}>취소</button>
          </>
        ) : (
          <button className="btn primary" onClick={() => setAdding(true)}>+ 보강 등록</button>
        )}
      </div>

      <h3 className="eng-mk-h">예정 {pending.length}건</h3>
      <div className="eng-rows">
        {pending.map((mk) => (
          <MakeupRow key={mk.id} mk={mk} name={nameOf[mk.studentId] || "?"} onStatus={setStatus} onRemove={remove} />
        ))}
        {pending.length === 0 && <div className="hub-muted">예정된 보강이 없어요.</div>}
      </div>
      {others.length > 0 && (
        <>
          <h3 className="eng-mk-h" style={{ marginTop: 16 }}>완료·취소</h3>
          <div className="eng-rows">
            {others.map((mk) => (
              <MakeupRow key={mk.id} mk={mk} name={nameOf[mk.studentId] || "?"} onStatus={setStatus} onRemove={remove} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
function MakeupRow({ mk, name, onStatus, onRemove }: { mk: EngMakeup; name: string; onStatus: (m: EngMakeup, s: string) => void; onRemove: (m: EngMakeup) => void }) {
  return (
    <div className="eng-row">
      <div className="eng-row-main">
        <b>{name}</b>
        <span className="eng-lv">{mk.absentDate} 결석 → {mk.makeupDate} {mk.makeupTime}</span>
        {mk.memo && <span className="eng-mk-memo">{mk.memo}</span>}
      </div>
      <select className="sm-input" value={mk.status} onChange={(e) => onStatus(mk, e.target.value)}>
        <option value="예정">예정</option>
        <option value="완료">완료</option>
        <option value="취소">취소</option>
      </select>
      <button className="btn ghost sm" onClick={() => onRemove(mk)}>삭제</button>
    </div>
  );
}

/* ---------------- 현황 대시보드 ---------------- */
function EngDashboard({ students, daily, band }: { students: RosterStudent[]; daily: Record<string, EngDaily>; band: Band }) {
  const attended = students.filter((s) => daily[s.id]?.attended);
  const hwDone = attended.filter((s) => daily[s.id]?.hwChecked);
  const notYet = students.filter((s) => !daily[s.id]?.attended);
  const showHw = band !== "elem"; // 초등영어는 숙제 없음

  return (
    <div className="eng-dash">
      <div className="eng-stats">
        <Stat label="출석" value={`${attended.length}/${students.length}`} />
        {showHw && <Stat label="숙제검사 완료" value={`${hwDone.length}/${attended.length || 0}`} />}
        <Stat label="미출석" value={String(notYet.length)} tone="warn" />
      </div>
      <div className="eng-dash-sec">
        <h3>오늘 미출석</h3>
        <div className="eng-chiprow">
          {notYet.length === 0 ? <span className="hub-muted">없음</span> : notYet.map((s) => <span className="eng-chip" key={s.id}>{s.name}</span>)}
        </div>
      </div>
      <div className="eng-dash-sec">
        <h3>출석 학생</h3>
        <div className="eng-chiprow">
          {attended.length === 0 ? <span className="hub-muted">아직 없음</span> : attended.map((s) => (
            <span className={"eng-chip" + (daily[s.id]?.hwChecked ? " ok" : "")} key={s.id}>{s.name}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className={"eng-stat" + (tone ? " " + tone : "")}>
      <div className="eng-stat-v">{value}</div>
      <div className="eng-stat-l">{label}</div>
    </div>
  );
}
