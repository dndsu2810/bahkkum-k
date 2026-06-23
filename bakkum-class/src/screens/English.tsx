import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { getRoster, inEngBand, type RosterStudent } from "../lib/rosterApi";
import { engApi, hwProgress, naesinActiveOn, HW_STATUSES, POINT_REASONS, ENG_ATTITUDES, ELEM_LOG_ITEMS, type AttStatus, type EngDaily, type EngMakeup, type EngNaesin, type EngProgress, type EngTest, type Goal, type HwStatus } from "../lib/engApi";
import { eventsApi, type EventItem } from "../lib/hubApi";
import { MID_ENG_TIMETABLE } from "../lib/engTimetableSeed";
import { DOW, DOW_ORDER, TODAY, fmtMD, fmtMDDow, mondayOf, parseD, timeToMin, todayStr, ymd } from "../lib/dates";
import { holidayName } from "../lib/holidays";
import { loadCheckout, saveCheckout, pruneCheckout } from "../lib/checkoutState";
import { Select, Empty } from "../components/ui";
import { CopyMsgBtn, parentMakeupMsg, studentMakeupMsg } from "../components/MakeupList";
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
  bookNext: "",
  wordTest: "",
  doneItems: [],
  comment: "",
  hwComment: "",
  studentNote: "",
  materials: "",
  hwAssign: [],
  hwCheck: [],
  hwNone: false,
  testNone: false,
  updatedAt: 0,
});

/** 진도칩·요약에 보일 교재 표시 — 교재명 + 레벨(있으면). */
const engBookLabel = (book: string, level: string) => book.trim() + (level.trim() ? " " + level.trim() : "");

/** fromDate 다음의 첫 영어 수업 날짜(요일이 슬롯에 있는 날). 없으면 "". '다음 시간' 목표 이월용. */
function nextEngDate(slots: { day: string }[], fromDate: string): string {
  if (!slots.length) return "";
  for (let i = 1; i <= 14; i++) {
    const d = parseD(fromDate);
    d.setDate(d.getDate() + i);
    if (slots.some((sl) => sl.day === DOW[d.getDay()])) return ymd(d);
  }
  return "";
}

/** 영어 영역 — 초등(elem)/중고등(mid) band별. 학습일지 중심. */
export function English({ band, tab: initialTab }: { band: Band; tab?: Tab }) {
  const { user } = useAuth();
  const { toast, openModal } = useStore();
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
  // '오늘 한 것' 항목 추가 — 전체(모든 학생) 또는 개별(이 학생만). 입력 화면에서 바로 선택.
  async function addDoneItemForStudent(label: string, scope: "all" | "student" = "student") {
    const v = label.trim();
    if (!v) return;
    if (scope === "all") await engApi.saveDoneItem({ scope: "all", add: v }).catch(() => {});
    else { if (!sel) return; await engApi.saveDoneItem({ scope: "student", studentId: sel, add: v }).catch(() => {}); }
    loadDoneOptions(sel);
  }

  // 내신기간 모드 — 학생별 ON/기간. 중고등만. 켜진 기간엔 '오늘' 숙제가 자유입력+배부자료 기준으로 바뀐다.
  const [naesinMap, setNaesinMap] = useState<Record<string, EngNaesin>>({});
  const loadNaesin = () => engApi.naesin().then((list) => { const m: Record<string, EngNaesin> = {}; for (const r of list) m[r.studentId] = r; setNaesinMap(m); }).catch(() => {});
  useEffect(() => { if (band === "mid") void loadNaesin(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [band]);

  const students = useMemo(
    // 영어 수강 + 해당 밴드 + 재원(퇴원·휴원 제외).
    () => roster.filter((s) => s.subjects.includes("english") && inEngBand(s.englishBand, band) && s.status !== "퇴원" && s.status !== "휴원"),
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
          // 내용이 그대로면 상태를 바꾸지 않아 리렌더를 막는다(입력 중 화면이 튀지 않게).
          setDaily((cur) => (JSON.stringify(cur) === JSON.stringify(m) ? cur : m));
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
  // '다음 시간' 학습 목표 — 그 학생의 다음 수업 날짜 기록에 미리 넣어둔다(그날 '오늘 목표'로 보임).
  // 기존 기록을 읽어 합쳐 저장(다른 필드 덮어쓰기 방지).
  async function addNextGoal(sid: string, text: string) {
    const stu = students.find((s) => s.id === sid);
    const t = text.trim();
    if (!stu || !t) return;
    const nd = nextEngDate(stu.engSlots, date);
    if (!nd) { setErr("다음 수업 날짜를 찾지 못했어요. (시간표 확인)"); return; }
    try {
      const list = await engApi.dailyByStudent(sid);
      const rec = list.find((r) => r.date === nd) || blankDaily(sid, nd);
      await engApi.saveDaily({ ...rec, studentId: sid, date: nd, goals: [...(rec.goals || []), { text: t, done: false }] });
      toast(`${stu.name} · 다음 수업(${fmtMDDow(nd)})에 목표를 미리 넣었어요.`);
    } catch {
      setErr("다음 시간 목표 저장에 실패했어요.");
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
    cur: "오늘 뭐해요?",
    items: "오늘 한 것 수정",
    naesin: "내신모드",
  };
  // 부제는 '이 화면에서 무엇을 하는지'만 사람 말로. (내부 동작 설명 X)
  const DESC: Record<Tab, string> = {
    today: "오늘 등원한 학생의 목표·숙제·코멘트를 기록해요.",
    tt: "이번 주 수업 시간표를 봐요.",
    att: "오늘 등원/지각/결석을 표시해요. 결석은 보강 관리로 이어져요.",
    hw: "지난 숙제 검사와 오늘 내줄 숙제를 기록해요.",
    progress: "학생별 교재·진도를 기록해요.",
    test: "단어시험·테스트 점수를 기록해요.",
    makeup: "결석으로 생긴 보강 일정을 잡고 관리해요.",
    board: "이 반 학생들의 출결·진도·테스트 현황을 한눈에 봐요.",
    cur: "학생 화면에 보이는 '오늘 뭐해요?'(수업 내용)를 학생별로 수정해요.",
    items: "'오늘 한 것' 체크 항목을 추가·삭제해요. 모두에게 또는 특정 학생에게.",
    naesin: "내신기간 학생을 켜고 기간·학교·시험일을 정해요. 켜진 기간엔 '오늘' 숙제가 자유입력+배부자료 기준으로 바뀌어요.",
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
          이 반에 배정된 영어 학생이 없어요. <b>학생 명단</b>에서 학생에 영어 + {band === "elem" ? "초등" : "중고등"}을 지정해 주세요.
        </div>
      )}

      {tab === "board" ? (
        <EngDashboard
          students={students}
          daily={daily}
          band={band}
          date={date}
          todayList={todayList}
          scheduledIds={scheduledIds}
          setStatus={setStatus}
          getDaily={getDaily}
          saveDaily={saveDaily}
          doneOptions={doneOptions}
          reasonsAll={reasonsAll}
          onAddDoneItem={addDoneItemForStudent}
          onAddNextGoal={addNextGoal}
          examModeOf={(sid) => band === "mid" && naesinActiveOn(naesinMap[sid], date)}
        />
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
            {band === "mid" && tab !== "today" && (
              <button className="eng-rec-find" onClick={() => openModal(<StudentRecordPicker students={students} onPick={(s) => openModal(<StudentMonthlyModal studentId={s.id} name={s.name} naesin={naesinMap[s.id]} />)} />)}>
                <Icon name="chart" /> 다른 학생 기록 찾기
              </button>
            )}
            {(tab === "today" ? todayList : students).length === 0 && (
              <div className="eng-side-empty">
                {tab === "today"
                  ? "오늘 등원 예정 학생이 없어요. 아래 ‘추가 등원’으로 학생을 추가해 보세요."
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
                  {band === "mid" && (
                    <button className="eng-stu-rec" onClick={() => openModal(<StudentMonthlyModal studentId={s.id} name={s.name} naesin={naesinMap[s.id]} />)} title="누적 기록 보기 (자료·진도·시험)" aria-label="누적 기록"><Icon name="chart" /></button>
                  )}
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
                      ? "왼쪽에서 학생을 선택하면 그 학생의 '오늘 뭐해요?'를 수정할 수 있어요."
                      : "왼쪽에서 학생을 선택하면 테스트 점수를 기록할 수 있어요."}
              </div>
            ) : tab === "today" ? (
              <DailyEditor key={sel + date} student={nameOf[sel] || ""} band={band} value={getDaily(sel)} onSave={saveDaily} doneItemsAll={doneOptions} reasonsAll={reasonsAll} onAddDoneItem={addDoneItemForStudent} onAddNextGoal={addNextGoal} examMode={band === "mid" && naesinActiveOn(naesinMap[sel], date)} planNextDate={nextEngDate(students.find((s) => s.id === sel)?.engSlots || [], date)} />
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

/* ---------------- '오늘 한 것' 항목 관리 — 전체(모두) / 개별(학생 다중선택) 추가·삭제 ----------------
 *  - 대상: '모든 학생' 또는 '개별 학생'(여러 명 중복 선택).
 *  - 항목: 쉼표·줄바꿈으로 여러 개를 한 번에 추가. */
/** 입력 텍스트를 항목 배열로 — 쉼표·줄바꿈으로 나누고 공백/중복 제거. */
function parseItems(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const v = raw.trim();
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}
function DoneItemsManager({ students }: { students: RosterStudent[] }) {
  const [defaults, setDefaults] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [global, setGlobal] = useState<string[]>([]);
  const [scope, setScope] = useState<"all" | "student">("all");
  const [selected, setSelected] = useState<string[]>([]); // 개별 대상 학생들(다중)
  const [stuItems, setStuItems] = useState<Record<string, string[]>>({}); // 선택 학생별 항목
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const loadGlobal = () => engApi.doneItems().then((c) => { setDefaults(c.defaults); setHidden(c.hidden || []); setGlobal(c.global); }).catch(() => {});
  // 선택된 학생들의 항목을 한꺼번에 다시 읽어 맵으로.
  const loadSelected = async (ids: string[]) => {
    const entries = await Promise.all(ids.map((id) => engApi.doneItems(id).then((c) => [id, c.student] as const).catch(() => [id, []] as const)));
    setStuItems(Object.fromEntries(entries));
  };
  useEffect(() => { void loadGlobal(); }, []);
  useEffect(() => { if (scope === "student") void loadSelected(selected); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selected, scope]);

  const activeDefaults = defaults.filter((d) => !hidden.includes(d));
  async function removeFromAll(it: string) { await engApi.saveDoneItem({ scope: "all", remove: it }).catch(() => {}); void loadGlobal(); }
  async function restoreDefault(it: string) { await engApi.saveDoneItem({ scope: "all", add: it }).catch(() => {}); void loadGlobal(); }

  function toggleStudent(id: string) { setSelected((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]); }
  const allSelected = selected.length === students.length && students.length > 0;

  // 입력한 항목들을 선택 대상(모두 또는 선택 학생들)에 한 번에 추가.
  async function addItems() {
    const items = parseItems(text);
    if (!items.length || busy) return;
    if (scope === "student" && selected.length === 0) { setMsg("먼저 학생을 선택해 주세요."); return; }
    setBusy(true); setMsg("");
    try {
      if (scope === "all") {
        for (const it of items) await engApi.saveDoneItem({ scope: "all", add: it });
        await loadGlobal();
      } else {
        for (const sid of selected) for (const it of items) await engApi.saveDoneItem({ scope: "student", studentId: sid, add: it });
        await loadSelected(selected);
      }
      setText("");
      setMsg(`${items.length}개 항목을 추가했어요 ✓`);
    } catch { setMsg("추가에 실패했어요. 잠시 후 다시 시도해 주세요."); } finally { setBusy(false); }
  }
  // 선택 학생들 중 이 항목을 가진 모두에게서 삭제.
  async function removeFromSelected(it: string) {
    if (busy) return;
    setBusy(true);
    try {
      for (const sid of selected) if ((stuItems[sid] || []).includes(it)) await engApi.saveDoneItem({ scope: "student", studentId: sid, remove: it });
      await loadSelected(selected);
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  // 선택 학생들의 항목 합치기(몇 명에게 있는지 표시).
  const stuMerged = useMemo(() => {
    const m = new Map<string, number>();
    for (const sid of selected) for (const it of (stuItems[sid] || [])) m.set(it, (m.get(it) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [selected, stuItems]);

  return (
    <div className="di-wrap">
      <div className="mk-group">
        <div className="mk-grouphead">기본항목(모두) <span className="gcnt">{activeDefaults.length}개</span></div>
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
        <div className="mk-grouphead">항목 추가 <span className="gcnt">쉼표·줄바꿈으로 여러 개 한 번에</span></div>
        <div className="card" style={{ padding: 14 }}>
          {/* 대상 선택 — 전체 / 개별 */}
          <div className="di-scope">
            <button className={"sm-fchip" + (scope === "all" ? " on" : "")} onClick={() => setScope("all")}>모든 학생</button>
            <button className={"sm-fchip" + (scope === "student" ? " on" : "")} onClick={() => setScope("student")}>개별 학생</button>
          </div>

          {scope === "student" && (
            <div className="di-students">
              <div className="di-stu-tools">
                <button className="sm-fchip" onClick={() => setSelected(allSelected ? [] : students.map((s) => s.id))}>{allSelected ? "전체 해제" : "전체 선택"}</button>
                {selected.length > 0 && <span className="hub-muted">{selected.length}명 선택됨</span>}
              </div>
              <div className="di-chips">
                {students.map((s) => (
                  <button key={s.id} className={"di-chip di-pick" + (selected.includes(s.id) ? " on" : "")} onClick={() => toggleStudent(s.id)}>{s.name}</button>
                ))}
              </div>
            </div>
          )}

          {/* 항목 입력 — 여러 개 한 번에 */}
          <textarea
            className="input"
            style={{ marginTop: 10, minHeight: 64, resize: "vertical" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void addItems(); } }}
            placeholder={scope === "all" ? "모든 학생에게 추가할 항목 (예: 받아쓰기, 챈트, 일기)\n쉼표나 줄바꿈으로 여러 개를 한 번에 넣을 수 있어요." : "선택한 학생들에게 추가할 항목 (쉼표·줄바꿈으로 여러 개)"}
          />
          <div className="eng-add-row" style={{ marginTop: 8, alignItems: "center" }}>
            <button className="btn primary" onClick={addItems} disabled={busy || !parseItems(text).length || (scope === "student" && selected.length === 0)}>
              {busy ? "추가 중…" : scope === "all" ? "모두에게 추가" : `${selected.length || 0}명에게 추가`}
            </button>
            {msg && <span className="hub-muted">{msg}</span>}
          </div>
        </div>
      </div>

      {/* 현재 추가된 항목 — 대상에 따라 보기/삭제 */}
      <div className="mk-group">
        <div className="mk-grouphead">{scope === "all" ? "모두에게 추가된 항목" : "선택 학생에게 추가된 항목"} <span className="gcnt">{scope === "all" ? global.length : stuMerged.length}개</span></div>
        <div className="card" style={{ padding: 14 }}>
          {scope === "all" ? (
            global.length === 0 ? <div className="hub-muted">추가한 공통 항목이 없어요.</div> : (
              <div className="di-chips">{global.map((it) => <span key={it} className="di-chip">{it}<button className="di-x" onClick={() => removeFromAll(it)} title="삭제">×</button></span>)}</div>
            )
          ) : selected.length === 0 ? (
            <div className="hub-muted">위에서 학생을 선택하면 그 학생들에게만 보이는 항목을 추가·삭제할 수 있어요.</div>
          ) : stuMerged.length === 0 ? (
            <div className="hub-muted">선택한 학생에게 추가한 항목이 없어요.</div>
          ) : (
            <div className="di-chips">
              {stuMerged.map(([it, n]) => (
                <span key={it} className="di-chip">{it}{selected.length > 1 && <em className="di-cnt">{n}/{selected.length}</em>}<button className="di-x" onClick={() => removeFromSelected(it)} title="선택 학생에게서 삭제">×</button></span>
              ))}
            </div>
          )}
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
/** 토글은 켜졌지만 기간이 오늘을 벗어나 비활성일 때 사유. (활성이면 빈 문자열) */
function naesinOffReason(rec: EngNaesin, today: string): string {
  if (!rec.on || naesinActiveOn(rec, today)) return "";
  if (rec.endDate && today > rec.endDate) return "기간 지남 · 평소 모드";
  if (rec.startDate && today < rec.startDate) return "시작 전 · 평소 모드";
  return "평소 모드";
}

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
                    {!active && r.on && <span className="badge b-gray" title="시작·종료일이 오늘을 벗어나 평소 모드(단어·리딩·문법)로 보여요. 기간을 비우면 계속 내신모드예요.">{naesinOffReason(r, today)}</span>}
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
      <div className="eng-daily-h"><h2>{name} · 오늘 뭐해요?</h2></div>
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
function DailyEditor({ student, band, value, onSave, doneItemsAll, reasonsAll, onAddDoneItem, onAddNextGoal, examMode, compact, autoSave, planNextDate }: { student: string; band: Band; value: EngDaily; onSave: (d: EngDaily) => void; doneItemsAll: string[]; reasonsAll: { name: string; value: number }[]; onAddDoneItem: (label: string, scope?: "all" | "student") => void; onAddNextGoal?: (sid: string, text: string) => void; examMode?: boolean; compact?: boolean; autoSave?: boolean; planNextDate?: string }) {
  const showHw = band !== "elem"; // 초등영어는 숙제 없음
  const [d, setD] = useState<EngDaily>(value);
  const dirty = JSON.stringify(d) !== JSON.stringify(value);
  // 자동 저장(대시보드) — 입력이 멈추면 0.7초 뒤 저장. 별도 '저장' 버튼 없이 반영.
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  useEffect(() => {
    if (!autoSave || !dirty) return;
    const t = window.setTimeout(() => saveRef.current(d), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, autoSave, dirty]);
  // 포인트 자동 적립 미리보기(출결·숙제 + 카탈로그 점수). 저장 시 서버가 동일 규칙으로 확정.
  const autoPts = useMemo(() => autoPointsOf(d, catMapOf(reasonsAll)), [d, reasonsAll]);

  // 내신모드 자유 숙제 — 지난 회차 '내줄 숙제'를 이번 '숙제 검사'로 이어 보여주기 + 배부 자료 기준 숙제.
  const [hist, setHist] = useState<EngDaily[]>([]);
  const [newAssign, setNewAssign] = useState("");
  const [newCheck, setNewCheck] = useState("");
  useEffect(() => {
    if (!examMode) return;
    let alive = true;
    // 지난 '내줄 숙제' 이어보기(내신모드). 배부 자료는 서버가 학습목표·공유 숙제 목록에 자동 편입하므로 여기선 따로 불러오지 않음.
    engApi.dailyByStudent(value.studentId).then((l) => { if (alive) setHist(l); }).catch(() => {});
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
  // 검사할 숙제 직접 추가 — 상태는 비워둔다. 당일 추가해도 '검사 완료'로 잡히지 않고, 교사가 완료/미흡/안함을 눌러야 검사로 인정.
  function addCheck(text: string) { const v = text.trim(); if (!v || d.hwCheck.some((c) => c.text === v) || carried.includes(v)) return; setD({ ...d, hwCheck: [...d.hwCheck, { text: v, status: "" }] }); }
  function addAssign(text: string) { const v = text.trim(); if (!v || d.hwAssign.includes(v)) return; setD({ ...d, hwAssign: [...d.hwAssign, v] }); }
  function removeAssign(text: string) { setD({ ...d, hwAssign: d.hwAssign.filter((x) => x !== text) }); }
  // 내신모드 자유 숙제 칸 — 내신 기간이거나, 숙제 자료가 배부되어 검사/내줄 항목이 생기면 평소에도 표시.
  const showFreeHw = showHw && (examMode || d.hwAssign.length > 0 || d.hwCheck.length > 0);

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
  // 학습 목표 추가 — 적용시점 [오늘 / 다음시간]. 다음시간은 다음 수업 날짜 기록에 미리 넣는다.
  const [goalText, setGoalText] = useState("");
  const [goalWhen, setGoalWhen] = useState<"today" | "next">("today");
  function addGoal() {
    const t = goalText.trim();
    if (!t) return;
    if (goalWhen === "next" && onAddNextGoal) onAddNextGoal(d.studentId, t);
    else setGoals([...d.goals, { text: t, done: false }]);
    setGoalText("");
  }

  return (
    <div className={"eng-daily" + (compact ? " compact" : "")}>
      {!compact && (
        <div className="eng-daily-h">
          <h2>{student} · {d.date}</h2>
        </div>
      )}

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
          <input className="input" style={{ marginTop: 6 }} value={d.absentReason} onChange={(e) => setD({ ...d, absentReason: e.target.value })} placeholder="결석 사유 (보강 관리에 자동으로 연결돼요)" />
        )}
      </div>

      {/* 학습 목표 — 출결 바로 아래(펼치기 전에도 보이게). 학생도 체크 가능, 코멘트만 교사 전용. */}
      <div className="eng-field">
        <div className="eng-label">학습 목표</div>
        {d.goals.length === 0 && <div className="eng-auto-hint">아직 학습 목표가 없어요. 아래 ‘+ 목표 추가’로 넣어주세요.</div>}
        {d.goals.map((g, i) => (
          <div className="eng-goal" key={i}>
            <input type="checkbox" checked={g.done} onChange={(e) => setGoals(d.goals.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
            <input
              className="sm-input"
              value={g.text}
              onChange={(e) => setGoals(d.goals.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              placeholder="학습 내용"
            />
            <button className="eng-goal-x" onClick={() => setGoals(d.goals.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div className="eng-goal-add">
          <input className="sm-input" value={goalText} onChange={(e) => setGoalText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) addGoal(); }} placeholder="학습 내용" />
          {onAddNextGoal && (
            <div className="eng-goal-when">
              <button type="button" className={goalWhen === "today" ? "on" : ""} onClick={() => setGoalWhen("today")}>오늘</button>
              <button type="button" className={goalWhen === "next" ? "on" : ""} onClick={() => setGoalWhen("next")}>다음시간</button>
            </div>
          )}
          <button type="button" className="btn ghost sm" onClick={addGoal} disabled={!goalText.trim()}>추가</button>
        </div>
      </div>

      {!compact && (
        <div className="eng-field">
          <div className="eng-label">수업 태도</div>
          <div className="today-mood-seg">
            {ENG_ATTITUDES.map((a) => (
              <button key={a} className={d.attitude === a ? "on" : ""} onClick={() => setD({ ...d, attitude: d.attitude === a ? "" : a })}>{a}</button>
            ))}
          </div>
        </div>
      )}

      {!compact && (
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
      )}

      {/* 교재 · 진도 — 학생도 입력하는 칸. 내신모드(또는 이미 입력된 내용이 있으면) 선생님 화면에도 보여 학생 입력을 확인·수정한다. */}
      {showHw && (examMode || d.bookNo) && (
        <div className="eng-field">
          <div className="eng-label">교재 · 진도 <span className="eng-mk-tag soft">학생도 입력해요</span></div>
          <input className="input" value={d.bookNo} onChange={(e) => setD({ ...d, bookNo: e.target.value })} placeholder="예: 그래머인유즈 3과 p.40~45" />
        </div>
      )}

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

      {/* 자유 숙제 — 내신 기간이거나 숙제 자료가 배부되면 표시. 검사할 숙제(지난)·내줄 숙제(다음). */}
      {showFreeHw && (
        <>
          <div className="eng-field">
            <div className="eng-label eng-label-row">
              <span>숙제 검사 <span className="eng-mk-tag soft">지난 시간에 내준 것</span></span>
              <button type="button" className={"eng-none-btn" + (d.hwNone ? " on" : "")} onClick={() => setD({ ...d, hwNone: !d.hwNone })}>{d.hwNone ? "✓ 숙제 없음" : "숙제 없음"}</button>
            </div>
            {d.hwNone ? (
              <div className="eng-none-state">이번 시간은 <b>숙제 없음</b>으로 기록돼요. 다시 누르면 해제돼요.</div>
            ) : (
            <>
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
              <input className="sm-input" value={newCheck} onChange={(e) => setNewCheck(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && newCheck.trim()) { addCheck(newCheck); setNewCheck(""); } }} placeholder="검사할 숙제 직접 추가" />
              <button className="btn ghost sm" onClick={() => { if (newCheck.trim()) { addCheck(newCheck); setNewCheck(""); } }} disabled={!newCheck.trim()}>추가</button>
            </div>
            </>
            )}
          </div>

          <div className="eng-field">
            <div className="eng-label">내줄 숙제 <span className="eng-mk-tag soft">다음 시간</span></div>
            {d.hwAssign.length > 0 && (
              <div className="eng-hwchips">
                {d.hwAssign.map((t) => <span className="eng-hwchip" key={t}>{t}<button className="eng-hwchip-x" onClick={() => removeAssign(t)} aria-label="삭제">×</button></span>)}
              </div>
            )}
            <div className="eng-add-row" style={{ marginTop: 8 }}>
              <input className="sm-input" value={newAssign} onChange={(e) => setNewAssign(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { addAssign(newAssign); setNewAssign(""); } }} placeholder="다음 시간 낼 숙제 (예: 4과 그래머빌드업)" />
              <button className="btn ghost sm" onClick={() => { addAssign(newAssign); setNewAssign(""); }} disabled={!newAssign.trim()}>추가</button>
            </div>
          </div>
        </>
      )}


      {/* 숙제 코멘트 — 숙제 검사 아래. 수업 코멘트(맨 아래)와 별도. 학생도 읽음. */}
      {showHw && (
        <div className="eng-field">
          <div className="eng-label">숙제 코멘트 <span className="eng-mk-tag soft">학생에게 보여요</span></div>
          <textarea className="input" rows={2} value={d.hwComment} onChange={(e) => setD({ ...d, hwComment: e.target.value })} placeholder="숙제에 대한 코멘트 (학생이 읽어요)" />
        </div>
      )}

      {/* 중고등영어 진도 체크는 학습 목표와 중복이라 제거됨(오늘 한 것·다음에 할 것·단어시험).
          진도·교재는 '진도 기록' 탭, 단어 점수는 아래 '오늘 시험 기록'에서 입력해요. */}

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
                onClick={() => {
                  const v = window.prompt("추가할 '오늘 한 것' 항목 이름");
                  if (!v || !v.trim()) return;
                  const all = window.confirm("모든 학생에게 추가할까요?\n[확인] 모두에게  ·  [취소] 이 학생만");
                  onAddDoneItem(v.trim(), all ? "all" : "student");
                }}
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

      {/* 오늘 시험 기록 — 여러 개 입력 + 미통과 재시(NP) 표시 (class_eng_test에 저장, 테스트 기록 탭과 공유).
          중고등은 '다음 시간에 볼 시험'도 미리 예약(시험지 준비용). */}
      <DailyTests studentId={d.studentId} date={d.date} planNextDate={showHw ? planNextDate : undefined} testNone={d.testNone} onTestNone={(v) => setD({ ...d, testNone: v })} />

      <div className="eng-field">
        <div className="eng-label">특이사항</div>
        <input className="input" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="특이사항 (예: 컨디션·전달사항)" />
      </div>

      {d.studentNote.trim() && (
        <div className="eng-field">
          <div className="eng-label">학생이 남긴 글 <span className="eng-mk-tag soft">선생님께</span></div>
          <div className="eng-studentnote">{d.studentNote}</div>
        </div>
      )}

      <div className="eng-field">
        <div className="eng-label">수업 코멘트 <span className="eng-mk-tag soft">학생에게 보여요</span></div>
        <textarea className="input" rows={2} value={d.comment} onChange={(e) => setD({ ...d, comment: e.target.value })} placeholder="수업에 대한 코멘트 (선생님 작성 → 학생이 읽어요)" />
      </div>

      {autoSave ? (
        <div className="eng-autosave">{dirty ? "입력 중… 자동 저장돼요" : "자동 저장됨"}</div>
      ) : (
        <button className="btn primary" onClick={() => onSave(d)} disabled={!dirty}>{dirty ? "저장" : "저장됨"}</button>
      )}
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

/* 시험 한 줄 — 점수·만점을 인라인으로 바로 고칠 수 있게(예약 시험을 그날 채점할 때 유용).
   재시험(retakeOf)이면 '재시험' 배지 + 볼 날짜(오늘/다음시간/직접) 편집 줄을 함께 보여준다. */
function TestRow({ t, onScore, onResult, onRemove, nextDate, onDate }: { t: EngTest; onScore: (score: number, total: number) => void; onResult: (result: string) => void; onRemove: () => void; nextDate?: string; onDate?: (date: string) => void }) {
  const [score, setScore] = useState(String(t.score || ""));
  const [total, setTotal] = useState(String(t.total || ""));
  useEffect(() => { setScore(String(t.score || "")); setTotal(String(t.total || "")); }, [t.score, t.total]);
  const s = Number(score) || 0, tt = Number(total) || 0;
  const pct = tt > 0 ? Math.round((s / tt) * 100) : null;
  const commit = () => { if (s !== t.score || tt !== t.total) onScore(s, tt); };
  const isRetake = !!t.retakeOf;
  return (
    <div className={"test-row-wrap" + (isRetake ? " is-retake" : "")}>
      <div className="test-row">
        {isRetake && <span className="test-retake-badge">재시험</span>}
        <span className="test-row-nm">{t.name}</span>
        <span className="test-row-sc">
          <input className="input test-sc-in" inputMode="numeric" value={score} placeholder="점수" onChange={(e) => setScore(e.target.value.replace(/[^0-9]/g, ""))} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
          <span className="test-add-slash">/</span>
          <input className="input test-sc-in" inputMode="numeric" value={total} placeholder="만점" onChange={(e) => setTotal(e.target.value.replace(/[^0-9]/g, ""))} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
          {pct !== null && <b style={{ marginLeft: 5, color: "var(--brand-d)" }}>{pct}%</b>}
        </span>
        <div className="att-seg test-pf">
          <button className={t.result === "통과" ? "on t-green" : ""} onClick={() => onResult("통과")}>통과</button>
          <button className={t.result === "재시" ? "on t-red" : ""} onClick={() => onResult("재시")}>재시(NP)</button>
        </div>
        <button className="test-row-x" onClick={onRemove} aria-label="삭제">✕</button>
      </div>
      {isRetake && onDate && (
        <div className="test-retake-date">
          <span className="test-retake-l">볼 날짜</span>
          <button type="button" className={"test-date-chip" + (t.date === todayStr() ? " on" : "")} onClick={() => onDate(todayStr())}>오늘</button>
          {nextDate && nextDate !== todayStr() && (
            <button type="button" className={"test-date-chip" + (t.date === nextDate ? " on" : "")} onClick={() => onDate(nextDate)}>다음시간 ({fmtMDDow(nextDate)})</button>
          )}
          <DateField value={t.date} onChange={(v) => v && onDate(v)} />
        </div>
      )}
    </div>
  );
}

/* 오늘 시험 기록(여러 개) — 단어/문장 시험 등을 그 날짜로 여러 개 입력. 미통과는 재시(NP)로 표시.
   class_eng_test에 저장 → '테스트 기록' 탭과 같은 데이터.
   planNextDate가 있으면(중고등) 아래에 '다음 시간에 볼 시험'을 미리 등록하는 칸도 보여준다. */
export function DailyTests({ studentId, date, planNextDate, testNone, onTestNone }: { studentId: string; date: string; planNextDate?: string; testNone?: boolean; onTestNone?: (v: boolean) => void }) {
  const [list, setList] = useState<EngTest[]>([]);
  const [name, setName] = useState("단어시험");
  const [score, setScore] = useState("");
  const [total, setTotal] = useState("");
  const reload = () => engApi.testsByDate(studentId, date).then((l) => setList((cur) => (JSON.stringify(cur) === JSON.stringify(l) ? cur : l))).catch(() => {});
  // 강사·학생이 같은 시험을 공유 — 한쪽이 입력하면 다른 쪽에도 곧 반영되게 주기적·포커스 갱신.
  useEffect(() => {
    void reload();
    const iv = window.setInterval(() => void reload(), 15000);
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, date]);

  // 시험을 먼저 추가하고, 각 줄에서 점수·통과/재시를 적는 흐름(직관적).
  async function add() {
    if (!name.trim()) return;
    onTestNone?.(false); // 시험을 추가하면 '시험 없음' 해제
    await engApi.saveTest({ studentId, date, name: name.trim(), score: Number(score) || 0, total: Number(total) || 100, result: "" });
    setScore(""); setTotal("");
    void reload();
  }
  async function setScoreOf(t: EngTest, sc: number, tot: number) { await engApi.saveTest({ ...t, score: sc, total: tot }); void reload(); }
  async function setResult(t: EngTest, result: string) { await engApi.saveTest({ ...t, result: t.result === result ? "" : result }); void reload(); }
  async function setTestDate(t: EngTest, dt: string) { await engApi.saveTest({ ...t, date: dt }); void reload(); }
  async function remove(t: EngTest) { await engApi.removeTest(t.id); void reload(); }

  return (
    <>
      <div className="eng-field">
        <div className="eng-label eng-label-row">
          <span>오늘 본 시험</span>
          {onTestNone && list.length === 0 && (
            <button type="button" className={"eng-none-btn" + (testNone ? " on" : "")} onClick={() => onTestNone(!testNone)}>{testNone ? "✓ 시험 없음" : "시험 없음"}</button>
          )}
        </div>
        {testNone && list.length === 0 ? (
          <div className="eng-none-state">이번 시간은 <b>시험 없음</b>으로 기록돼요. 다시 누르면 해제돼요.</div>
        ) : (
          <>
            <div className="test-add">
              <input className="input test-add-nm" value={name} onChange={(e) => setName(e.target.value)} placeholder="시험명 (예: 단어시험)" onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()} />
              <input className="input test-add-sc" inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value.replace(/[^0-9]/g, ""))} placeholder="점수" />
              <span className="test-add-slash">/</span>
              <input className="input test-add-sc" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value.replace(/[^0-9]/g, ""))} placeholder="만점" />
              <button className="btn primary sm" onClick={add} disabled={!name.trim()}>추가</button>
            </div>
            {list.length === 0 ? (
              <div className="eng-auto-hint">시험명을 적고 <b>추가</b>를 누른 뒤, 점수·통과/재시를 적으세요.</div>
            ) : (
              <div className="test-rows">
                {list.map((t) => (
                  <TestRow key={t.id} t={t} onScore={(sc, tot) => setScoreOf(t, sc, tot)} onResult={(r) => setResult(t, r)} onRemove={() => remove(t)} nextDate={planNextDate} onDate={(dt) => setTestDate(t, dt)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {planNextDate !== undefined && <NextTestPlan studentId={studentId} nextDate={planNextDate} />}
    </>
  );
}

/* 다음 시간에 볼 시험 — 다음 수업 날짜 기록에 미리 등록(시험지 준비용). 그날이 되면 '오늘 본 시험'에 자동으로 떠서 점수를 채운다. */
function NextTestPlan({ studentId, nextDate }: { studentId: string; nextDate: string }) {
  const [list, setList] = useState<EngTest[]>([]);
  const [name, setName] = useState("");
  const reload = () => { if (nextDate) engApi.testsByDate(studentId, nextDate).then(setList).catch(() => {}); else setList([]); };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [studentId, nextDate]);
  async function add() { const nm = name.trim(); if (!nm || !nextDate) return; await engApi.saveTest({ studentId, date: nextDate, name: nm, score: 0, total: 0, result: "" }); setName(""); reload(); }
  async function remove(t: EngTest) { await engApi.removeTest(t.id); reload(); }
  return (
    <div className="eng-field">
      <div className="eng-label">다음 시간에 볼 시험 {nextDate ? <span className="eng-mk-tag soft">{fmtMDDow(nextDate)} 준비</span> : null}</div>
      {!nextDate ? (
        <div className="eng-auto-hint">다음 수업 일정이 없어 미리 등록할 수 없어요. (시간표 확인)</div>
      ) : (
        <>
          <div className="test-add">
            <input className="input test-add-nm" value={name} onChange={(e) => setName(e.target.value)} placeholder="다음 시간 볼 시험 (예: 5과 단어시험)" onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()} />
            <button className="btn primary sm" onClick={add} disabled={!name.trim()}>예약</button>
          </div>
          {list.length === 0 ? (
            <div className="eng-auto-hint">미리 등록해두면 시험지 준비에 쓰고, 그날 ‘오늘 본 시험’에 자동으로 떠요.</div>
          ) : (
            <div className="test-rows">
              {list.map((t) => (
                <div className="test-row" key={t.id}>
                  <span className="test-row-nm">{t.name}</span>
                  <span className="test-row-sc muted">예정</span>
                  <button className="test-row-x" onClick={() => remove(t)} aria-label="삭제">✕</button>
                </div>
              ))}
            </div>
          )}
        </>
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
  async function setDate(t: EngTest, dt: string) { await engApi.saveTest({ ...t, date: dt }); void reload(); }

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
          <div className={"eng-row" + (t.retakeOf ? " is-retake" : "")} key={t.id}>
            <div className="eng-row-main">
              {t.retakeOf && <span className="test-retake-badge">재시험</span>}
              <b>{t.name}</b>
              {t.retakeOf ? <DateField value={t.date} onChange={(v) => v && setDate(t, v)} /> : <span className="eng-lv">{t.date}</span>}
            </div>
            <span className="eng-score">{t.score}<span className="eng-total"> / {t.total}</span>{t.total > 0 ? <b style={{ marginLeft: 6, color: "var(--brand-d)" }}>{Math.round((t.score / t.total) * 100)}%</b> : null}</span>
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
              <div className="hub-muted">아직 숙제 기록이 없어요. ‘오늘’에서 단어·리딩·문법 숙제를 입력하면 여기에 쌓여요.</div>
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
          이 주에 표시할 영어 수업이 없어요. <b>학생 명단</b>에서 학생 프로필 → 영어 수업시간을 입력해 주세요.
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
            <div className="tt-leg" style={{ marginLeft: "auto", color: "var(--ink3)" }}>오늘은 파란색으로 표시돼요</div>
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
        {!waiting && <CopyMsgBtn label="학부모 문자" text={parentMakeupMsg(name, mk, "영어")} />}
        {!waiting && <CopyMsgBtn label="학생 문자" text={studentMakeupMsg(name, mk, "영어")} />}
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

/* 관제탑 카드 — 접으면 현황 요약, '자세히'로 펼치면 컴팩트 입력 편집기. */
function attTone(st: string): string {
  return st === "출석" ? "b-green" : st === "지각" || st === "조퇴" ? "b-orange" : st === "보강" ? "b-blue" : "b-gray";
}
function DashCard({
  s, daily, band, date, getDaily, saveDaily, doneOptions, reasonsAll, onAddDoneItem, onAddNextGoal, examMode, open, onToggleOpen, out, onToggleOut,
}: {
  s: RosterStudent;
  daily: Record<string, EngDaily>;
  band: Band;
  date: string;
  getDaily: (sid: string) => EngDaily;
  saveDaily: (d: EngDaily) => void;
  doneOptions: string[];
  reasonsAll: { name: string; value: number }[];
  onAddDoneItem: (label: string, scope?: "all" | "student") => void;
  onAddNextGoal?: (sid: string, text: string) => void;
  examMode: boolean;
  open: boolean;
  onToggleOpen: () => void;
  out: boolean;
  onToggleOut: () => void;
}) {
  const { openModal } = useStore();
  const d = daily[s.id];
  const st = d?.attStatus || (d?.attended ? "출석" : "");
  // 의미 있는 진행 상태 — 목표 수, 숙제검사 완/미완, 코멘트 완/미완.
  const goals = d?.goals?.length || 0;
  // 숙제검사 완료 판정 — 일반 모드(hwWord/Reading/Grammar) + 내신대비(hwCheck 항목마다 상태 지정됨)도 인정.
  const examHwOk = (d?.hwCheck?.length || 0) > 0 && (d?.hwCheck || []).every((c) => !!c.status);
  const hwOk = !!d?.hwChecked || [d?.hwWord, d?.hwReading, d?.hwGrammar].some((x) => x === "완료") || examHwOk;
  // 코멘트 — 수업 코멘트 또는 숙제 코멘트(내신대비) 중 하나라도 있으면 완료.
  const hasComment = !!(d?.comment && d.comment.trim()) || !!(d?.hwComment && d.hwComment.trim());
  // 진행중 영어 교재(진도·교재관리) — 영어 화면이므로 영어 진도만 보여준다(수학과 섞지 않음).
  const [progBooks, setProgBooks] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    engApi.progress(s.id).then((list) => { if (alive) setProgBooks([...new Set(list.filter((p) => p.status === "진행" && p.book.trim()).map((p) => engBookLabel(p.book, p.level)))]); }).catch(() => {});
    return () => { alive = false; };
  }, [s.id]);
  return (
    <div id={"engcard-" + s.id} className={"eng-dash-card" + (open ? " open" : "") + (out ? " out" : "")}>
      {/* 상단 — 현재 진행상황 요약(항상 보임) */}
      <div className="eng-dash-sum">
        <span className="eng-dash-sum-name">{s.name}</span>
        <button className="eng-dash-rec" onClick={() => openModal(<StudentMonthlyModal studentId={s.id} name={s.name} />)} title="누적 기록 보기 (자료·진도·시험)" aria-label="누적 기록"><Icon name="chart" /></button>
        <span className="eng-dash-sum-tags">
          {out && <span className="badge b-gray">하원</span>}
          {st ? <span className={"badge " + attTone(st)}>{st}{st === "지각" && d?.lateMin ? ` ${d.lateMin}분` : ""}</span> : null}
          {progBooks.length > 0 && <span className="eng-sum-chip" title="진도·교재관리 진행중 교재">교재 {progBooks.join(", ")}</span>}
          {goals > 0 && <span className="eng-sum-chip">목표 {goals}</span>}
          {band !== "elem" && <span className={"eng-sum-chip" + (hwOk ? " ok" : " todo")}>숙제검사 {hwOk ? "완료" : "미완"}</span>}
          <span className={"eng-sum-chip" + (hasComment ? " ok" : " todo")}>코멘트 {hasComment ? "완료" : "미완"}</span>
        </span>
        <button className={"eng-dash-out" + (out ? " on" : "")} onClick={onToggleOut} title={out ? "다시 등원으로 (맨 위로)" : "하원 — 카드를 맨 아래로 접어요"}>{out ? "등원" : "하원"}</button>
      </div>
      {/* 아래 — 접혀 있을 땐 블러로 살짝 보이고, 펼치면 입력(자동 저장) */}
      <div className={"eng-dash-peek" + (open ? " open" : "")}>
        <DailyEditor student={s.name} band={band} value={getDaily(s.id)} onSave={saveDaily} doneItemsAll={doneOptions} reasonsAll={reasonsAll} onAddDoneItem={onAddDoneItem} onAddNextGoal={onAddNextGoal} examMode={examMode} compact autoSave key={s.id} planNextDate={nextEngDate(s.engSlots, date)} />
      </div>
      <button className="eng-dash-more" onClick={onToggleOpen} aria-expanded={open}>
        {open ? "접기" : "자세히 보기 / 입력하기"}
      </button>
    </div>
  );
}

/** 오늘 뭔가 입력된 학생인지(출결·진도·단어시험·활동·코멘트·특이사항 중 하나라도). */
function hasInput(d?: EngDaily): boolean {
  if (!d) return false;
  return !!(d.attStatus || d.attended || d.bookNo || (d.doneItems && d.doneItems.length) || d.wordTest || (d.note && d.note.trim()) || (d.comment && d.comment.trim()));
}

/* 중고등 — '오늘 등원' 선택 + 등원한 학생만 카드로 입력. */
function EngInputDash({ students, daily, band, date, scheduledIds, setStatus, getDaily, saveDaily, doneOptions, reasonsAll, onAddDoneItem, onAddNextGoal, examModeOf }: {
  students: RosterStudent[]; daily: Record<string, EngDaily>; band: Band; date: string;
  scheduledIds: Set<string>; setStatus: (sid: string, status: AttStatus) => void;
  getDaily: (sid: string) => EngDaily; saveDaily: (d: EngDaily) => void;
  doneOptions: string[]; reasonsAll: { name: string; value: number }[];
  onAddDoneItem: (label: string, scope?: "all" | "student") => void; onAddNextGoal?: (sid: string, text: string) => void; examModeOf?: (sid: string) => boolean;
}) {
  const [q, setQ] = useState("");
  // 카드 펼침(자세히 보기) 제어 — 칩을 누르면 그 학생 카드를 펼치고 그 위치로 스크롤한다.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  // 하원한 학생 — 카드를 맨 아래로 내리고 접는다. 새로고침해도 그날 분은 유지(날짜별 localStorage).
  const outScope = "eng-" + band;
  const [outIds, setOutIds] = useState<Set<string>>(() => loadCheckout(outScope, date));
  useEffect(() => { setOutIds(loadCheckout(outScope, date)); }, [outScope, date]); // 날짜/밴드 바뀌면 그날 하원 상태로 교체
  useEffect(() => { pruneCheckout(todayStr()); }, []); // 오래된 날짜 키 정리
  const toggleOpen = (id: string) => setOpenIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleOut = (id: string) => {
    const willOut = !outIds.has(id);
    const next = new Set(outIds); willOut ? next.add(id) : next.delete(id);
    setOutIds(next);
    saveCheckout(outScope, date, next);
    if (willOut) setOpenIds((p) => { const n = new Set(p); n.delete(id); return n; }); // 하원하면 접기
  };
  const focusCard = (id: string) => {
    setOpenIds((p) => new Set(p).add(id)); // 그 학생 입력란을 펼치고
    window.setTimeout(() => document.getElementById("engcard-" + id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const attended = students.filter((s) => daily[s.id]?.attended);
  const attSet = new Set(attended.map((s) => s.id));
  // 하원 학생은 맨 아래로(안정 정렬).
  const ordered = [...attended].sort((a, b) => (outIds.has(a.id) ? 1 : 0) - (outIds.has(b.id) ? 1 : 0));
  const candidates = students.filter((s) => scheduledIds.has(s.id) && !attSet.has(s.id));
  const hits = q.trim() ? students.filter((s) => !attSet.has(s.id) && s.name.includes(q.trim())).slice(0, 24) : [];
  const markIn = (sid: string) => { setStatus(sid, "출석"); setQ(""); };
  const markOut = (sid: string) => { void saveDaily({ ...getDaily(sid), attStatus: "", attended: false, lateMin: 0 }); const next = new Set(outIds); next.delete(sid); setOutIds(next); saveCheckout(outScope, date, next); };
  return (
    <div className="eng-dash">
      <div className="eng-dash-sec">
        <div className="eng-in-head">
          <h3>오늘 등원 <span className="eng-in-cnt">{attended.length}명</span></h3>
        </div>
        {attended.length > 0 && (
          <div className="eng-chiprow" style={{ marginBottom: 10 }}>
            {ordered.map((s) => (
              <span className={"eng-in-chip" + (outIds.has(s.id) ? " out" : "")} key={s.id}>
                <button type="button" className="eng-in-nm" onClick={() => focusCard(s.id)} title="이 학생 입력란으로 이동">{s.name}</button>
                <button className="eng-in-x" onClick={() => markOut(s.id)} aria-label="등원 취소" title="등원 취소 (실수로 등원 처리했을 때)">×</button>
              </span>
            ))}
          </div>
        )}
        {/* 등원 후보 — 항상 열려 있음. 예정 학생(또는 검색한 추가 등원)을 누르면 등원 처리. */}
        <div className="eng-in-pick">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 검색 — 예정에 없는 추가 등원도 넣을 수 있어요" />
          <div className="eng-chiprow" style={{ marginTop: 8 }}>
            {(q.trim() ? hits : candidates).map((s) => (
              <button className="eng-pt" key={s.id} onClick={() => markIn(s.id)}>{s.name} +</button>
            ))}
            {(q.trim() ? hits : candidates).length === 0 && (
              <span className="hub-muted">{q.trim() ? "검색 결과가 없어요." : "오늘 등원 예정 학생이 모두 등원했어요. 검색해서 추가 등원을 넣을 수 있어요."}</span>
            )}
          </div>
        </div>
      </div>
      {attended.length > 0 && (
        <div className="eng-dash-cards">
          {ordered.map((s) => (
            <DashCard key={s.id} s={s} daily={daily} band={band} date={date} getDaily={getDaily} saveDaily={saveDaily} doneOptions={doneOptions} reasonsAll={reasonsAll} onAddDoneItem={onAddDoneItem} onAddNextGoal={onAddNextGoal} examMode={examModeOf ? examModeOf(s.id) : false} open={openIds.has(s.id)} onToggleOpen={() => toggleOpen(s.id)} out={outIds.has(s.id)} onToggleOut={() => toggleOut(s.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- 현황 대시보드 ---------------- */
function EngDashboard({
  students,
  daily,
  band,
  date,
  todayList,
  scheduledIds,
  setStatus,
  getDaily,
  saveDaily,
  doneOptions,
  reasonsAll,
  onAddDoneItem,
  onAddNextGoal,
  examModeOf,
}: {
  students: RosterStudent[];
  daily: Record<string, EngDaily>;
  band: Band;
  date: string;
  todayList?: RosterStudent[];
  scheduledIds?: Set<string>;
  setStatus?: (sid: string, status: AttStatus) => void;
  getDaily?: (sid: string) => EngDaily;
  saveDaily?: (d: EngDaily) => void;
  doneOptions?: string[];
  reasonsAll?: { name: string; value: number }[];
  onAddDoneItem?: (s: string) => void;
  onAddNextGoal?: (sid: string, text: string) => void;
  examModeOf?: (sid: string) => boolean;
}) {
  const { openModal } = useStore();
  // 초등·중고등 모두 같은 카드형 대시보드를 쓴다(입력 항목만 DailyEditor가 band로 달리 보여줌).
  const canInputCards = !!todayList && !!getDaily && !!saveDaily && !!setStatus;

  // 진행중 교재(진도·교재관리) — 학생별 맵. 초등 대시보드 표/상세에 교재명 표시(중고등은 DashCard에서 따로).
  const [booksByStudent, setBooksByStudent] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (band !== "elem") return;
    let alive = true;
    engApi.progressAll().then((list) => {
      if (!alive) return;
      const m: Record<string, string[]> = {};
      for (const p of list) {
        const book = p.book.trim();
        if (p.status !== "진행" || !book) continue;
        (m[p.studentId] ||= []);
        if (!m[p.studentId].includes(book)) m[p.studentId].push(book);
      }
      setBooksByStudent(m);
    }).catch(() => {});
    return () => { alive = false; };
  }, [band]);

  // 중고등 — '오늘 등원' 선택 + 등원 학생만 카드.
  if (canInputCards) {
    return (
      <EngInputDash
        students={students}
        daily={daily}
        band={band}
        date={date}
        scheduledIds={scheduledIds || new Set()}
        setStatus={setStatus!}
        getDaily={getDaily!}
        saveDaily={saveDaily!}
        doneOptions={doneOptions || []}
        reasonsAll={reasonsAll || []}
        onAddDoneItem={onAddDoneItem || (() => {})}
        onAddNextGoal={onAddNextGoal}
        examModeOf={examModeOf}
      />
    );
  }

  // 초등 — 오늘 등원해야 하는 학생 기준 통계 + '뭔가 입력된' 학생만 표.
  const base = todayList && todayList.length ? todayList : students;
  const attended = base.filter((s) => daily[s.id]?.attended);
  const notYet = base.filter((s) => !daily[s.id]?.attended);
  const inputRows = students.filter((s) => hasInput(daily[s.id]));
  return (
    <div className="eng-dash">
      <div className="eng-stats">
        <Stat label="출석" value={`${attended.length}/${base.length}`} />
        <Stat label="미출석" value={String(notYet.length)} tone="warn" />
      </div>
      <div className="eng-dash-sec">
        <h3>오늘 미출석 <span className="eng-dash-hint">오늘 등원 예정 학생 기준</span></h3>
        <div className="eng-chiprow">
          {notYet.length === 0 ? <span className="hub-muted">없음</span> : notYet.map((s) => <span className="eng-chip" key={s.id}>{s.name}</span>)}
        </div>
      </div>
      <div className="eng-dash-sec">
        <h3>출석 학생</h3>
        <div className="eng-chiprow">
          {attended.length === 0 ? <span className="hub-muted">아직 없음</span> : attended.map((s) => (
            <span className="eng-chip ok" key={s.id}>{s.name}</span>
          ))}
        </div>
      </div>
      <div className="eng-dash-sec">
        <h3>학생별 오늘 현황 <span className="eng-dash-hint">기록이 있는 학생만 보여요 · 누르면 자세히</span></h3>
        {inputRows.length === 0 ? (
          <span className="hub-muted">아직 입력된 학생이 없어요.</span>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>학생</th><th>출석</th><th>교재</th><th>원서 진도</th><th>단어시험</th><th>오늘 한 것</th></tr></thead>
              <tbody>
                {inputRows.map((s) => {
                  const d = daily[s.id];
                  const att = d?.attStatus || (d?.attended ? "출석" : "");
                  const books = booksByStudent[s.id] || [];
                  return (
                    <tr key={s.id} className="tbl-click" onClick={() => openModal(<ElemDailyModal name={s.name} d={d} books={books} />)}>
                      <td className="t-name">{s.name}</td>
                      <td>{att ? <span className={"badge " + attTone(att)}>{att}</span> : <span className="hub-muted">—</span>}</td>
                      <td>{books.length ? books.join(", ") : <span className="hub-muted">—</span>}</td>
                      <td>{d?.bookNo || <span className="hub-muted">—</span>}</td>
                      <td>{d?.wordTest || <span className="hub-muted">—</span>}</td>
                      <td>{d?.doneItems?.length ? <span className="badge b-blue">{d.doneItems.length}개</span> : <span className="hub-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* 초등영어 학생 오늘 상세 — '오늘 한 것' 항목까지 펼쳐 보기. */
function ElemDailyModal({ name, d, books = [] }: { name: string; d?: EngDaily; books?: string[] }) {
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
              <div className="elem-detail-cell"><span className="elem-detail-l">교재</span><span className="elem-detail-v">{books.length ? books.join(", ") : "—"}</span></div>
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
/* 학생 월별 누적 기록 — 출결·숙제·시험·포인트·학습목표 집계 + 날짜별 표. 중고등영어 학생 클릭 시. */
// 전체 학생 중에서 골라 누적 기록 열기(오늘 안 온 학생도).
function StudentRecordPicker({ students, onPick }: { students: RosterStudent[]; onPick: (s: RosterStudent) => void }) {
  const { closeModal } = useStore();
  const [q, setQ] = useState("");
  const list = students.filter((s) => !q.trim() || s.name.includes(q.trim()));
  return (
    <>
      <div className="modal-head">
        <div className="modal-title">학생 기록 찾기</div>
        <button className="modal-x" onClick={closeModal} aria-label="닫기"><Icon name="x" /></button>
      </div>
      <div className="modal-body">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 이름 검색" autoFocus />
        <div className="eng-rec-list">
          {list.length === 0 ? <div className="hub-muted" style={{ padding: 10 }}>학생이 없어요.</div> : list.map((s) => (
            <button key={s.id} className="eng-rec-row" onClick={() => onPick(s)}><span>{s.name}</span><Icon name="chart" /></button>
          ))}
        </div>
      </div>
      <div className="modal-foot"><button className="btn ghost" onClick={closeModal}>닫기</button></div>
    </>
  );
}
function StudentMonthlyModal({ studentId, name, naesin }: { studentId: string; name: string; naesin?: EngNaesin }) {
  const { closeModal } = useStore();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [daily, setDaily] = useState<EngDaily[]>([]);
  const [tests, setTests] = useState<EngTest[]>([]);
  const [period, setPeriod] = useState("");
  const [exporting, setExporting] = useState(false);
  const [naesinRec, setNaesinRec] = useState<EngNaesin | undefined>(naesin);
  useEffect(() => { engApi.naesin().then((l) => setNaesinRec(l.find((r) => r.studentId === studentId))).catch(() => {}); }, [studentId]);
  // 열려 있는 동안 조용히 주기적 갱신 — 로딩 표시·스크롤 초기화 없이 데이터만 제자리 갱신(화면이 튀지 않게).
  useEffect(() => {
    const load = () => {
      engApi.dailyByStudent(studentId).then((l) => setDaily((cur) => (JSON.stringify(cur) === JSON.stringify(l) ? cur : l))).catch(() => {});
      engApi.tests(studentId).then((l) => setTests((cur) => (JSON.stringify(cur) === JSON.stringify(l) ? cur : l))).catch(() => {});
    };
    load();
    const iv = window.setInterval(load, 15000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, [studentId]);
  const months = useMemo(
    () => [...new Set([...daily.map((d) => d.date.slice(0, 7)), ...tests.map((t) => t.date.slice(0, 7))])].filter(Boolean).sort().reverse(),
    [daily, tests]
  );
  const fmtMonth = (ym: string) => { const [y, m] = ym.split("-"); return `${y}년 ${Number(m)}월`; };
  // 기간 선택 — 내신기간(설정돼 있으면)을 첫 칩으로, 그다음 월별.
  const naesinRange = naesinRec?.on && naesinRec.startDate ? { from: naesinRec.startDate, to: naesinRec.endDate || "9999-12-31" } : null;
  const periods = [...(naesinRange ? [{ key: "naesin", label: "내신기간" }] : []), ...months.map((ym) => ({ key: ym, label: fmtMonth(ym) }))];
  useEffect(() => { if (periods.length && !periods.some((p) => p.key === period)) setPeriod(periods[0].key); }, [periods, period]);
  const inPeriod = (date: string) => (period === "naesin" ? !!naesinRange && date >= naesinRange.from && date <= naesinRange.to : date.slice(0, 7) === period);
  const mDaily = useMemo(() => daily.filter((d) => inPeriod(d.date)).sort((a, b) => (a.date < b.date ? -1 : 1)), [daily, period, naesinRec]);
  const mTests = useMemo(() => tests.filter((t) => inPeriod(t.date)).sort((a, b) => (a.date < b.date ? -1 : 1)), [tests, period, naesinRec]);
  const attDays = mDaily.filter((d) => d.attStatus).length;
  const present = mDaily.filter((d) => ["출석", "지각", "조퇴"].includes(d.attStatus)).length;
  const lateN = mDaily.filter((d) => d.attStatus === "지각").length;
  const absentN = mDaily.filter((d) => ["결석", "무단결석"].includes(d.attStatus)).length;
  const points = mDaily.reduce((n, d) => n + (d.points || 0), 0);
  const goalsTotal = mDaily.reduce((n, d) => n + (d.goals?.length || 0), 0);
  const goalsDone = mDaily.reduce((n, d) => n + (d.goals?.filter((g) => g.done).length || 0), 0);
  const cnt = (f: "hwWord" | "hwReading" | "hwGrammar", v: HwStatus) => mDaily.filter((d) => d[f] === v).length;
  const hwLine = (label: string, f: "hwWord" | "hwReading" | "hwGrammar") => `${label} · 완료 ${cnt(f, "완료")} / 미흡 ${cnt(f, "미흡")} / 안함 ${cnt(f, "안함")}`;
  const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const periodLabel = periods.find((p) => p.key === period)?.label || "";
  async function exportImage(print: boolean) {
    const el = bodyRef.current; if (!el) return;
    setExporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2 });
      if (print) {
        const w = window.open("", "_blank"); if (!w) return;
        w.document.write(`<img src="${canvas.toDataURL("image/png")}" style="width:100%" onload="setTimeout(()=>{print()},200)" />`);
        w.document.close();
      } else {
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = `${name}_${periodLabel || "기록"}.png`;
        a.click();
      }
    } catch { alert("내보내기에 실패했어요."); }
    finally { setExporting(false); }
  }
  return (
    <>
      <div className="modal-head">
        <div className="modal-title">{name} · 누적 기록</div>
        <button className="modal-x" onClick={closeModal} aria-label="닫기"><Icon name="x" /></button>
      </div>
      <div className="modal-body" ref={bodyRef}>
        {periods.length === 0 ? (
          <div className="hub-muted">아직 기록이 없어요.</div>
        ) : (
          <>
            <div className="sm-months">
              {periods.map((p) => (
                <button key={p.key} className={"sm-month" + (p.key === period ? " on" : "") + (p.key === "naesin" ? " naesin" : "")} onClick={() => setPeriod(p.key)}>{p.label}</button>
              ))}
            </div>
            <div className="smm-stats">
              <div className="smm-stat"><span>출석</span><b>{present}<em>/{attDays}일</em></b></div>
              <div className="smm-stat"><span>지각</span><b>{lateN}</b></div>
              <div className="smm-stat"><span>결석</span><b>{absentN}</b></div>
              <div className="smm-stat"><span>포인트</span><b>{points}</b></div>
              <div className="smm-stat"><span>학습목표</span><b>{goalsDone}<em>/{goalsTotal}</em></b></div>
            </div>
            <div className="smm-block">
              <div className="smm-block-h">숙제</div>
              <div className="smm-hw"><div>{hwLine("단어", "hwWord")}</div><div>{hwLine("리딩", "hwReading")}</div><div>{hwLine("문법", "hwGrammar")}</div></div>
            </div>
            <div className="smm-block">
              <div className="smm-block-h">시험{mTests.length > 0 ? ` · ${mTests.length}회` : ""}</div>
              {mTests.length === 0 ? <div className="hub-muted">시험 기록 없음</div> : (
                <div className="smm-tests">
                  {mTests.map((t) => (
                    <div className="smm-test" key={t.id}>
                      <span className="smm-test-d">{md(t.date)}</span>
                      <span className="smm-test-nm">{t.name}</span>
                      <span className="smm-test-sc">{t.score}/{t.total}{t.total > 0 ? ` ${Math.round((t.score / t.total) * 100)}%` : ""}</span>
                      {t.result && <span className={"badge " + (t.result === "통과" ? "b-green" : "b-orange")}>{t.result}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="smm-block">
              <div className="smm-block-h">자료·진도·시험 흐름 <span className="smm-flow-hint">최근 순 · 다음 진도 정할 때 참고</span></div>
              {(() => {
                const byDate: Record<string, EngTest[]> = {};
                for (const t of mTests) (byDate[t.date] ||= []).push(t);
                const flow = [...mDaily].sort((a, b) => (a.date < b.date ? 1 : -1)).filter((d) => {
                  const hw = d.hwAssign?.length ? d.hwAssign.join(", ") : d.homework;
                  return d.bookNo || (d.doneItems?.length) || d.materials || hw || (d.goals?.length) || (d.hwCheck?.length) || (byDate[d.date]?.length);
                });
                if (flow.length === 0) return <div className="hub-muted">기록 없음</div>;
                return (
                  <div className="smm-flow">
                    {flow.map((d) => {
                      const prog = [d.bookNo, ...(d.doneItems || [])].filter(Boolean).join(", ");
                      const goals = (d.goals || []).map((g) => g.text).filter(Boolean).join(", ");
                      // 검사한 숙제(내신모드) — 항목+상태. '숙제 뭐였는지' 확인용.
                      const checked = (d.hwCheck || []).filter((c) => c.text).map((c) => c.text + (c.status ? ` (${c.status})` : "")).join(", ");
                      const hw = d.hwAssign?.length ? d.hwAssign.join(", ") : d.homework;
                      const ts = byDate[d.date] || [];
                      return (
                        <div className="smm-flow-it" key={d.date}>
                          <span className="smm-flow-d">{md(d.date)}</span>
                          <div className="smm-flow-body">
                            {prog && <div><span className="smm-flow-tag">진도</span>{prog}</div>}
                            {goals && <div><span className="smm-flow-tag">목표</span>{goals}</div>}
                            {d.materials && <div><span className="smm-flow-tag">자료</span>{d.materials}</div>}
                            {checked && <div><span className="smm-flow-tag">숙제검사</span>{checked}</div>}
                            {hw && <div><span className="smm-flow-tag">내줄숙제</span>{hw}</div>}
                            {ts.map((t) => (
                              <div key={t.id}><span className="smm-flow-tag test">시험</span>{t.name} {t.score}/{t.total}{t.result ? ` · ${t.result}` : ""}</div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <div className="smm-block">
              <div className="smm-block-h">날짜별</div>
              <table className="smm-tbl">
                <thead><tr><th>날짜</th><th>출결</th><th>단어</th><th>리딩</th><th>문법</th><th>점</th></tr></thead>
                <tbody>
                  {mDaily.map((d) => (
                    <tr key={d.date}>
                      <td>{md(d.date)}</td><td>{d.attStatus || "—"}</td>
                      <td>{d.hwWord || "—"}</td><td>{d.hwReading || "—"}</td><td>{d.hwGrammar || "—"}</td>
                      <td>{d.points || 0}</td>
                    </tr>
                  ))}
                  {mDaily.length === 0 && <tr><td colSpan={6} className="hub-muted">기록 없음</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <div className="modal-foot">
        {periods.length > 0 && <button className="btn ghost" disabled={exporting} onClick={() => exportImage(false)}><Icon name="camera" /> {exporting ? "처리 중…" : "이미지 저장"}</button>}
        {periods.length > 0 && <button className="btn ghost" disabled={exporting} onClick={() => exportImage(true)}><Icon name="fileText" /> 인쇄</button>}
        <button className="btn primary" onClick={closeModal} style={{ marginLeft: "auto" }}>닫기</button>
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
