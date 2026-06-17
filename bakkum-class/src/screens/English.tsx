import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { getRoster, inEngBand, type RosterStudent } from "../lib/rosterApi";
import { engApi, hwProgress, naesinActiveOn, HW_STATUSES, POINT_REASONS, ENG_ATTITUDES, ELEM_LOG_ITEMS, type AttStatus, type EngDaily, type EngMakeup, type EngNaesin, type EngProgress, type EngTest, type Goal, type HwStatus } from "../lib/engApi";
import { materialsApi, eventsApi, type MaterialAssign, type EventItem } from "../lib/hubApi";
import { MID_ENG_TIMETABLE } from "../lib/engTimetableSeed";
import { DOW, DOW_ORDER, TODAY, fmtMD, fmtMDDow, mondayOf, parseD, timeToMin, todayStr, ymd } from "../lib/dates";
import { holidayName } from "../lib/holidays";
import { Select, Empty } from "../components/ui";
import { useStore } from "../store";
import { Icon } from "../icons";
import { useApprovedChanges, arrivalOf, findSlotConflicts } from "../lib/changeReqLive";
import { ConflictPopup, ApprovedBanner } from "../components/ChangeReqLive";
import { DateNav, DateField } from "../components/DateControls";
import { CurriculumEditor } from "./StudentPage";
import { studentApi, type Curriculum } from "../lib/studentApi";

type Band = "elem" | "mid";
type Tab = "today" | "tt" | "att" | "hw" | "progress" | "test" | "makeup" | "board" | "cur" | "items" | "naesin";

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
  makeup: false,
  goals: [],
  homework: "",
  hwChecked: false,
  hwWord: "",
  hwReading: "",
  hwGrammar: "",
  wrongCheck: false,
  attitude: "",
  pointReasons: [],
  points: 0,
  note: "",
  bookNo: "",
  wordTest: "",
  doneItems: [],
  comment: "",
  materials: "",
  hwAssign: [],
  hwCheck: [],
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

  // 포인트 항목 카탈로그(점수표) — '포인트 항목' 화면에서 관리. 여기선 읽어서 자동 적립 계산에만 사용.
  const [reasonsAll, setReasonsAll] = useState<{ name: string; value: number }[]>(POINT_REASONS);
  const loadReasons = () => engApi.pointReasons().then((rs) => { if (rs.length) setReasonsAll(rs); }).catch(() => {});
  useEffect(() => {
    void loadReasons();
    const onFocus = () => void loadReasons();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // '오늘 한 것' 항목 — 선택한 학생 기준(기본+전체공통+학생별). 학생 바꾸면 다시 로드.
  const [doneOptions, setDoneOptions] = useState<string[]>(ELEM_LOG_ITEMS);
  const loadDoneOptions = (sid: string) => { if (sid) engApi.doneItems(sid).then((c) => setDoneOptions(c.merged)).catch(() => {}); };
  useEffect(() => { if (band === "elem" && sel) loadDoneOptions(sel); else setDoneOptions(ELEM_LOG_ITEMS); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sel, band]);
  async function addDoneItemForStudent(label: string) {
    if (!sel || !label.trim()) return;
    await engApi.saveDoneItem({ scope: "student", studentId: sel, add: label.trim() }).catch(() => {});
    loadDoneOptions(sel);
  }

  // 내신기간 모드 — 학생별 ON/기간. 중고등만. 켜진 기간엔 '오늘' 숙제가 자유입력+배부자료 기준으로 바뀐다.
  const [naesinMap, setNaesinMap] = useState<Record<string, EngNaesin>>({});
  const loadNaesin = () => engApi.naesin().then((list) => { const m: Record<string, EngNaesin> = {}; for (const r of list) m[r.studentId] = r; setNaesinMap(m); }).catch(() => {});
  useEffect(() => { if (band === "mid") void loadNaesin(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [band]);

  const students = useMemo(
    () => roster.filter((s) => s.subjects.includes("english") && inEngBand(s.englishBand, band)),
    [roster, band]
  );

  useEffect(() => {
    getRoster().then(setRoster).catch(() => setErr("명단을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."));
  }, []);

  // 날짜별 일일기록 로드
  useEffect(() => {
    const loadDaily = () =>
      engApi
        .dailyByDate(date)
        .then((list) => {
          const m: Record<string, EngDaily> = {};
          for (const d of list) m[d.studentId] = d;
          setDaily(m);
        })
        .catch(() => {});
    void loadDaily();
    // 오늘·출결·현황 화면은 학생/다른 강사 입력이 바로 반영되게 15초마다 새로고침(실시간 근사).
    if (initialTab === "today" || initialTab === "att" || initialTab === "board") {
      const iv = setInterval(loadDaily, 15000);
      const onFocus = () => void loadDaily();
      window.addEventListener("focus", onFocus);
      return () => { clearInterval(iv); window.removeEventListener("focus", onFocus); };
    }
  }, [date, initialTab]);

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
  // 출결 상태 지정 — 수학과 통일. 출석·지각·조퇴는 등원, 결석·무단결석은 미등원.
  // 지각 분·결석 사유는 인라인 입력(아래 patchDaily)으로 받는다. 결석은 백엔드에서 보강 자동연결.
  function setStatus(sid: string, status: AttStatus) {
    const d = getDaily(sid);
    const attended = status === "출석" || status === "지각" || status === "조퇴";
    void saveDaily({
      ...d,
      attStatus: status,
      attended,
      lateMin: status === "지각" ? d.lateMin || 0 : 0,
      absentReason: status === "결석" || status === "무단결석" ? d.absentReason : "",
    });
  }
  // 일일기록 부분 수정(지각 분·결석 사유·수업태도·특이사항 등 인라인 입력).
  function patchDaily(sid: string, patch: Partial<EngDaily>) {
    void saveDaily({ ...getDaily(sid), ...patch });
  }
  // 보강 플래그 토글 — 출결은 그대로 두고 보강 여부만 켜고/끈다(켜면 포인트 미적립).
  function setMakeup(sid: string, on: boolean) {
    void saveDaily({ ...getDaily(sid), makeup: on });
  }

  // 시간표 변경요청 — 그 날짜 승인된 1회성 변경(영어) 반영 + 수학↔영어 겹침 감지.
  const approvedChanges = useApprovedChanges(date);
  // 이 날짜로 옮겨온(원래 다른 날) 학생 / 이 날짜에서 다른 날로 빠진 학생.
  const arrivedIds = useMemo(
    () => new Set(approvedChanges.filter((c) => c.subject === "english" && (c.toDate || c.changeDate) === date && c.fromDate && c.fromDate !== date).map((c) => c.studentId)),
    [approvedChanges, date]
  );
  const departedIds = useMemo(
    () => new Set(approvedChanges.filter((c) => c.subject === "english" && c.fromDate === date && (c.toDate || c.changeDate) !== date).map((c) => c.studentId)),
    [approvedChanges, date]
  );

  // 오늘 등원 예정 = 그 요일 영어 수업 학생 − 빠진 학생 + 옮겨온 학생.
  const dowSel = DOW[parseD(date).getDay()];
  const scheduledIds = useMemo(() => {
    const base = new Set(students.filter((s) => s.engSlots.some((sl) => sl.day === dowSel)).map((s) => s.id));
    for (const id of departedIds) base.delete(id);
    for (const id of arrivedIds) base.add(id);
    return base;
  }, [students, dowSel, departedIds, arrivedIds]);
  // 변경 시간(이 날로 잡힌 시간)이 있으면 그걸, 없으면 원래 요일 슬롯 시간.
  const slotTimeOf = (s: RosterStudent) =>
    arrivalOf(approvedChanges, s.id, "english", date)?.toTime || s.engSlots.find((sl) => sl.day === dowSel)?.time || "";
  // 예정 학생 먼저(수업 시간순), 그다음 '추가 등원'(예정 아니지만 기록 있는 학생).
  const todayList = useMemo(() => {
    const sched = students.filter((s) => scheduledIds.has(s.id)).sort((a, b) => slotTimeOf(a).localeCompare(slotTimeOf(b)));
    const extra = students.filter((s) => !scheduledIds.has(s.id) && (daily[s.id]?.attStatus || daily[s.id]?.attended));
    return [...sched, ...extra];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, scheduledIds, daily, approvedChanges]);
  const addable = students.filter((s) => !scheduledIds.has(s.id) && !(daily[s.id]?.attStatus || daily[s.id]?.attended));
  // A-4 초등 출결 활성화 — 초등은 시간표(engSlots)가 없을 때가 많아 예정 목록이 비기 쉽다.
  // 출결 탭에서 예정 학생이 없으면 그 반 전체 학생을 보여줘 출결을 무조건 할 수 있게(대시보드 집계 필수).
  const attEmpty = todayList.length === 0;
  const attList = attEmpty && band === "elem" ? students : todayList;
  const attAddable = attEmpty && band === "elem" ? [] : addable;

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
    cur: "커리큘럼",
    items: "오늘 한 것 수정",
    naesin: "내신모드",
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
    cur: "학생 화면에 보이는 커리큘럼(수업 내용)을 학생별로 수정하세요.",
    items: "'오늘 한 것' 체크 항목을 추가·삭제하세요. 모두에게 또는 특정 학생에게.",
    naesin: "내신기간 학생을 켜고 기간·학교·시험일을 정하세요. 켜진 기간엔 '오늘' 숙제가 자유입력+배부자료 기준으로 바뀝니다.",
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
          {(tab === "today" || tab === "att") && <DateNav value={date} onChange={setDate} />}
          <div className="sm-count">{students.length}명</div>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
      {showLive && <ApprovedBanner changes={approvedChanges} subject="english" date={date} />}
      {showLive && <ConflictPopup conflicts={conflicts} date={date} />}
      {students.length === 0 && (
        <div className="hub-muted">
          이 반에 배정된 영어 학생이 없어요. <b>학생 명단</b>에서 학생에 영어 + {band === "elem" ? "초등" : "중고등"}을 지정하세요.
        </div>
      )}

      {tab === "board" ? (
        <EngDashboard students={students} daily={daily} band={band} />
      ) : tab === "naesin" ? (
        <EngNaesinPanel students={students} naesinMap={naesinMap} onChanged={loadNaesin} />
      ) : tab === "makeup" ? (
        <EngMakeupPanel students={students} />
      ) : tab === "att" ? (
        <EngAttendance list={attList} addable={attAddable} date={date} daily={daily} scheduledIds={scheduledIds} slotTimeOf={slotTimeOf} getDaily={getDaily} onStatus={setStatus} onMakeup={setMakeup} onPatch={patchDaily} />
      ) : tab === "hw" ? (
        <EngHomework students={students} />
      ) : tab === "items" ? (
        <DoneItemsManager students={students} />
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
                <div key={s.id} className={"eng-stu" + (tab === "today" ? " today-side-row" : "") + (sel === s.id ? " on" : "")}>
                  <button className="eng-stu-name" onClick={() => setSel(s.id)}>
                    <span className="today-side-nm">{s.name}</span>
                    {band === "mid" && s.englishBand === "bridge" && <span className="eng-stu-bridge" title="Bridge — 초등 고학년·중고등 수업">Bridge</span>}
                    {tab === "today" && scheduledIds.has(s.id) && slotTimeOf(s) && <span className="eng-stu-time">{slotTimeOf(s)}</span>}
                    {tab === "today" && (() => { const ch = arrivalOf(approvedChanges, s.id, "english", date); return ch ? <span className="eng-stu-chg" title="승인된 시간 변경">{arrivedIds.has(s.id) ? "이동 " : ""}{ch.toTime}</span> : null; })()}
                    {tab === "today" && st && <span className={"today-side-st " + (st === "출석" ? "g" : st === "지각" || st === "조퇴" ? "w" : "b")}>{st}{st === "지각" && d?.lateMin ? ` ${d.lateMin}분` : ""}</span>}
                    {tab === "today" && d?.makeup && <span className="eng-stu-mk" title="보강 수업 (포인트 미적립)">보강</span>}
                    {tab === "today" && band === "mid" && naesinActiveOn(naesinMap[s.id], date) && <span className="eng-stu-naesin" title="내신기간 모드">내신</span>}
                    {tab === "today" && d && (d.hwChecked || hwProgress(d) !== null) && <span className="eng-dot ok" title="숙제 기록됨" />}
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
                    : tab === "cur"
                      ? "왼쪽에서 학생을 선택하면 그 학생의 커리큘럼을 수정할 수 있어요."
                      : "왼쪽에서 학생을 선택하면 테스트 점수를 기록할 수 있어요."}
              </div>
            ) : tab === "today" ? (
              <DailyEditor key={sel + date} student={nameOf[sel] || ""} band={band} value={getDaily(sel)} onSave={saveDaily} doneItemsAll={doneOptions} reasonsAll={reasonsAll} onAddDoneItem={addDoneItemForStudent} examMode={band === "mid" && naesinActiveOn(naesinMap[sel], date)} />
            ) : tab === "progress" ? (
              <ProgressPanel studentId={sel} name={nameOf[sel] || ""} />
            ) : tab === "cur" ? (
              <CurriculumPanel key={sel} studentId={sel} name={nameOf[sel] || ""} />
            ) : (
              <TestPanel studentId={sel} name={nameOf[sel] || ""} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- '오늘 한 것' 항목 관리 — 모두에게 / 특정 학생에게 추가·삭제 ---------------- */
function DoneItemsManager({ students }: { students: RosterStudent[] }) {
  const [defaults, setDefaults] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [global, setGlobal] = useState<string[]>([]);
  const [sid, setSid] = useState("");
  const [studentItems, setStudentItems] = useState<string[]>([]);
  const [addAll, setAddAll] = useState("");
  const [addStu, setAddStu] = useState("");

  const loadGlobal = () => engApi.doneItems().then((c) => { setDefaults(c.defaults); setHidden(c.hidden || []); setGlobal(c.global); }).catch(() => {});
  const loadStudent = (id: string) => { if (id) engApi.doneItems(id).then((c) => setStudentItems(c.student)).catch(() => {}); else setStudentItems([]); };
  useEffect(() => { void loadGlobal(); }, []);
  useEffect(() => { loadStudent(sid); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sid]);

  async function addToAll() { const v = addAll.trim(); if (!v) return; setAddAll(""); await engApi.saveDoneItem({ scope: "all", add: v }).catch(() => {}); void loadGlobal(); }
  async function removeFromAll(it: string) { await engApi.saveDoneItem({ scope: "all", remove: it }).catch(() => {}); void loadGlobal(); }
  async function restoreDefault(it: string) { await engApi.saveDoneItem({ scope: "all", add: it }).catch(() => {}); void loadGlobal(); }
  const activeDefaults = defaults.filter((d) => !hidden.includes(d));
  async function addToStudent() { const v = addStu.trim(); if (!v || !sid) return; setAddStu(""); await engApi.saveDoneItem({ scope: "student", studentId: sid, add: v }).catch(() => {}); loadStudent(sid); }
  async function removeFromStudent(it: string) { if (!sid) return; await engApi.saveDoneItem({ scope: "student", studentId: sid, remove: it }).catch(() => {}); loadStudent(sid); }

  return (
    <div className="di-wrap">
      <div className="mk-group">
        <div className="mk-grouphead">기본 항목 <span className="gcnt">{activeDefaults.length}개</span></div>
        <div className="card" style={{ padding: 14 }}>
          {activeDefaults.length === 0 ? <div className="hub-muted">모든 기본 항목을 숨겼어요.</div> : (
            <div className="di-chips">{activeDefaults.map((it) => <span key={it} className="di-chip">{it}<button className="di-x" onClick={() => removeFromAll(it)} title="숨기기">×</button></span>)}</div>
          )}
          {hidden.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="page-desc" style={{ marginBottom: 6 }}>숨긴 기본 항목</div>
              <div className="di-chips">{hidden.map((it) => <span key={it} className="di-chip fixed">{it}<button className="di-x restore" onClick={() => restoreDefault(it)} title="복원">↩</button></span>)}</div>
            </div>
          )}
        </div>
      </div>

      <div className="mk-group">
        <div className="mk-grouphead">모두에게 추가 <span className="gcnt">{global.length}개</span></div>
        <div className="card" style={{ padding: 14 }}>
          <div className="eng-add-row" style={{ marginBottom: 10 }}>
            <input className="input" value={addAll} onChange={(e) => setAddAll(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addToAll()} placeholder="모든 학생에게 추가할 항목 (예: 받아쓰기)" />
            <button className="btn primary" onClick={addToAll} disabled={!addAll.trim()}>추가</button>
          </div>
          {global.length === 0 ? <div className="hub-muted">추가한 공통 항목이 없어요.</div> : (
            <div className="di-chips">{global.map((it) => <span key={it} className="di-chip">{it}<button className="di-x" onClick={() => removeFromAll(it)} title="삭제">×</button></span>)}</div>
          )}
        </div>
      </div>

      <div className="mk-group">
        <div className="mk-grouphead">특정 학생에게만</div>
        <div className="card" style={{ padding: 14 }}>
          <select className="sm-input" style={{ marginBottom: 10, minWidth: 160 }} value={sid} onChange={(e) => setSid(e.target.value)}>
            <option value="">학생 선택</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {sid ? (
            <>
              <div className="eng-add-row" style={{ marginBottom: 10 }}>
                <input className="input" value={addStu} onChange={(e) => setAddStu(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addToStudent()} placeholder="이 학생에게만 추가할 항목" />
                <button className="btn primary" onClick={addToStudent} disabled={!addStu.trim()}>추가</button>
              </div>
              {studentItems.length === 0 ? <div className="hub-muted">이 학생에게만 추가한 항목이 없어요.</div> : (
                <div className="di-chips">{studentItems.map((it) => <span key={it} className="di-chip">{it}<button className="di-x" onClick={() => removeFromStudent(it)} title="삭제">×</button></span>)}</div>
              )}
            </>
          ) : <div className="hub-muted">학생을 선택하면 그 학생에게만 보이는 항목을 추가할 수 있어요.</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- 내신기간 모드 관리 — 학생별 ON/기간·학교·시험일 ---------------- */
function ddayLabel(examDate: string, today: string): string {
  if (!examDate) return "";
  const a = parseD(today), b = parseD(examDate);
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  if (diff === 0) return "D-DAY";
  return diff > 0 ? "D-" + diff : "D+" + -diff;
}
/** 학원 일정에서 시험일 추정 — 학교명 + '시험/고사' 키워드가 든 다가오는 일정의 시작일. 없으면 빈칸. */
function guessExamDate(events: EventItem[], school: string, today: string): string {
  const sc = (school || "").trim().toLowerCase();
  if (!sc) return "";
  const cand = events
    .filter((e) => {
      const text = (e.title + " " + e.category + " " + e.memo).toLowerCase();
      const examish = text.includes("시험") || text.includes("고사") || text.includes("내신");
      return examish && text.includes(sc);
    })
    .filter((e) => (e.endDate || e.date) >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return cand[0]?.date || "";
}
const NAESIN_BLANK = (sid: string): EngNaesin => ({ studentId: sid, on: false, startDate: "", endDate: "", school: "", grade: "", examDate: "", memo: "" });

function EngNaesinPanel({ students, naesinMap, onChanged }: { students: RosterStudent[]; naesinMap: Record<string, EngNaesin>; onChanged: () => void }) {
  const today = todayStr();
  const stuById = useMemo(() => { const m: Record<string, RosterStudent> = {}; for (const s of students) m[s.id] = s; return m; }, [students]);
  const [events, setEvents] = useState<EventItem[]>([]);
  useEffect(() => { eventsApi.list().then(setEvents).catch(() => {}); }, []);

  // 로컬이 화면의 진실 — 토글/입력은 즉시 반영(렉 없음), 저장은 백그라운드. 서버 갱신은 미저장분만 보존하며 머지.
  const [recs, setRecs] = useState<Record<string, EngNaesin>>(naesinMap);
  const touched = useRef<Set<string>>(new Set());
  useEffect(() => {
    setRecs((cur) => {
      const next: Record<string, EngNaesin> = { ...naesinMap };
      for (const sid of touched.current) if (cur[sid]) next[sid] = cur[sid];
      return next;
    });
  }, [naesinMap]);

  const recOf = (sid: string): EngNaesin => recs[sid] || naesinMap[sid] || NAESIN_BLANK(sid);
  const dirty = (sid: string): boolean => JSON.stringify(recOf(sid)) !== JSON.stringify(naesinMap[sid] || NAESIN_BLANK(sid));

  // 학생 매칭 자동 채움 — 학교·학년은 명단에서, 시험일은 학원 일정에서(있으면).
  function autoFill(sid: string, rec: EngNaesin): EngNaesin {
    const s = stuById[sid];
    const school = rec.school || s?.school || "";
    const grade = rec.grade || s?.grade || "";
    const examDate = rec.examDate || guessExamDate(events, school, today);
    return { ...rec, school, grade, examDate };
  }
  function persist(rec: EngNaesin) {
    touched.current.add(rec.studentId);
    engApi.saveNaesin(rec).then(() => { touched.current.delete(rec.studentId); onChanged(); }).catch(() => {});
  }
  function patch(sid: string, p: Partial<EngNaesin>) {
    touched.current.add(sid);
    setRecs((cur) => ({ ...cur, [sid]: { ...recOf(sid), ...p } }));
  }
  function toggle(sid: string) {
    const cur = recOf(sid);
    const next = cur.on ? { ...cur, on: false } : autoFill(sid, { ...cur, on: true });
    setRecs((r) => ({ ...r, [sid]: next }));
    persist(next);
  }
  function save(sid: string) { persist(recOf(sid)); }

  // 한 번에 켜기 — 선택 학생 + 공통 기간.
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [bulkStart, setBulkStart] = useState("");
  const [bulkEnd, setBulkEnd] = useState("");
  function togglePick(sid: string) { setPick((p) => { const n = new Set(p); n.has(sid) ? n.delete(sid) : n.add(sid); return n; }); }
  function bulkOn() {
    if (!pick.size) return;
    const updated: Record<string, EngNaesin> = {};
    for (const sid of pick) {
      const next = autoFill(sid, { ...recOf(sid), on: true, startDate: bulkStart || recOf(sid).startDate, endDate: bulkEnd || recOf(sid).endDate });
      updated[sid] = next;
      persist(next);
    }
    setRecs((r) => ({ ...r, ...updated }));
    setPick(new Set());
  }

  const activeN = students.filter((s) => naesinActiveOn(recOf(s.id), today)).length;

  return (
    <div className="naesin-wrap">
      {/* 한 번에 켜기 */}
      <div className="mk-group">
        <div className="mk-grouphead">한 번에 켜기 <span className="gcnt">선택 {pick.size}명</span></div>
        <div className="card" style={{ padding: 14 }}>
          <div className="naesin-bulk-ctl">
            <label className="naesin-f"><span>공통 시작일</span><DateField value={bulkStart} onChange={setBulkStart} placeholder="시작일" /></label>
            <label className="naesin-f"><span>공통 종료일</span><DateField value={bulkEnd} onChange={setBulkEnd} placeholder="종료일" /></label>
            <button className="btn primary sm" onClick={bulkOn} disabled={!pick.size}>{pick.size ? `선택 ${pick.size}명 내신 켜기` : "학생 선택"}</button>
          </div>
          <div className="naesin-pickrow">
            {students.map((s) => {
              const on = naesinActiveOn(recOf(s.id), today);
              return (
                <button key={s.id} className={"mat-cand-chip" + (pick.has(s.id) ? " on" : "") + (on ? " already" : "")} onClick={() => togglePick(s.id)} title={on ? "이미 내신중" : ""}>
                  {s.name}{s.grade ? ` ${s.grade}` : ""}{on && <span className="mat-cand-dot">✓</span>}
                </button>
              );
            })}
            {students.length === 0 && <div className="hub-muted">중고등 영어 학생이 없어요.</div>}
          </div>
          <div className="naesin-help" style={{ marginTop: 8 }}>학교·학년은 학생 명단에서 자동으로 채워지고, 시험일은 학원 일정에 ‘학교명+시험’ 일정이 있으면 끌어옵니다(없으면 빈칸).</div>
        </div>
      </div>

      <div className="mk-group">
        <div className="mk-grouphead">내신기간 학생 <span className="gcnt">현재 {activeN}명</span></div>
        <div className="naesin-help">켜진 기간(시작~종료) 안에서는 그 학생의 ‘오늘’ 숙제가 <b>자유 입력 + 배부 자료 기준</b>으로 바뀝니다. 종료일이 지나면 자동으로 평소 모드(단어·리딩·문법)로 돌아갑니다.</div>
        {students.length === 0 ? (
          <div className="hub-muted">중고등 영어 학생이 없어요.</div>
        ) : (
          <div className="naesin-list">
            {students.map((s) => {
              const r = recOf(s.id);
              const active = naesinActiveOn(r, today);
              return (
                <div className={"naesin-item" + (r.on ? " on" : "")} key={s.id}>
                  <div className="naesin-row1">
                    <button className={"naesin-toggle" + (r.on ? " on" : "")} onClick={() => toggle(s.id)} role="switch" aria-checked={r.on}>
                      <span className="naesin-knob" />
                    </button>
                    <span className="naesin-name">{s.name}{s.grade && <span className="naesin-grade">{s.grade}</span>}</span>
                    {active && <span className="badge b-purple">내신중</span>}
                    {r.on && r.examDate && <span className="naesin-dday">{ddayLabel(r.examDate, today)}</span>}
                  </div>
                  {r.on && (
                    <div className="naesin-fields">
                      <label className="naesin-f"><span>시작일</span><DateField value={r.startDate} onChange={(v) => patch(s.id, { startDate: v })} placeholder="시작일" /></label>
                      <label className="naesin-f"><span>종료일</span><DateField value={r.endDate} onChange={(v) => patch(s.id, { endDate: v })} placeholder="종료일" /></label>
                      <label className="naesin-f"><span>학교</span><input className="input" style={{ minWidth: 110 }} value={r.school} onChange={(e) => patch(s.id, { school: e.target.value })} placeholder="예: 호평중" /></label>
                      <label className="naesin-f"><span>학년</span><input className="input" style={{ minWidth: 70, maxWidth: 90 }} value={r.grade} onChange={(e) => patch(s.id, { grade: e.target.value })} placeholder="예: 중3" /></label>
                      <label className="naesin-f"><span>시험일</span><DateField value={r.examDate} onChange={(v) => patch(s.id, { examDate: v })} placeholder="시험일" /></label>
                      <button className="btn primary sm naesin-save" onClick={() => save(s.id)} disabled={!dirty(s.id)}>{dirty(s.id) ? "저장" : "저장됨"}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="naesin-soon">
        <div className="naesin-soon-h">곧 추가될 내신모드 기능 <span className="eng-mk-tag soft">준비중</span></div>
        <ul>
          <li>학교별 시험범위 입력 · 시험범위별 진도 체크</li>
          <li>오답·재시(NP) 집중 관리</li>
          <li>시험 후 결과 기록</li>
        </ul>
        <div className="hub-muted" style={{ marginTop: 6 }}>원장님과 항목·전환 규칙을 확정한 뒤 추가합니다.</div>
      </div>
    </div>
  );
}

/* ---------------- 커리큘럼 편집(메뉴에서) — 학생 화면에 보이는 커리큘럼 수정 ---------------- */
function CurriculumPanel({ studentId, name }: { studentId: string; name: string }) {
  const [cur, setCur] = useState<Curriculum | null>(null);
  const load = () => studentApi.page(studentId).then((d) => setCur(d.curriculum)).catch(() => {});
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [studentId]);
  return (
    <div className="eng-daily">
      <div className="eng-daily-h"><h2>{name} · 커리큘럼</h2></div>
      {!cur ? <div className="hub-muted" style={{ padding: 20 }}>불러오는 중…</div> : <CurriculumEditor studentId={studentId} cur={cur} onSaved={load} />}
    </div>
  );
}

/* 포인트 항목 카탈로그 → {기본이름: 점수} 맵(라벨 끝 숫자 제거). 자동 적립 계산용. */
function catMapOf(reasons: { name: string; value: number }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of reasons) { const k = String(r.name).replace(/\s*-?\d+\s*$/, "").trim(); if (k && !(k in m)) m[k] = r.value; }
  return m;
}
/** 출결·숙제 상태로 자동 적립 포인트 계산(서버와 동일 규칙). 미리보기용. */
function autoPointsOf(d: EngDaily, cm: Record<string, number>): { total: number; items: { l: string; v: number }[] } {
  if (d.makeup) return { total: 0, items: [] };
  const cs = (k: string, fb = 0) => (k in cm ? cm[k] : fb);
  const items: { l: string; v: number }[] = [];
  if (d.attStatus === "출석" || d.attStatus === "조퇴") { const v = cs("출석"); if (v) items.push({ l: "출석", v }); }
  else if (d.attStatus === "지각") { const v = cs("지각"); if (v) items.push({ l: "지각", v }); }
  const hw = (val: string, key: string) => {
    if (!val || val === "없음") return;
    const base = cs(key, cs("숙제", 50));
    const v = val === "완료" ? base : val === "미흡" ? Math.round(base / 2) : val === "안함" ? -base : 0;
    if (v) items.push({ l: key, v });
  };
  hw(d.hwWord, "단어숙제"); hw(d.hwReading, "독해숙제"); hw(d.hwGrammar, "문법숙제");
  return { total: items.reduce((n, x) => n + x.v, 0), items };
}

/* 출결 6종 → 수학 today-seg 트랙 색상(on-present/late/absent). 보강은 별도 플래그. */
const ENG_STATUS6: { v: AttStatus; on: string; att: boolean }[] = [
  { v: "출석", on: "on-present", att: true },
  { v: "지각", on: "on-late", att: true },
  { v: "결석", on: "on-absent", att: false },
  { v: "조퇴", on: "on-late", att: true },
  { v: "무단결석", on: "on-absent", att: false },
];

/* ---------------- 일일 학습일지 편집 ---------------- */
function DailyEditor({ student, band, value, onSave, doneItemsAll, reasonsAll, onAddDoneItem, examMode }: { student: string; band: Band; value: EngDaily; onSave: (d: EngDaily) => void; doneItemsAll: string[]; reasonsAll: { name: string; value: number }[]; onAddDoneItem: (s: string) => void; examMode?: boolean }) {
  const showHw = band !== "elem"; // 초등영어는 숙제 없음
  const [d, setD] = useState<EngDaily>(value);
  const dirty = JSON.stringify(d) !== JSON.stringify(value);
  // 포인트 자동 적립 미리보기(출결·숙제 + 카탈로그 점수). 저장 시 서버가 동일 규칙으로 확정.
  const autoPts = useMemo(() => autoPointsOf(d, catMapOf(reasonsAll)), [d, reasonsAll]);

  // 내신모드 자유 숙제 — 지난 회차 '내줄 숙제'를 이번 '숙제 검사'로 이어 보여주기 + 배부 자료 기준 숙제.
  const [hist, setHist] = useState<EngDaily[]>([]);
  const [matAssigns, setMatAssigns] = useState<MaterialAssign[]>([]);
  const [matNames, setMatNames] = useState<Record<string, string>>({});
  const [newAssign, setNewAssign] = useState("");
  const [newCheck, setNewCheck] = useState("");
  useEffect(() => {
    if (!examMode) return;
    let alive = true;
    engApi.dailyByStudent(value.studentId).then((l) => { if (alive) setHist(l); }).catch(() => {});
    Promise.all([materialsApi.assigns({ studentId: value.studentId }), materialsApi.list()])
      .then(([as, ms]) => { if (!alive) return; setMatAssigns(as); const m: Record<string, string> = {}; for (const x of ms) m[x.id] = x.name; setMatNames(m); })
      .catch(() => {});
    return () => { alive = false; };
  }, [examMode, value.studentId]);
  // 지난(가장 가까운 이전 날짜) '내줄 숙제' — 이번 '숙제 검사'로 이어진다.
  const carried = useMemo(() => {
    const prior = hist.filter((x) => x.date < d.date && x.hwAssign && x.hwAssign.length).sort((a, b) => (a.date < b.date ? 1 : -1));
    return prior[0]?.hwAssign || [];
  }, [hist, d.date]);
  // 화면에 보일 '숙제 검사' 행 = (지난 내줄숙제 ∪ 이미 기록된 검사). 상태는 d.hwCheck에서.
  const checkStatusOf = (text: string): HwStatus => (d.hwCheck.find((c) => c.text === text)?.status || "") as HwStatus;
  const checkRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: { text: string; carried: boolean }[] = [];
    for (const t of carried) { if (!seen.has(t)) { seen.add(t); rows.push({ text: t, carried: true }); } }
    for (const c of d.hwCheck) { if (!seen.has(c.text)) { seen.add(c.text); rows.push({ text: c.text, carried: false }); } }
    return rows;
  }, [carried, d.hwCheck]);
  function setCheckStatus(text: string, status: HwStatus) {
    const others = d.hwCheck.filter((c) => c.text !== text);
    setD({ ...d, hwCheck: status ? [...others, { text, status }] : others });
  }
  function removeCheck(text: string) { setD({ ...d, hwCheck: d.hwCheck.filter((c) => c.text !== text) }); }
  function addAssign(text: string) { const v = text.trim(); if (!v || d.hwAssign.includes(v)) return; setD({ ...d, hwAssign: [...d.hwAssign, v] }); }
  function removeAssign(text: string) { setD({ ...d, hwAssign: d.hwAssign.filter((x) => x !== text) }); }
  // 숙제로 배부된 자료(이 학생) — 내줄 숙제로 한 번에 채워 넣을 수 있게.
  const hwMatNames = useMemo(() => {
    const names = matAssigns.filter((a) => a.kind === "hw").map((a) => matNames[a.materialId]).filter(Boolean);
    return [...new Set(names)] as string[];
  }, [matAssigns, matNames]);
  const lessonMatNames = useMemo(() => {
    const names = matAssigns.filter((a) => a.kind === "lesson").map((a) => matNames[a.materialId]).filter(Boolean);
    return [...new Set(names)] as string[];
  }, [matAssigns, matNames]);

  // 학생/다른 강사가 입력해 value(서버값)가 바뀌면, 교사가 편집 중이 아닐 때만 반영(편집분 보존).
  const prevValue = useRef(value);
  useEffect(() => {
    if (JSON.stringify(d) === JSON.stringify(prevValue.current)) setD(value);
    prevValue.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function setGoals(goals: Goal[]) {
    setD({ ...d, goals });
  }

  return (
    <div className="eng-daily">
      <div className="eng-daily-h">
        <h2>{student} · {d.date}</h2>
      </div>

      <div className="eng-field">
        <div className="eng-label">출결 {d.makeup && <span className="eng-mk-tag">보강 · 포인트 미적립</span>}</div>
        <div className="today-detail-row">
          <div className="today-seg">
            {ENG_STATUS6.map((o) => (
              <button key={o.v} className={d.attStatus === o.v ? o.on : ""} onClick={() => setD({ ...d, attStatus: d.attStatus === o.v ? "" : o.v, attended: d.attStatus === o.v ? false : o.att })}>{o.v}</button>
            ))}
          </div>
          <button className={"att-mk" + (d.makeup ? " on" : "")} onClick={() => setD({ ...d, makeup: !d.makeup })} title="보강 수업 (출결은 남기되 포인트 미적립)">보강</button>
        </div>
        {d.attStatus === "지각" && (
          <label className="eng-late-row">지각 <input className="sm-input" style={{ maxWidth: 90 }} type="number" min={0} step={5} value={d.lateMin || 0} onChange={(e) => setD({ ...d, lateMin: Number(e.target.value) || 0 })} /> 분</label>
        )}
        {(d.attStatus === "결석" || d.attStatus === "무단결석") && (
          <input className="input" style={{ marginTop: 6 }} value={d.absentReason} onChange={(e) => setD({ ...d, absentReason: e.target.value })} placeholder="결석 사유 (보강 관리에 자동 연결됩니다)" />
        )}
      </div>

      <div className="eng-field">
        <div className="eng-label">수업 태도</div>
        <div className="today-mood-seg">
          {ENG_ATTITUDES.map((a) => (
            <button key={a} className={d.attitude === a ? "on" : ""} onClick={() => setD({ ...d, attitude: d.attitude === a ? "" : a })}>{a}</button>
          ))}
        </div>
      </div>

      <div className="eng-field">
        <div className="eng-label">포인트 {d.makeup ? <span className="eng-mk-tag">보강 미적립</span> : <>· 오늘 <b className={autoPts.total < 0 ? "pc-minus" : "pc-plus"}>{autoPts.total > 0 ? "+" : ""}{autoPts.total}</b>점</>}</div>
        {d.makeup ? (
          <div className="eng-auto-hint">보강 수업은 포인트가 적립되지 않아요.</div>
        ) : autoPts.items.length === 0 ? (
          <div className="eng-auto-hint">출결·숙제를 입력하면 포인트가 <b>자동</b>으로 들어가요. (점수는 ‘포인트 항목’ 화면에서)</div>
        ) : (
          <div className="eng-auto-pts">
            {autoPts.items.map((x, i) => (
              <span key={i} className={"eng-auto-pt" + (x.v < 0 ? " minus" : "")}>{x.l} {x.v > 0 ? "+" : ""}{x.v}</span>
            ))}
          </div>
        )}
      </div>

      <div className="eng-field">
        <div className="eng-label">특이사항</div>
        <input className="input" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="특이사항 (예: 컨디션·전달사항)" />
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

      {/* 평소 모드 — 기존 단어/리딩/문법 3분류 숙제(포인트 자동적립 기준) */}
      {showHw && !examMode && (
        <div className="eng-field">
          <div className="eng-label">숙제{(() => { const p = hwProgress(d); return p === null ? "" : ` · 진행률 ${p}%`; })()}</div>
          <div className="eng-hw3">
            <HwRow label="단어숙제" value={d.hwWord} onChange={(v) => setD({ ...d, hwWord: v })} />
            <HwRow label="리딩숙제" value={d.hwReading} onChange={(v) => setD({ ...d, hwReading: v })} />
            <HwRow label="문법숙제" value={d.hwGrammar} onChange={(v) => setD({ ...d, hwGrammar: v })} />
          </div>
          <label className="eng-check"><input type="checkbox" checked={d.wrongCheck} onChange={(e) => setD({ ...d, wrongCheck: e.target.checked })} /> 틀단확인 (틀린 단어 확인)</label>
        </div>
      )}

      {/* 내신모드 — 학생마다 다른 숙제를 자유 입력. 지난 '내줄 숙제'가 이번 '숙제 검사'로 이어짐 + 배부 자료 기준. */}
      {showHw && examMode && (
        <>
          <div className="eng-field">
            <div className="eng-label">숙제 검사 <span className="eng-mk-tag soft">지난 시간에 내준 것</span></div>
            {checkRows.length === 0 ? (
              <div className="eng-auto-hint">지난 회차에 ‘내줄 숙제’를 입력하면 여기로 이어져 보여요. 아래에서 직접 추가할 수도 있어요.</div>
            ) : (
              <div className="eng-hwfree">
                {checkRows.map((r) => {
                  const st = checkStatusOf(r.text);
                  return (
                    <div className="eng-hwfree-row" key={r.text}>
                      <span className="eng-hwfree-t">{r.text}{r.carried && <span className="eng-hwfree-from" title="지난 시간 내준 숙제">이어받음</span>}</span>
                      <div className="eng-hw3-seg">
                        {HW_STATUSES.map((s) => {
                          const cls = s === "완료" ? "g" : s === "미흡" ? "w" : s === "안함" ? "b" : "";
                          return <button key={s} className={"eas hw " + cls + (st === s ? " on " + cls : "")} onClick={() => setCheckStatus(r.text, st === s ? "" : (s as HwStatus))}>{s}</button>;
                        })}
                      </div>
                      <button className="eng-hwfree-x" onClick={() => removeCheck(r.text)} aria-label="삭제">×</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="eng-add-row" style={{ marginTop: 8 }}>
              <input className="sm-input" value={newCheck} onChange={(e) => setNewCheck(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newCheck.trim()) { setCheckStatus(newCheck.trim(), "완료"); setNewCheck(""); } }} placeholder="검사할 숙제 직접 추가" />
              <button className="btn ghost sm" onClick={() => { if (newCheck.trim()) { setCheckStatus(newCheck.trim(), "완료"); setNewCheck(""); } }} disabled={!newCheck.trim()}>추가</button>
            </div>
          </div>

          <div className="eng-field">
            <div className="eng-label">내줄 숙제 <span className="eng-mk-tag soft">다음 시간</span></div>
            {d.hwAssign.length > 0 && (
              <div className="eng-hwchips">
                {d.hwAssign.map((t) => <span className="eng-hwchip" key={t}>{t}<button className="eng-hwchip-x" onClick={() => removeAssign(t)} aria-label="삭제">×</button></span>)}
              </div>
            )}
            <div className="eng-add-row" style={{ marginTop: 8 }}>
              <input className="sm-input" value={newAssign} onChange={(e) => setNewAssign(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { addAssign(newAssign); setNewAssign(""); } }} placeholder="다음 시간 낼 숙제 (예: 4과 그래머빌드업)" />
              <button className="btn ghost sm" onClick={() => { addAssign(newAssign); setNewAssign(""); }} disabled={!newAssign.trim()}>추가</button>
            </div>
            {hwMatNames.length > 0 && (
              <div className="eng-matpull">
                <span className="eng-matpull-l">📄 배부된 숙제 자료</span>
                {hwMatNames.map((nm) => (
                  <button key={nm} className={"eng-matpull-chip" + (d.hwAssign.includes(nm) ? " on" : "")} onClick={() => addAssign(nm)} title="내줄 숙제로 추가" disabled={d.hwAssign.includes(nm)}>
                    {nm}{d.hwAssign.includes(nm) ? " ✓" : " +"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* 중고등영어도 초등처럼 진도 체크 — 진도(교재·범위) + 단어시험 */}
      {showHw && (
        <div className="eng-field">
          <div className="eng-label">진도 체크</div>
          <div className="eng-grid2">
            <input className="input" value={d.bookNo} onChange={(e) => setD({ ...d, bookNo: e.target.value })} placeholder="진도 (교재·범위, 예: Insight 3과)" />
            <input className="input" value={d.wordTest} onChange={(e) => setD({ ...d, wordTest: e.target.value })} placeholder="단어시험 (예: 18/20)" />
          </div>
          {examMode && lessonMatNames.length > 0 && (
            <div className="eng-matpull">
              <span className="eng-matpull-l">📄 배부된 수업 자료</span>
              {lessonMatNames.map((nm) => (
                <button key={nm} className="eng-matpull-chip" onClick={() => setD({ ...d, bookNo: d.bookNo ? d.bookNo + ", " + nm : nm })} title="진도에 반영">{nm} +</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 초등영어 수업일지 — 원서 진도·활동·단어시험 */}
      {!showHw && (
        <>
          <div className="eng-field">
            <div className="eng-label">원서 진도번호</div>
            <input className="input" value={d.bookNo} onChange={(e) => setD({ ...d, bookNo: e.target.value })} placeholder="예: 145" />
          </div>
          <div className="eng-field">
            <div className="eng-label">오늘 한 것</div>
            <div className="eng-pts">
              {doneItemsAll.map((it) => {
                const on = d.doneItems.includes(it);
                return (
                  <button key={it} className={"eng-pt" + (on ? " on" : "")} onClick={() => setD({ ...d, doneItems: on ? d.doneItems.filter((x) => x !== it) : [...d.doneItems, it] })}>{it}</button>
                );
              })}
              <button
                type="button"
                className="eng-pt eng-pt-add"
                onClick={() => { const v = window.prompt("추가할 '오늘 한 것' 항목 이름"); if (v && v.trim()) onAddDoneItem(v); }}
              >
                + 항목 추가
              </button>
            </div>
          </div>
          <div className="eng-field">
            <div className="eng-label">단어시험</div>
            <input className="input" value={d.wordTest} onChange={(e) => setD({ ...d, wordTest: e.target.value })} placeholder="예: 18/20" />
          </div>
        </>
      )}

      {/* 오늘 시험 기록 — 여러 개 입력 + 미통과 재시(NP) 표시 (class_eng_test에 저장, 테스트 기록 탭과 공유) */}
      <DailyTests studentId={d.studentId} date={d.date} />

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

/* 숙제 분류 한 줄 — 완료/미흡/안함/없음 토글(같은 값 다시 누르면 해제). */
function HwRow({ label, value, onChange }: { label: string; value: HwStatus; onChange: (v: HwStatus) => void }) {
  const cls = (s: HwStatus) => (s === "완료" ? "g" : s === "미흡" ? "w" : s === "안함" ? "b" : "");
  return (
    <div className="eng-hw3-row">
      <span className="eng-hw3-l">{label}</span>
      <div className="eng-hw3-seg">
        {HW_STATUSES.map((s) => (
          <button key={s} className={"eas hw " + cls(s) + (value === s ? " on " + cls(s) : "")} onClick={() => onChange(value === s ? "" : s)}>{s}</button>
        ))}
      </div>
    </div>
  );
}

/* 오늘 시험 기록(여러 개) — 단어/문장 시험 등을 그 날짜로 여러 개 입력. 미통과는 재시(NP)로 표시.
   class_eng_test에 저장 → '테스트 기록' 탭과 같은 데이터. */
function DailyTests({ studentId, date }: { studentId: string; date: string }) {
  const [list, setList] = useState<EngTest[]>([]);
  const [name, setName] = useState("단어시험");
  const [score, setScore] = useState("");
  const [total, setTotal] = useState("");
  const reload = () => engApi.testsByDate(studentId, date).then(setList).catch(() => {});
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [studentId, date]);

  // 시험을 먼저 추가하고, 각 줄에서 통과/재시를 누르는 흐름(직관적).
  async function add() {
    if (!name.trim()) return;
    await engApi.saveTest({ studentId, date, name: name.trim(), score: Number(score) || 0, total: Number(total) || 100, result: "" });
    setScore(""); setTotal("");
    void reload();
  }
  async function setResult(t: EngTest, result: string) { await engApi.saveTest({ ...t, result: t.result === result ? "" : result }); void reload(); }
  async function remove(t: EngTest) { await engApi.removeTest(t.id); void reload(); }

  return (
    <div className="eng-field">
      <div className="eng-label">오늘 본 시험</div>
      <div className="test-add">
        <input className="input test-add-nm" value={name} onChange={(e) => setName(e.target.value)} placeholder="시험명 (예: 단어시험)" onKeyDown={(e) => e.key === "Enter" && add()} />
        <input className="input test-add-sc" inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value.replace(/[^0-9]/g, ""))} placeholder="점수" />
        <span className="test-add-slash">/</span>
        <input className="input test-add-sc" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value.replace(/[^0-9]/g, ""))} placeholder="만점" />
        <button className="btn primary sm" onClick={add} disabled={!name.trim()}>추가</button>
      </div>
      {list.length === 0 ? (
        <div className="eng-auto-hint">시험명을 적고 <b>추가</b>를 누른 뒤, 통과/재시를 표시하세요.</div>
      ) : (
        <div className="test-rows">
          {list.map((t) => (
            <div className="test-row" key={t.id}>
              <span className="test-row-nm">{t.name}</span>
              {(t.score || t.total) ? <span className="test-row-sc">{t.score}/{t.total}</span> : <span className="test-row-sc muted">—</span>}
              <div className="att-seg test-pf">
                <button className={t.result === "통과" ? "on t-green" : ""} onClick={() => setResult(t, "통과")}>통과</button>
                <button className={t.result === "재시" ? "on t-red" : ""} onClick={() => setResult(t, "재시")}>재시(NP)</button>
              </div>
              <button className="test-row-x" onClick={() => remove(t)} aria-label="삭제">✕</button>
            </div>
          ))}
        </div>
      )}
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
  async function setResult(t: EngTest, result: string) { await engApi.saveTest({ ...t, result: t.result === result ? "" : result }); void reload(); }

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
            <div className="sm-subj">
              <button className={"sm-subj-chip" + (t.result === "통과" ? " on" : "")} onClick={() => setResult(t, "통과")}>통과</button>
              <button className={"sm-subj-chip np" + (t.result === "재시" ? " on" : "")} onClick={() => setResult(t, "재시")}>재시(NP)</button>
            </div>
            <button className="btn ghost sm" onClick={() => remove(t)}>삭제</button>
          </div>
        ))}
        {list.length === 0 && <div className="hub-muted">테스트 기록이 없어요.</div>}
      </div>
    </div>
  );
}

/* ---------------- 출결 기록 (수학과 동일 카드형 · 출석/지각/결석 + 더보기 조퇴/무단결석 + 보강 플래그) ---------------- */
const ENG_ATT_MAIN: AttStatus[] = ["출석", "지각", "결석"];
const ENG_ATT_MORE: AttStatus[] = ["조퇴", "무단결석"];
const ENG_ATT_TONE: Record<string, string> = { 출석: "green", 지각: "orange", 결석: "red", 조퇴: "orange", 무단결석: "red" };

function EngAttendance({
  list, addable, daily, scheduledIds, slotTimeOf, onStatus, onMakeup, onPatch,
}: {
  list: RosterStudent[];
  addable: RosterStudent[];
  date: string;
  daily: Record<string, EngDaily>;
  scheduledIds: Set<string>;
  slotTimeOf: (s: RosterStudent) => string;
  getDaily: (sid: string) => EngDaily;
  onStatus: (sid: string, status: AttStatus) => void;
  onMakeup: (sid: string, on: boolean) => void;
  onPatch: (sid: string, patch: Partial<EngDaily>) => void;
}) {
  const cnt = (st: string) => list.filter((s) => daily[s.id]?.attStatus === st).length;
  const mkCnt = list.filter((s) => daily[s.id]?.makeup).length;
  // 키보드 단축키 — 현재 행에 1 출석·2 지각·3 결석, Enter/↓ 다음·↑ 이전. 줄별 '더보기'(조퇴/무단결석).
  const [cur, setCur] = useState(0);
  const [moreId, setMoreId] = useState<string | null>(null);
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
      <p className="eng-att-hint">키보드: <b>1</b> 출석 · <b>2</b> 지각 · <b>3</b> 결석 · <b>Enter/↓</b> 다음 · <b>↑</b> 이전 · 결석은 보강 관리로 연결돼요.</p>
      <div className="dash-kpis" style={{ gridTemplateColumns: "repeat(4,1fr)", maxWidth: 620, marginBottom: 14 }}>
        <div className="kpi"><div className="kpi-v">{cnt("출석") + cnt("지각") + cnt("조퇴")}<span className="kpi-u">명</span></div><div className="kpi-l">출석</div></div>
        <div className="kpi"><div className="kpi-v" style={{ color: "var(--warn)" }}>{cnt("지각")}<span className="kpi-u">명</span></div><div className="kpi-l">지각</div></div>
        <div className="kpi"><div className="kpi-v" style={{ color: "var(--bad)" }}>{cnt("결석") + cnt("무단결석")}<span className="kpi-u">명</span></div><div className="kpi-l">결석</div></div>
        <div className="kpi"><div className="kpi-v" style={{ color: "#8b5cf6" }}>{mkCnt}<span className="kpi-u">명</span></div><div className="kpi-l">보강</div></div>
      </div>
      <div>
        {list.map((s, i) => {
          const d = daily[s.id];
          const st = (d?.attStatus || "") as AttStatus;
          const mk = !!d?.makeup;
          const forced = !!st && ENG_ATT_MORE.includes(st);
          const open = forced || moreId === s.id;
          const missing = st === "결석" || st === "무단결석";
          return (
            <div key={s.id}>
              <div className={"att-row" + (missing ? " is-absent" : "") + (i === cur ? " cur" : "")} onClick={() => setCur(i)}>
                <div className="att-time">{scheduledIds.has(s.id) ? slotTimeOf(s) || "—" : "추가"}</div>
                <div className="att-stu">
                  <div>
                    <div style={{ fontWeight: 700 }}>{s.name}{mk && <span className="att-mk-badge">보강</span>}</div>
                  </div>
                </div>
                <div className="att-segwrap">
                  <div className="att-seg">
                    {ENG_ATT_MAIN.map((opt) => (
                      <button key={opt} className={st === opt ? "on t-" + ENG_ATT_TONE[opt] : ""} onClick={() => onStatus(s.id, st === opt ? "" : opt)}>{opt}</button>
                    ))}
                    {open && ENG_ATT_MORE.map((opt) => (
                      <button key={opt} className={st === opt ? "on t-" + ENG_ATT_TONE[opt] : ""} onClick={() => onStatus(s.id, st === opt ? "" : opt)}>{opt}</button>
                    ))}
                  </div>
                  {!forced && (
                    <button className="att-more" onClick={() => setMoreId(moreId === s.id ? null : s.id)}>{open ? "접기" : "⋯ 더보기"}</button>
                  )}
                  <button className={"att-mk" + (mk ? " on" : "")} onClick={() => onMakeup(s.id, !mk)} title="보강 수업 (출결은 남기되 포인트 미적립)">보강</button>
                </div>
              </div>
              {(st || mk) && (
                <EngAttExtra
                  status={st}
                  lateMin={d?.lateMin || 0}
                  attitude={d?.attitude || ""}
                  note={d?.note || ""}
                  absentReason={d?.absentReason || ""}
                  onPatch={(patch) => onPatch(s.id, patch)}
                />
              )}
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

/* 출결 한 줄 아래 인라인 입력 — 지각 분·수업태도·특이사항(·결석 사유). 텍스트는 blur 시 저장. */
function EngAttExtra({ status, lateMin, attitude, note, absentReason, onPatch }: { status: AttStatus; lateMin: number; attitude: string; note: string; absentReason: string; onPatch: (patch: Partial<EngDaily>) => void }) {
  const [noteV, setNoteV] = useState(note);
  const [reasonV, setReasonV] = useState(absentReason);
  useEffect(() => setNoteV(note), [note]);
  useEffect(() => setReasonV(absentReason), [absentReason]);
  return (
    <div className="att-extra">
      {status === "지각" && (
        <span className="att-extra-item">
          <span className="mini-label">지각</span>
          <input className="mini-num" type="number" min={0} step={5} placeholder="분" value={lateMin || ""} onChange={(e) => onPatch({ lateMin: +e.target.value || 0 })} />
          <span className="mini-label">분</span>
        </span>
      )}
      {(status === "결석" || status === "무단결석") && (
        <input className="mini-note" placeholder="결석 사유 (보강 관리에 연결)" value={reasonV} onChange={(e) => setReasonV(e.target.value)} onBlur={() => { if (reasonV !== absentReason) onPatch({ absentReason: reasonV }); }} />
      )}
      <span className="att-extra-item">
        <span className="mini-label">수업태도</span>
        <span className="mini-seg">
          {ENG_ATTITUDES.map((a) => (
            <button key={a} className={attitude === a ? "on" : ""} onClick={() => onPatch({ attitude: attitude === a ? "" : a })}>{a}</button>
          ))}
        </span>
      </span>
      <input className="mini-note" placeholder="특이사항 (선택)" value={noteV} onChange={(e) => setNoteV(e.target.value)} onBlur={() => { if (noteV !== note) onPatch({ note: noteV }); }} />
    </div>
  );
}

/* ---------------- 숙제 기록 (학생별 누적) ---------------- */
function EngHomework({ students }: { students: RosterStudent[] }) {
  const [sel, setSel] = useState("");
  const [list, setList] = useState<EngDaily[]>([]);
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const reload = () => { if (sel) engApi.dailyByStudent(sel).then(setList).catch(() => {}); };
  useEffect(() => { setList([]); setOpenMonths({}); reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sel]);

  const withHw = list.filter((d) => d.hwWord || d.hwReading || d.hwGrammar || d.wrongCheck || d.homework || d.hwChecked);
  const name = students.find((s) => s.id === sel)?.name || "";
  // 표 셀용 상태 배지(컴팩트).
  const hwCell = (s: HwStatus) =>
    s ? <span className={"eng-hwc " + (s === "완료" ? "g" : s === "미흡" ? "w" : s === "안함" ? "b" : "n")}>{s}</span> : <span className="eng-hwc-empty">·</span>;
  // 월별 그룹(최근 월 먼저), 월 안에서는 날짜 오름차순.
  const byMonth = new Map<string, EngDaily[]>();
  for (const d of withHw) {
    const ym = d.date.slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym)!.push(d);
  }
  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  for (const [, rows] of months) rows.sort((a, b) => (a.date < b.date ? -1 : 1));

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
              <div className="hub-muted">숙제 기록이 없어요. ‘오늘’에서 단어·리딩·문법 숙제를 입력하면 여기 누적됩니다.</div>
            ) : (
              <div className="eng-hwm-list">
                {months.map(([ym, rows], mi) => {
                  const [y, mo] = ym.split("-");
                  const open = openMonths[ym] ?? mi === 0; // 기본: 최신 월만 펼침
                  return (
                    <div className="eng-hwm" key={ym}>
                      <button className={"eng-hwm-h" + (open ? " open" : "")} onClick={() => setOpenMonths((m) => ({ ...m, [ym]: !open }))}>
                        <Icon name="chev" />{y}년 {Number(mo)}월 <span>{rows.length}회</span>
                      </button>
                      {open && (
                        <table className="eng-hwt">
                          <thead>
                            <tr><th>날짜</th><th>단어</th><th>리딩</th><th>문법</th><th>틀단</th><th>진행</th></tr>
                          </thead>
                          <tbody>
                            {rows.map((d) => {
                              const p = hwProgress(d);
                              return (
                                <tr key={d.date}>
                                  <td className="eng-hwt-date">{Number(mo)}/{Number(d.date.slice(8, 10))}</td>
                                  <td>{hwCell(d.hwWord)}</td>
                                  <td>{hwCell(d.hwReading)}</td>
                                  <td>{hwCell(d.hwGrammar)}</td>
                                  <td className="eng-hwt-chk">{d.wrongCheck ? "✓" : ""}</td>
                                  <td className="eng-hwt-prog">{p === null ? "" : p + "%"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
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
      window.alert("가져오기에 실패했어요. 잠시 후 다시 시도해 주세요.");
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

/* ---------------- 보강 관리 (수학 보강관리와 동일 레이아웃) ---------------- */
function EngMakeupPanel({ students }: { students: RosterStudent[] }) {
  const { openModal } = useStore();
  const ids = useMemo(() => new Set(students.map((s) => s.id)), [students]);
  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of students) m[s.id] = s.name;
    return m;
  }, [students]);
  const [list, setList] = useState<EngMakeup[]>([]);
  const [showArchive, setShowArchive] = useState(false);

  const reload = () => engApi.makeups().then((all) => setList(all.filter((mk) => ids.has(mk.studentId)))).catch(() => {});
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [students]);

  async function setStatus(mk: EngMakeup, status: string) {
    await engApi.saveMakeup({ ...mk, status });
    void reload();
  }
  async function remove(mk: EngMakeup) {
    if (!window.confirm("이 보강을 삭제할까요?")) return;
    await engApi.removeMakeup(mk.id);
    void reload();
  }
  function openForm(initial: EngMakeup | null) {
    openModal(<EngMakeupModal students={students} initial={initial} onSaved={reload} />);
  }

  const rowProps = (mk: EngMakeup) => ({ mk, name: nameOf[mk.studentId] || "(삭제된 학생)", onEdit: () => openForm(mk), onStatus: setStatus, onRemove: remove });
  // 보강일을 아직 안 정한 건 '대기'(상태 "대기" 또는 보강일 없음).
  const waiting = list.filter((m) => m.status === "대기" || !m.makeupDate);
  const activeAll = list.filter((m) => (m.status === "예정" || m.status === "완료") && m.makeupDate);
  const cancelled = list.filter((m) => m.status === "취소" && m.makeupDate);
  // 완료된 보강은 보강일이 7일 지나면 자동 '보관'(목록에서 접어둠). 예정은 항상 표시. 삭제 아님 — 보관함에서 펼쳐 볼 수 있음.
  const archiveCutoff = (() => { const d = new Date(TODAY); d.setDate(d.getDate() - 7); return ymd(d); })();
  const isArchived = (m: EngMakeup) => m.status === "완료" && !!m.makeupDate && m.makeupDate < archiveCutoff;
  const active = activeAll.filter((m) => !isArchived(m));
  const archived = activeAll.filter(isArchived);

  return (
    <div className="eng-makeup">
      <div className="mk-addbar">
        <button className="btn primary" onClick={() => openForm(null)}><Icon name="plus" />보강 등록</button>
      </div>

      <div className="mk-group">
        <div className="mk-grouphead">보강 대기 <span className="gcnt">{waiting.length}건</span></div>
        <div className="card">
          {waiting.length === 0 ? (
            <Empty>보강 일정을 잡을 항목이 없어요.</Empty>
          ) : (
            <div className="mk-list">{waiting.map((mk) => <EngMakeupRow key={mk.id} {...rowProps(mk)} />)}</div>
          )}
        </div>
      </div>

      <div className="mk-group">
        <div className="mk-grouphead">보강 예정 · 완료 <span className="gcnt">{active.length}건</span></div>
        <div className="card">
          {active.length === 0 ? (
            <Empty>예정·완료된 보강이 없어요.</Empty>
          ) : (
            <div className="mk-list">{active.map((mk) => <EngMakeupRow key={mk.id} {...rowProps(mk)} />)}</div>
          )}
        </div>
      </div>

      {cancelled.length > 0 && (
        <div className="mk-group">
          <div className="mk-grouphead">보강 미진행 <span className="gcnt">{cancelled.length}건</span></div>
          <div className="card">
            <div className="mk-list">{cancelled.map((mk) => <EngMakeupRow key={mk.id} {...rowProps(mk)} />)}</div>
          </div>
        </div>
      )}

      {archived.length > 0 && (
        <div className="mk-group">
          <button className="mk-archive-toggle" onClick={() => setShowArchive((v) => !v)} aria-expanded={showArchive}>
            <span className={"nav-caret" + (showArchive ? "" : " closed")}>▾</span>
            보관함 <span className="gcnt">{archived.length}건</span>
            <span className="mk-archive-hint">완료 후 7일 지난 보강 (자동 보관)</span>
          </button>
          {showArchive && (
            <div className="card">
              <div className="mk-list">{archived.map((mk) => <EngMakeupRow key={mk.id} {...rowProps(mk)} />)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EngMakeupRow({ mk, name, onEdit, onStatus, onRemove }: { mk: EngMakeup; name: string; onEdit: () => void; onStatus: (m: EngMakeup, s: string) => void; onRemove: (m: EngMakeup) => void }) {
  const waiting = mk.status === "대기" || !mk.makeupDate;
  const st = waiting ? "대기" : mk.status;
  const badge = st === "완료" ? "b-green" : st === "취소" ? "b-gray" : st === "대기" ? "b-orange" : "b-blue";
  const label = st === "완료" ? "보강 완료" : st === "취소" ? "보강 미진행" : st === "대기" ? "보강 대기" : "보강 예정";

  let meta: string;
  if (waiting) {
    meta = "결석 " + (mk.absentDate ? fmtMDDow(mk.absentDate) : "미정") + " · 보강일 미정";
  } else {
    meta = "보강 " + fmtMDDow(mk.makeupDate) + (mk.makeupTime ? " " + mk.makeupTime : "");
    if (mk.absentDate) meta += " · 결석 " + fmtMDDow(mk.absentDate);
  }

  return (
    <div className={"mk-item" + (waiting ? " pending" : "")}>
      <div className="mk-main">
        <div className="mk-name">{name} <span className={"badge " + badge}>{label}</span></div>
        <div className="mk-meta">
          <span>{meta}</span>
          {mk.memo && (<><span className="sep">·</span><span className="mk-memo">{mk.memo}</span></>)}
        </div>
      </div>
      <div className="mk-actions">
        {waiting ? (
          <button className="btn primary sm" onClick={onEdit}><Icon name="calplus" />보강 일정</button>
        ) : st === "예정" ? (
          <button className="btn primary sm" onClick={() => onStatus(mk, "완료")}><Icon name="check" />보강 완료</button>
        ) : (
          <button className="btn ghost sm" onClick={() => onStatus(mk, "예정")}><Icon name="undo" />{st === "완료" ? "완료 취소" : "예정으로"}</button>
        )}
        {!waiting && <button className="btn ghost sm" onClick={onEdit}><Icon name="edit" />수정</button>}
        {(waiting || st === "예정") && (
          <button className="btn ghost sm" onClick={() => onStatus(mk, "취소")}><Icon name="ban" />미진행</button>
        )}
        <button className="btn danger sm" onClick={() => onRemove(mk)}><Icon name="trash" /></button>
      </div>
    </div>
  );
}

function EngMakeupModal({ students, initial, onSaved }: { students: RosterStudent[]; initial: EngMakeup | null; onSaved: () => void }) {
  const { closeModal } = useStore();
  const [f, setF] = useState({
    studentId: initial?.studentId || "",
    absentDate: initial?.absentDate || todayStr(),
    makeupDate: initial?.makeupDate || "",
    makeupTime: initial?.makeupTime || "16:00",
    memo: initial?.memo || "",
  });
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!f.studentId || saving) return;
    // 보강일이 없으면 '대기', 정하면 '예정'. 이미 완료/취소면 그대로 둠.
    const status = !f.makeupDate ? "대기"
      : (!initial?.status || initial.status === "대기") ? "예정"
      : initial.status;
    setSaving(true);
    try {
      await engApi.saveMakeup({ ...(initial || {}), ...f, status });
      closeModal();
      onSaved();
    } catch { setSaving(false); }
  }
  return (
    <>
      <div className="modal-head">
        <div className="modal-title">{initial ? "보강 수정" : "보강 등록"}</div>
        <button className="modal-x" onClick={closeModal} aria-label="닫기"><Icon name="x" /></button>
      </div>
      <div className="modal-body">
        <label className="mk-flabel">학생</label>
        <select className="input" value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })}>
          <option value="">학생 선택</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="mk-form-grid">
          <div>
            <label className="mk-flabel">결석일</label>
            <DateField value={f.absentDate} onChange={(v) => setF({ ...f, absentDate: v })} placeholder="결석일" />
          </div>
          <div>
            <label className="mk-flabel">보강일 <span className="mk-flabel-opt">미정이면 대기</span></label>
            <DateField value={f.makeupDate} onChange={(v) => setF({ ...f, makeupDate: v })} placeholder="보강일" />
          </div>
          <div>
            <label className="mk-flabel">보강 시간</label>
            <input className="input" type="time" value={f.makeupTime} onChange={(e) => setF({ ...f, makeupTime: e.target.value })} />
          </div>
        </div>
        <label className="mk-flabel">메모 <span className="mk-flabel-opt">선택</span></label>
        <input className="input" value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="메모" />
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={closeModal}>취소</button>
        <button className="btn primary" onClick={save} disabled={!f.studentId || saving}>{saving ? "저장 중…" : "저장"}</button>
      </div>
    </>
  );
}

/* ---------------- 현황 대시보드 ---------------- */
function EngDashboard({ students, daily, band }: { students: RosterStudent[]; daily: Record<string, EngDaily>; band: Band }) {
  const { openModal } = useStore();
  const attended = students.filter((s) => daily[s.id]?.attended);
  const hwDone = attended.filter((s) => { const d = daily[s.id]; return d && (d.hwChecked || hwProgress(d) === 100); });
  const notYet = students.filter((s) => !daily[s.id]?.attended);
  const showHw = band !== "elem"; // 초등영어는 숙제 없음

  return (
    <div className="eng-dash">
      <div className="eng-stats">
        <Stat label="출석" value={`${attended.length}/${students.length}`} />
        {showHw && <Stat label="숙제 완료" value={`${hwDone.length}/${attended.length || 0}`} />}
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

      {/* 초등영어 학생별 오늘 현황 — 진도·단어시험·활동 한눈에(실시간) */}
      {!showHw && (
        <div className="eng-dash-sec">
          <h3>학생별 오늘 현황 <span className="eng-dash-hint">학생을 누르면 오늘 한 것을 자세히 볼 수 있어요</span></h3>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>학생</th><th>출석</th><th>원서 진도</th><th>단어시험</th><th>오늘 한 것</th></tr></thead>
              <tbody>
                {students.map((s) => {
                  const d = daily[s.id];
                  const att = d?.attStatus || (d?.attended ? "출석" : "");
                  return (
                    <tr key={s.id} className="tbl-click" onClick={() => openModal(<ElemDailyModal name={s.name} d={d} />)}>
                      <td className="t-name">{s.name}</td>
                      <td>{att ? <span className={"badge " + (att === "출석" ? "b-green" : att === "지각" ? "b-orange" : att === "결석" ? "b-gray" : "b-blue")}>{att}</span> : <span className="hub-muted">—</span>}</td>
                      <td>{d?.bookNo || <span className="hub-muted">—</span>}</td>
                      <td>{d?.wordTest || <span className="hub-muted">—</span>}</td>
                      <td>{d?.doneItems?.length ? <span className="badge b-blue">{d.doneItems.length}개</span> : <span className="hub-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* 초등영어 학생 오늘 상세 — '오늘 한 것' 항목까지 펼쳐 보기. */
function ElemDailyModal({ name, d }: { name: string; d?: EngDaily }) {
  const { closeModal } = useStore();
  const att = d?.attStatus || (d?.attended ? "출석" : "");
  return (
    <>
      <div className="modal-head">
        <div className="modal-title">{name} · 오늘 현황</div>
        <button className="modal-x" onClick={closeModal} aria-label="닫기"><Icon name="x" /></button>
      </div>
      <div className="modal-body">
        {!d ? (
          <div className="hub-muted">아직 오늘 기록이 없어요.</div>
        ) : (
          <div className="elem-detail">
            <div className="elem-detail-grid">
              <div className="elem-detail-cell"><span className="elem-detail-l">출석</span><span className="elem-detail-v">{att || "—"}</span></div>
              <div className="elem-detail-cell"><span className="elem-detail-l">원서 진도</span><span className="elem-detail-v">{d.bookNo || "—"}</span></div>
              <div className="elem-detail-cell"><span className="elem-detail-l">단어시험</span><span className="elem-detail-v">{d.wordTest || "—"}</span></div>
            </div>
            <div className="elem-detail-block">
              <span className="elem-detail-l">오늘 한 것</span>
              {d.doneItems?.length ? (
                <div className="elem-detail-chips">{d.doneItems.map((it, i) => <span className="badge b-blue" key={i}>{it}</span>)}</div>
              ) : <span className="hub-muted">기록 없음</span>}
            </div>
            {d.comment && (<div className="elem-detail-block"><span className="elem-detail-l">코멘트</span><p className="elem-detail-p">{d.comment}</p></div>)}
            {d.materials && (<div className="elem-detail-block"><span className="elem-detail-l">교재·자료</span><p className="elem-detail-p">{d.materials}</p></div>)}
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn primary" onClick={closeModal}>닫기</button>
      </div>
    </>
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
