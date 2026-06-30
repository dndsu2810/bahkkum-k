import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import type { AttRecord, Attitude, AttStatus, HwLog, Makeup, Student } from "../types";
import { DOW, fmtFull, fmtMDDow, parseD, timeToMin, todayStr, uid, ymd } from "../lib/dates";
import { activeStudents, attendsOn, effectiveLessons, lessonDurationFor, nextLessonDate, studentById } from "../lib/logic";
import { loadCheckout, saveCheckout, pruneCheckout, fetchCheckout, setCheckout } from "../lib/checkoutState";
import { useDashOrder, isInteractiveTarget } from "../lib/dashOrder";
import { applyMakeup, findBoKey } from "../lib/attendanceLogic";
import { holidayName } from "../lib/holidays";
import { awardPoints, pushAttendanceNotion, pushHomeworkNotion, attendancePoints, loadPointCatalog } from "../api";
import { GradeBadge, Empty } from "../components/ui";
import { MathMonthlyModal } from "../components/modals";
import { TodayTests, SupLearn } from "../components/TodayTests";
import { ClassNoteBox } from "../components/ClassNoteBox";
import { Icon } from "../icons";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { useApprovedChanges, arrivalOf, findSlotConflicts } from "../lib/changeReqLive";
import { ConflictPopup, ApprovedBanner } from "../components/ChangeReqLive";
import { QueuePanel } from "../components/QueuePanel";
import { AlimBoard } from "../components/AlimBoard";

interface LessonOnDate {
  student: Student;
  time: string;
  duration: number;
}

/** 오늘 등원 카드 1개 = 한 학생(정규 수업 lesson + 그날 보강 makeups). */
interface DayEntry {
  key: string;
  student: Student;
  time: string;
  lesson?: LessonOnDate;
  makeups: Makeup[];
  /** 예정에 없던 학생을 검색해 직접 추가한 카드(이 화면에서만). */
  extra?: boolean;
}

// 출결 선택지 — 출결 기록 페이지와 동일(출석·지각·결석 + 조퇴·무단결석). 영어 '오늘'과도 통일.
const QUICK: { s: AttStatus; cls: string }[] = [
  { s: "출석", cls: "on-present" },
  { s: "지각", cls: "on-late" },
  { s: "결석", cls: "on-absent" },
  { s: "조퇴", cls: "on-late" },
  { s: "무단결석", cls: "on-absent" },
];

// 수업태도 (노션 '수업태도' select 옵션과 동일 라벨)
const ATTITUDES = ["매우좋음", "보통", "미흡"];

const PCT_QUICK = [0, 50, 80, 100];
// 오늘 내주기에서 고르는 숙제 영역(노션 '영역' multi_select). 노션과 동일 라벨.
const AREA_TAGS = ["개념", "연산", "복습", "오답", "심화", "활용", "사고력", "서술형", "수학익힘"];

// 출결 상태 → 배지 색(중고등영어 대시보드 요약과 통일).
const mathAttTone = (st?: string) =>
  st === "출석" ? "b-green" : st === "지각" || st === "조퇴" ? "b-orange" : st === "결석" || st === "무단결석" ? "b-red" : st === "보강" ? "b-blue" : "b-gray";

export function TodayDashboard() {
  const { data, mutate, toast, openModal, navigate } = useStore();
  // 보는 날짜(기본 오늘) — 화살표로 어제/내일 이동, '오늘로'로 복귀 (A-4)
  const [day, setDay] = useState(todayStr());
  const dDate = parseD(day);
  const dow = DOW[dDate.getDay()];
  const isToday = day === todayStr();
  const shiftDay = (delta: number) => {
    const d = parseD(day);
    d.setDate(d.getDate() + delta);
    setDay(ymd(d));
  };
  const holiday = holidayName(day);
  // 학생별 '내줄 숙제' 입력 임시값 · 마감일 임시값 · 검사 완성도 직접입력 임시값
  const [assignDraft, setAssignDraft] = useState<Record<string, string>>({});
  const [dueDraft, setDueDraft] = useState<Record<string, string>>({});
  const [tagDraft, setTagDraft] = useState<Record<string, string[]>>({});
  const [pctDraft, setPctDraft] = useState<Record<string, string>>({});
  const [schedDraft, setSchedDraft] = useState<Record<string, string>>({}); // 숙제별 '다시 검사할 날' 임시값
  const [schedOpen, setSchedOpen] = useState<string | null>(null); // 검사일 패널이 열린 숙제 id
  // 내준 숙제 인라인 수정 — 한 번에 한 건만 편집(내용·마감일·영역).
  const [editHw, setEditHw] = useState<string | null>(null);
  const [editBook, setEditBook] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [gradeTab, setGradeTab] = useState<"all" | "cho" | "jung">("all");
  // 예정에 없어도 검색해서 추가하는 등원 학생(이 화면에서만) — 영어 '오늘 등원'과 동일.
  const [extraIds, setExtraIds] = useState<Set<string>>(new Set());
  const [addQ, setAddQ] = useState("");
  // 중고등영어 대시보드와 동일한 세로 카드형 — 카드 펼침(openKeys) + 하원(outKeys, 맨 아래로 접기).
  // 하원은 새로고침해도 그날 분은 유지(날짜별 localStorage).
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const [outKeys, setOutKeys] = useState<Set<string>>(() => loadCheckout("math", day));
  // 카드 표시 순서 — 시간순으로 시작, 드래그로 재정렬(날짜별 저장).
  const { sortItems, move } = useDashOrder("math", day);
  const [dragKey, setDragKey] = useState<string | null>(null);
  // 하원 상태는 서버 공유 — 모든 강사 기기가 같은 상태. 마운트·날짜변경·15초·포커스에 동기화.
  useEffect(() => {
    let alive = true;
    setOutKeys(loadCheckout("math", day)); // 즉시 로컬 캐시 표시
    const sync = () => fetchCheckout("math", day).then((s) => { if (alive) setOutKeys(s); }).catch(() => {});
    void sync();
    const iv = window.setInterval(sync, 15000);
    const onFocus = () => void sync();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, [day]);
  useEffect(() => { pruneCheckout(todayStr()); }, []); // 오래된 날짜 키 정리
  const toggleOpen = (key: string) => setOpenKeys((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleOut = (key: string) => {
    const willOut = !outKeys.has(key);
    const next = new Set(outKeys); willOut ? next.add(key) : next.delete(key);
    setOutKeys(next);
    saveCheckout("math", day, next);
    void setCheckout("math", day, next); // 서버에 전체 목록 저장 — 새로고침/다른 기기에도 그대로 복원
    if (willOut) {
      setOpenKeys((p) => { const n = new Set(p); n.delete(key); return n; }); // 하원하면 접기
      // 수학 하원은 학생에게 알림을 보내지 않는다(원장 요청). 카드 접기 정렬용으로만 사용.
    }
  };
  const focusCard = (key: string) => {
    setOpenKeys((p) => new Set(p).add(key)); // 그 학생 입력란을 펼치고 그 위치로 이동
    window.setTimeout(() => document.getElementById("mathcard-" + key)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  // 시간표 변경요청 — 그 날짜 승인된 변경(수학) 표시 + 수학↔영어 겹침 자동 감지.
  const [hubRoster, setHubRoster] = useState<RosterStudent[]>([]);
  useEffect(() => { getRoster().then(setHubRoster).catch(() => {}); }, []);
  // 출석 적립 점수(카탈로그) 로드 — 수학도 '포인트 항목' 점수로 적립(키오스크 반영).
  useEffect(() => { void loadPointCatalog(); }, []);
  const approvedChanges = useApprovedChanges(day);
  const conflicts = useMemo(() => findSlotConflicts(hubRoster, day), [hubRoster, day]);

  const lessons: LessonOnDate[] = [];
  // 공휴일(빨간날)에는 수업/등원 없음
  if (!holiday)
    activeStudents(data.students).forEach((s) => {
      if (!attendsOn(s, day)) return;
      effectiveLessons(s, day).forEach((l) => {
        if (l.day === dow) lessons.push({ student: s, time: l.time, duration: l.duration });
      });
    });
  // 1회성 변경 반영(수학): 빠진 시각(fromDate=오늘) 제거 + 옮겨온/바뀐 시각(toDate=오늘) 추가.
  //  → 다른 날로 옮긴 경우뿐 아니라 '같은 날 시간만 바꾼' 1회 변경(예: 오늘 5시→7시)도 새 시각으로 반영된다.
  if (!holiday && approvedChanges.length) {
    for (const c of approvedChanges.filter((c) => c.subject === "math" && c.fromDate === day)) {
      const i = lessons.findIndex((l) => l.student.id === c.studentId && (!c.fromTime || l.time === c.fromTime));
      if (i >= 0) lessons.splice(i, 1);
    }
    for (const c of approvedChanges.filter((c) => c.subject === "math" && (c.toDate || c.changeDate) === day && c.toTime)) {
      const s = studentById(data.students, c.studentId);
      if (s && !lessons.some((l) => l.student.id === s.id && l.time === c.toTime)) {
        lessons.push({ student: s, time: c.toTime, duration: lessonDurationFor(s, c.fromTime || c.toTime) });
      }
    }
  }
  lessons.sort((a, b) => timeToMin(a.time) - timeToMin(b.time));

  const keyOf = (it: LessonOnDate) => day + "|" + it.student.id + "|" + it.time;
  const noneKey = (sid: string) => sid + "|" + day;
  const isNone = (sid: string) => (data.noHomework || []).includes(noneKey(sid));

  // 검사 기준일 = 다시 검사할 날짜(있으면) 아니면 마감일. 지연하면 recheckDate로 그날 다시 뜸.
  const effDate = (h: HwLog) => h.recheckDate || h.date;
  // 오늘 검사 대상 숙제들 (마감일=오늘 또는 지연 후 다시검사일=오늘) — 여러 개 가능
  const todayHwsOf = (sid: string): HwLog[] => data.homeworkLog.filter((h) => h.studentId === sid && effDate(h) === day);
  // 미뤄둔(지연 예정) 숙제 — 다시검사일이 오늘 이후라 오늘 목록엔 안 뜨는 것들. 검사 일정 변경용으로 따로 보여줌.
  const delayedHwsOf = (sid: string): HwLog[] =>
    data.homeworkLog
      .filter((h) => h.studentId === sid && h.status !== "done" && !!h.recheckDate && (h.recheckDate as string) > day)
      .sort((a, b) => ((a.recheckDate || "") < (b.recheckDate || "") ? -1 : 1));
  // 학생의 다음 수업일 (내주기 마감일 기본값)
  const nextDueOf = (s: Student): string => nextLessonDate(s, day);
  // 내준(예정) 숙제들 = 마감일이 오늘 이후 — 여러 개 가능
  const assignedHwsOf = (sid: string): HwLog[] =>
    data.homeworkLog.filter((h) => h.studentId === sid && h.date > day).sort((a, b) => (a.date < b.date ? -1 : 1));
  // 그 학생이 '진행중'인 교재 목록 — 내줄 숙제를 더 간편하게 고르도록(없으면 직접 입력).
  const ingBooksOf = (sid: string): string[] =>
    [...new Set(data.progressLog.filter((p) => p.studentId === sid && p.pct < 100 && p.unit.trim()).map((p) => p.unit.trim()))];

  /* ---------- 출결 ---------- */
  async function mark(it: LessonOnDate, status: AttStatus) {
    const key = keyOf(it);
    const prev = data.attendance[key];
    const prevRec = prev ? { ...prev } : undefined; // 되돌리기용 이전 상태
    const prevMakeup = data.makeups.find((m) => m.attKey === key);
    const prevMakeupCopy = prevMakeup ? { ...prevMakeup } : undefined;
    const prevAwarded = prev?.pointsAwarded === true;
    const clearing = prev?.status === status;
    const willAward = !clearing && status === "출석";
    // 결석 시 검사할 숙제를 다음 등원일로 이월 / 출석 등으로 바꾸면 복원.
    const sid = it.student.id;
    const isAbsence = !clearing && (status === "결석" || status === "무단결석");
    const wasAbsence = !!prevRec && (prevRec.status === "결석" || prevRec.status === "무단결석");
    const nextDay = isAbsence ? nextLessonDate(it.student, day) : "";
    const doCarry = isAbsence && !!nextDay;
    const doRevert = wasAbsence && !isAbsence; // 결석을 풀거나 다른 출석류로 바꿈
    // 영향받는 숙제 백업(되돌리기용)
    const carryBak: { id: string; recheck?: string; carried?: string }[] = [];
    for (const h of data.homeworkLog) {
      if (h.studentId !== sid) continue;
      const isDueToday = h.status !== "done" && (h.recheckDate || h.date) === day;
      if ((doCarry && isDueToday) || (doRevert && h.carriedFrom === day)) carryBak.push({ id: h.id, recheck: h.recheckDate, carried: h.carriedFrom });
    }
    const carryCount = doCarry ? carryBak.length : 0;
    const revertCarry = (d: { homeworkLog: HwLog[] }) => {
      for (const h of d.homeworkLog) if (h.studentId === sid && h.carriedFrom === day) { h.recheckDate = day; h.carriedFrom = undefined; }
    };
    mutate((d) => {
      if (clearing) {
        delete d.attendance[key];
        d.makeups = d.makeups.filter((m) => !(m.attKey === key && m.status === "pending"));
        if (d.dismissedMakeups?.length) d.dismissedMakeups = d.dismissedMakeups.filter((k) => k !== key);
        if (doRevert) revertCarry(d);
        return;
      }
      const cur = d.attendance[key];
      d.attendance[key] = { ...(cur || {}), status, pointsAwarded: prevAwarded };
      applyMakeup(d, key, it.student.id, it.duration, status);
      if (doCarry) {
        for (const h of d.homeworkLog) {
          if (h.studentId === sid && h.status !== "done" && (h.recheckDate || h.date) === day) { h.recheckDate = nextDay; h.carriedFrom = day; }
        }
      } else if (doRevert) revertCarry(d);
    });
    if (!clearing) {
      const cur = data.attendance[key];
      pushAttendanceNotion(it.student.id, {
        date: day,
        status,
        attitude: cur?.attitude || "",
        lateMinutes: status === "지각" ? cur?.lateMinutes || 0 : 0,
        note: cur?.note || "",
      });
    }
    let awardedNet = 0; // 이 마킹이 실제로 바꾼 포인트(되돌릴 양)
    const pt = attendancePoints(); // 출석 적립 점수(카탈로그)
    if (!prevAwarded && willAward) {
      const r = await awardPoints(it.student.id, pt, "출석");
      awardedNet = r.matched ? pt : 0;
      mutate((d) => {
        const rec = d.attendance[key];
        if (rec) rec.pointsAwarded = r.matched;
      });
    } else if (prevAwarded && !willAward) {
      await awardPoints(it.student.id, -pt, "출석 취소");
      awardedNet = -pt;
      mutate((d) => {
        const rec = d.attendance[key];
        if (rec) rec.pointsAwarded = false;
      });
    }
    // 되돌리기: 이전 출결·보강·포인트를 복원
    const doUndo = () => {
      mutate((d) => {
        if (prevRec) d.attendance[key] = { ...prevRec };
        else delete d.attendance[key];
        d.makeups = d.makeups.filter((m) => m.attKey !== key);
        if (prevMakeupCopy) d.makeups.push({ ...prevMakeupCopy });
        // 이월/복원했던 숙제 원상복구
        for (const bak of carryBak) { const h = d.homeworkLog.find((x) => x.id === bak.id); if (h) { h.recheckDate = bak.recheck; h.carriedFrom = bak.carried; } }
      });
      if (awardedNet) void awardPoints(it.student.id, -awardedNet, "되돌리기");
      if (prevRec) pushAttendanceNotion(it.student.id, { date: day, status: prevRec.status, attitude: prevRec.attitude || "", lateMinutes: prevRec.lateMinutes || 0, note: prevRec.note || "" });
      toast(it.student.name + " · 되돌렸어요");
    };
    const carryMsg = carryCount > 0 && nextDay ? ` · 검사할 숙제 ${carryCount}건 ${fmtMDDow(nextDay)}로 이월` : "";
    toast(clearing ? it.student.name + " · 출결 취소" : it.student.name + " · " + status + carryMsg, doUndo);
  }

  // 미체크 학생 전원 출석 처리 (예외는 이후 개별 수정)
  async function markAllPresent() {
    const targets = lessons.filter((it) => !data.attendance[keyOf(it)]);
    if (!targets.length) {
      toast("이미 모두 체크됐어요.");
      return;
    }
    mutate((d) => {
      for (const it of targets) {
        const key = keyOf(it);
        const cur = d.attendance[key];
        d.attendance[key] = { ...(cur || {}), status: "출석", pointsAwarded: cur?.pointsAwarded === true };
        applyMakeup(d, key, it.student.id, it.duration, "출석");
      }
    });
    for (const it of targets) pushAttendanceNotion(it.student.id, { date: day, status: "출석", attitude: "", lateMinutes: 0, note: "" });
    const awarded: string[] = []; // 실제 포인트 적립된 학생(되돌릴 대상)
    const ptAll = attendancePoints();
    for (const it of targets) {
      const key = keyOf(it);
      const r = await awardPoints(it.student.id, ptAll, "출석");
      if (r.matched) awarded.push(it.student.id);
      mutate((d) => {
        const rec = d.attendance[key];
        if (rec) rec.pointsAwarded = r.matched;
      });
    }
    // 되돌리기: 방금 만든 출석·보강·포인트를 전부 취소
    const doUndo = () => {
      mutate((d) => {
        for (const it of targets) {
          const key = keyOf(it);
          delete d.attendance[key];
          d.makeups = d.makeups.filter((m) => !(m.attKey === key && m.status === "pending"));
        }
      });
      for (const sid of awarded) void awardPoints(sid, -ptAll, "되돌리기");
      toast("전체 출석을 되돌렸어요");
    };
    toast(`오늘 등원한 학생 ${targets.length}명을 모두 출석 처리했어요`, doUndo);
  }

  // 수업태도 선택(출결 먼저 찍은 학생만). 같은 값 다시 누르면 해제. 노션에도 반영.
  function setAttitude(it: LessonOnDate, att: string) {
    const key = keyOf(it);
    if (!data.attendance[key]) {
      toast("출결을 먼저 찍어주세요.");
      return;
    }
    let synced: AttRecord | null = null;
    mutate((d) => {
      const r = d.attendance[key];
      if (r) r.attitude = r.attitude === att ? "" : (att as Attitude);
      synced = d.attendance[key] ? { ...d.attendance[key] } : null;
    });
    if (synced) {
      const r: AttRecord = synced;
      pushAttendanceNotion(it.student.id, {
        date: day,
        status: r.status,
        attitude: r.attitude || "",
        lateMinutes: r.lateMinutes || 0,
        note: r.note || "",
      });
    }
  }

  // 보강 등원 학생의 학습 태도 — 정규 수업이 없는 보강 전용 등원일에도 태도를 기록.
  // 보강 출결 행(보강 키)에 attitude를 저장. 행이 없으면 status '보강'으로 만들어 둔다(보강 완료 시 이 행을 재사용).
  const makeupBoKey = (mk: Makeup) => findBoKey(data.attendance, mk.makeupDate, mk.studentId) || mk.makeupDate + "|" + mk.studentId + "|" + (mk.makeupTime || "");
  const makeupAttitude = (mk: Makeup): string => data.attendance[makeupBoKey(mk)]?.attitude || "";
  function setMakeupAttitude(mk: Makeup, att: string) {
    mutate((d) => {
      const key = findBoKey(d.attendance, mk.makeupDate, mk.studentId) || mk.makeupDate + "|" + mk.studentId + "|" + (mk.makeupTime || "");
      const cur = d.attendance[key];
      d.attendance[key] = { ...(cur || {}), status: cur?.status || "보강", attitude: cur?.attitude === att ? "" : (att as Attitude) };
    });
  }

  // 지각 분 입력 — 지각으로 찍은 학생만. 노션에도 lateMinutes 반영.
  function setLateMin(it: LessonOnDate, min: number) {
    const key = keyOf(it);
    const v = Math.max(0, Math.round(min) || 0);
    let synced: AttRecord | null = null;
    mutate((d) => {
      const r = d.attendance[key];
      if (r) r.lateMinutes = v;
      synced = d.attendance[key] ? { ...d.attendance[key] } : null;
    });
    if (synced) {
      const r: AttRecord = synced;
      pushAttendanceNotion(it.student.id, { date: day, status: r.status, attitude: r.attitude || "", lateMinutes: r.lateMinutes || 0, note: r.note || "" });
    }
  }

  // 결석 사유(특이사항) 저장 — 결석/무단결석 학생. blur 시 attendance.note에 저장 → 월말리포트 특이사항에 '결석 — 사유'로 반영.
  function commitNote(it: LessonOnDate, value: string) {
    const key = keyOf(it);
    const prev = data.attendance[key]?.note ?? "";
    if (value === prev) return; // 바뀐 게 없으면 저장하지 않음
    let synced: AttRecord | null = null;
    mutate((d) => {
      const r = d.attendance[key];
      if (r) r.note = value;
      synced = d.attendance[key] ? { ...d.attendance[key] } : null;
    });
    if (synced) {
      const r: AttRecord = synced;
      pushAttendanceNotion(it.student.id, { date: day, status: r.status, attitude: r.attitude || "", lateMinutes: r.lateMinutes || 0, note: r.note || "" });
    }
  }

  /* ---------- 검사 줄 (오늘 검사 대상 숙제) ---------- */
  // 노션은 확인완료 체크 + 완성도 + 숙제현황(N차 밀림)만 갱신 (내용/특이사항 보존)
  function pushCheck(rec: HwLog) {
    pushHomeworkNotion(rec.studentId, {
      date: rec.date, // 노션 매칭 기준은 원래 마감일 (다시검사일이 아님)
      book: rec.book,
      tags: rec.tags,
      completion: rec.completion,
      done: rec.status === "done",
      memo: rec.memo,
      checkOnly: true,
      delayCount: rec.delayCount || 0,
    });
  }
  function setPct(hwId: string, pct: number) {
    const v = Math.max(0, Math.min(100, Math.round(pct) || 0));
    let synced: HwLog | null = null;
    mutate((d) => {
      const h = d.homeworkLog.find((x) => x.id === hwId);
      if (h) h.completion = v;
      synced = d.homeworkLog.find((x) => x.id === hwId) ?? null;
    });
    setPctDraft((m) => ({ ...m, [hwId]: String(v) }));
    if (synced) pushCheck(synced);
  }
  function commitPctDraft(hwId: string) {
    const raw = pctDraft[hwId];
    if (raw === undefined) return;
    setPct(hwId, +raw);
  }
  // 검사완료 토글: 다시 누르면 '검사 전'으로. 노션 확인완료 체크/해제.
  // 검사완료로 바꾸면 '검사한 날짜(오늘)'를 기록 → 지연 숙제를 며칠 뒤 검사했는지 월말리포트 특이사항에 뜸.
  function toggleDone(hwId: string) {
    let synced: HwLog | null = null;
    mutate((d) => {
      const h = d.homeworkLog.find((x) => x.id === hwId);
      if (h) {
        if (h.status === "done") { h.status = "pending"; h.checkedDate = undefined; }
        else { h.status = "done"; h.checkedDate = day; }
      }
      synced = d.homeworkLog.find((x) => x.id === hwId) ?? null;
    });
    if (synced) pushCheck(synced);
  }
  // 검사일 패널을 열며 기본 날짜(다음 수업일)를 채워둠.
  function openSched(hwId: string, def: string) {
    setSchedOpen((cur) => (cur === hwId ? null : hwId));
    setSchedDraft((m) => (m[hwId] ? m : { ...m, [hwId]: def }));
  }
  // 지연: 숙제를 못 해서 다시 검사할 날짜로 미룸 → 밀림 +1. 노션 '숙제 현황'에 N차 밀림.
  function delayHwTo(hwId: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("다시 검사할 날짜를 골라주세요."); return; }
    const s = studentById(data.students, data.homeworkLog.find((x) => x.id === hwId)?.studentId || "");
    let synced: HwLog | null = null;
    mutate((d) => {
      const h = d.homeworkLog.find((x) => x.id === hwId);
      if (h) { h.status = "late"; h.delayCount = (h.delayCount || 0) + 1; h.recheckDate = date; }
      synced = d.homeworkLog.find((x) => x.id === hwId) ?? null;
    });
    setSchedOpen(null);
    if (synced) {
      const r: HwLog = synced;
      pushCheck(r);
      toast(`${s?.name ?? ""} · ${r.delayCount}차 밀림 · ${fmtMDDow(date)} 다시 검사`);
    }
  }
  // 검사일만 변경: 밀림 횟수는 그대로 두고 검사 날짜만 옮김(일정 조정·날짜 수정용).
  function rescheduleHw(hwId: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("바꿀 날짜를 골라주세요."); return; }
    mutate((d) => {
      const h = d.homeworkLog.find((x) => x.id === hwId);
      if (h) h.recheckDate = date;
    });
    setSchedOpen(null);
    toast(`검사일을 ${fmtMDDow(date)}로 바꿨어요`);
  }
  // 오늘 검사: 미뤄둔 숙제를 오늘 검사 목록으로 가져옴(밀림 횟수 유지).
  function bringHwToday(hwId: string) {
    mutate((d) => {
      const h = d.homeworkLog.find((x) => x.id === hwId);
      if (h) h.recheckDate = day;
    });
    setSchedOpen(null);
    toast("오늘 검사 목록으로 가져왔어요");
  }

  /* ---------- 내주기 줄 (다음 수업일 숙제) ---------- */
  function toggleTag(sid: string, tag: string) {
    setTagDraft((m) => {
      const cur = m[sid] ?? [];
      return { ...m, [sid]: cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag] };
    });
  }
  // 내주기 — 항상 새 숙제 1건 추가(여러 개 가능). 같은 학생에 연달아 여러 번 가능.
  function assignHw(s: Student) {
    const text = (assignDraft[s.id] ?? "").trim();
    if (!text) return;
    const due = (dueDraft[s.id] ?? nextDueOf(s)).trim();
    if (!due) {
      toast("숙제 마감일을 선택해주세요 (시간표 확인)");
      return;
    }
    const rec: HwLog = { id: uid(), studentId: s.id, date: due, book: text, tags: tagDraft[s.id] ?? [], completion: 0, status: "pending", memo: "" };
    mutate((d) => {
      d.homeworkLog.push(rec);
      if (d.noHomework?.length) d.noHomework = d.noHomework.filter((k) => k !== noneKey(s.id));
    });
    setAssignDraft((m) => ({ ...m, [s.id]: "" }));
    setTagDraft((m) => ({ ...m, [s.id]: [] }));
    // 마감일(dueDraft)은 유지 — 같은 날짜로 연속 추가 편하게.
    pushHomeworkNotion(rec.studentId, { date: rec.date, book: rec.book, tags: rec.tags, completion: 0, done: false, memo: "" });
    toast(`${s.name} · 숙제 내줌 (마감 ${fmtMDDow(due)})`);
  }
  function removeHw(hwId: string) {
    mutate((d) => {
      d.homeworkLog = d.homeworkLog.filter((x) => x.id !== hwId);
    });
  }
  // 내준 숙제 수정 시작 — 현재 값을 편집칸에 채움.
  function startEditHw(hw: HwLog) {
    setEditHw(hw.id);
    setEditBook(hw.book);
    setEditDue(hw.date);
    setEditTags(hw.tags);
  }
  // 내준 숙제 수정 저장 — 내용·영역·마감일을 바꾸고 노션도 갱신(같은 날짜면 같은 행 수정).
  function saveHwEdit(hwId: string) {
    const book = editBook.trim();
    if (!book) { toast("숙제 내용을 입력해주세요."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editDue)) { toast("마감일을 골라주세요."); return; }
    let synced: HwLog | null = null;
    mutate((d) => {
      const h = d.homeworkLog.find((x) => x.id === hwId);
      if (h) { h.book = book; h.tags = editTags; h.date = editDue; }
      synced = d.homeworkLog.find((x) => x.id === hwId) ?? null;
    });
    setEditHw(null);
    if (synced) {
      const r: HwLog = synced;
      pushHomeworkNotion(r.studentId, { date: r.date, book: r.book, tags: r.tags, completion: r.completion, done: r.status === "done", memo: r.memo });
      toast("숙제를 수정했어요");
    }
  }
  function markNoHw(s: Student) {
    mutate((d) => {
      d.noHomework = [...new Set([...(d.noHomework || []), noneKey(s.id)])];
      d.homeworkLog = d.homeworkLog.filter((x) => !(x.studentId === s.id && x.date > day));
    });
    toast(`${s.name} · 숙제 없음 처리`);
  }
  function undoNoHw(s: Student) {
    mutate((d) => {
      d.noHomework = (d.noHomework || []).filter((k) => k !== noneKey(s.id));
    });
  }

  /* ---------- 진행 집계 ---------- */
  const attDone = (it: LessonOnDate) => !!data.attendance[keyOf(it)]?.status;

  // 오늘 예정 + 오늘 완료한 보강 (완료 여부를 바로 토글)
  const makeupsToday = data.makeups.filter((k) => (k.status === "scheduled" || k.status === "done") && k.makeupDate === day);
  function completeMakeup(id: string) {
    mutate((d) => {
      const k = d.makeups.find((m) => m.id === id);
      if (!k) return;
      k.status = "done";
      if (k.makeupDate) {
        // 같은 날짜·학생에 이미 보강 출결이 있으면 그 행을 쓰고(중복 방지), 없으면 새로 만든다.
        const exist = findBoKey(d.attendance, k.makeupDate, k.studentId);
        const key = exist || k.makeupDate + "|" + k.studentId + "|" + (k.makeupTime || "");
        d.attendance[key] = { ...(d.attendance[key] || {}), status: "보강", note: d.attendance[key]?.note || k.memo || "" };
      }
    });
    toast("보강 완료 처리했어요.");
  }
  function uncompleteMakeup(id: string) {
    mutate((d) => {
      const k = d.makeups.find((m) => m.id === id);
      if (!k) return;
      k.status = "scheduled";
      const exist = findBoKey(d.attendance, k.makeupDate, k.studentId);
      delete d.attendance[exist || k.makeupDate + "|" + k.studentId + "|" + (k.makeupTime || "")];
    });
  }
  const unchecked = lessons.filter((it) => !attDone(it));

  // 오늘 등원 = 정규 수업 학생 + 보강 학생 통합 (보강만 있는 학생도 카드로 표시)
  const mkBySid: Record<string, Makeup[]> = {};
  for (const k of makeupsToday) (mkBySid[k.studentId] ||= []).push(k);
  const seenReg = new Set<string>();
  const entries: DayEntry[] = [];
  for (const it of lessons) {
    const firstForStu = !seenReg.has(it.student.id);
    seenReg.add(it.student.id);
    entries.push({ key: keyOf(it), student: it.student, time: it.time, lesson: it, makeups: firstForStu ? mkBySid[it.student.id] || [] : [] });
  }
  for (const sid of Object.keys(mkBySid)) {
    if (seenReg.has(sid)) continue; // 정규 있는 학생은 위에서 보강을 붙였음
    const s = studentById(data.students, sid);
    if (!s) continue;
    entries.push({ key: "mk_" + sid, student: s, time: mkBySid[sid][0].makeupTime || "", makeups: mkBySid[sid] });
  }
  // 예정에 없어도 검색해 추가한 학생 — 출결을 위해 합성 수업(시간 빈값)으로 카드를 만든다.
  for (const sid of extraIds) {
    if (entries.some((e) => e.student.id === sid)) continue;
    const s = studentById(data.students, sid);
    if (!s) continue;
    const synth: LessonOnDate = { student: s, time: "", duration: lessonDurationFor(s) };
    entries.push({ key: keyOf(synth), student: s, time: "", lesson: synth, makeups: [], extra: true });
  }
  entries.sort((a, b) => timeToMin(a.time || "99:99") - timeToMin(b.time || "99:99"));
  const entryIsCho = (e: DayEntry) => (e.student.grade || "").startsWith("초");
  const choEntries = entries.filter(entryIsCho).length;
  const shownEntries = gradeTab === "all" ? entries : entries.filter((e) => (gradeTab === "cho" ? entryIsCho(e) : !entryIsCho(e)));
  // 저장된 순서로 정렬 후, 하원한 학생 카드는 맨 아래로(안정 정렬). 드래그로 재정렬.
  const cardEntries = sortItems(shownEntries, (e) => e.key).sort((a, b) => (outKeys.has(a.key) ? 1 : 0) - (outKeys.has(b.key) ? 1 : 0));
  // 등원 학생 추가 검색 — 이미 카드에 있는 학생은 제외.
  const addExtra = (sid: string) => { setExtraIds((p) => new Set(p).add(sid)); setAddQ(""); };
  const addHits = addQ.trim()
    ? activeStudents(data.students).filter((s) => s.name.includes(addQ.trim()) && !entries.some((e) => e.student.id === s.id)).slice(0, 12)
    : [];

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">대시보드</h1>
          <div className="page-desc">등원한 학생을 카드로 펼쳐, 한 화면에서 입력해요</div>
        </div>
        <div className="date-nav">
          <button className="date-arrow" onClick={() => shiftDay(-1)} title="어제" aria-label="어제로">‹</button>
          <div className="date-cur">{fmtFull(dDate)}{!isToday && <span className="date-off"> · 오늘 아님</span>}</div>
          <button className="date-arrow" onClick={() => shiftDay(1)} title="내일" aria-label="내일로">›</button>
          {!isToday && <button className="btn ghost sm date-today" onClick={() => setDay(todayStr())}>오늘로</button>}
        </div>
      </div>

      <ApprovedBanner changes={approvedChanges} subject="math" date={day} />
      <ConflictPopup conflicts={conflicts} date={day} />

      {/* 알림장 공지 (전체·반별·여러 명 + 마감일) */}
      <AlimBoard date={day} />

      {/* 번호표 대기열 (수학) */}
      <QueuePanel subject="math" />

      {/* 오늘 등원 학생 — 학생별 카드 */}
      <div className="card sec-gap">
        <div className="card-head">
          <div><div className="card-title">오늘 등원 학생</div><div className="card-sub">학생마다 출결·태도·숙제를 기록해요</div></div>
          {lessons.length > 0 && (
            <button className="btn sm" onClick={markAllPresent} disabled={unchecked.length === 0} title="미체크 학생 전원 출석">
              <Icon name="check" />전체 출석
            </button>
          )}
        </div>

        {entries.length > 0 && (
          <div className="seg-toggle today-tabs">
            <button className={gradeTab === "all" ? "on" : ""} onClick={() => setGradeTab("all")}>전체 <span className="seg-count">{entries.length}</span></button>
            <button className={gradeTab === "cho" ? "on" : ""} onClick={() => setGradeTab("cho")}>초등 <span className="seg-count">{choEntries}</span></button>
            <button className={gradeTab === "jung" ? "on" : ""} onClick={() => setGradeTab("jung")}>중등 <span className="seg-count">{entries.length - choEntries}</span></button>
          </div>
        )}

        {holiday ? (
          <Empty>{isToday ? "오늘은" : "이 날은"} {holiday} (공휴일) — 휴원입니다.</Empty>
        ) : (
          <>
            {/* 등원 학생 추가 — 예정에 없어도 검색해서 넣을 수 있어요 (중고등영어 '오늘 등원'과 동일) */}
            <div className="today-addrow">
              <input className="input today-addsearch" value={addQ} onChange={(e) => setAddQ(e.target.value)} placeholder="등원 학생 추가 — 예정에 없어도 이름으로 검색해서 넣어요" />
              {addQ.trim() && (
                <div className="today-addhits">
                  {addHits.length === 0 ? (
                    <span className="hub-muted">검색 결과가 없어요.</span>
                  ) : (
                    addHits.map((s) => (
                      <button key={s.id} type="button" className="today-pt" onClick={() => addExtra(s.id)}>{s.name} <span className="muted">{s.grade}</span> +</button>
                    ))
                  )}
                </div>
              )}
            </div>

            {entries.length === 0 ? (
              <Empty>
                <div>{isToday ? "오늘" : "이 날"} 등원 예정 학생이 없어요. 위에서 검색해 추가할 수 있어요.</div>
                <button className="btn ghost sm empty-cta" onClick={() => navigate("timetable")}><Icon name="cal" />시간표 보기</button>
              </Empty>
            ) : (
              <>
            {/* 오늘 등원 칩 — 누르면 그 학생 입력 카드로 이동 (중고등영어와 동일) */}
            <div className="eng-chiprow today-jumprow">
              {cardEntries.map((e) => (
                <button
                  type="button"
                  key={e.key}
                  className={"today-jump-chip" + (outKeys.has(e.key) ? " out" : "")}
                  onClick={() => focusCard(e.key)}
                  title="이 학생 입력란으로 이동"
                >
                  {e.student.name}
                </button>
              ))}
            </div>

            <div className="eng-dash-cards math-dash-cards">
              {cardEntries.map((e) => {
                const s = e.student;
                const lesson = e.lesson;
                const st = lesson ? data.attendance[keyOf(lesson)]?.status : undefined;
                const checkHws = todayHwsOf(s.id);
                const assignedHws = assignedHwsOf(s.id);
                const delayedHws = delayedHwsOf(s.id);
                const none = isNone(s.id);
                const mkAllDone = e.makeups.length > 0 && e.makeups.every((m) => m.status === "done");
                const attOk = lesson ? !!st : mkAllDone;
                const done = attOk && checkHws.every((h) => h.status === "done") && (assignedHws.length > 0 || none);
                const lateMin = lesson ? data.attendance[keyOf(lesson)]?.lateMinutes : undefined;
                const schedDef = (nextLessonDate(s, day) || day); // 검사일 기본값(다음 수업일)
                const open = openKeys.has(e.key);
                const out = outKeys.has(e.key);
                const bks = ingBooksOf(s.id);
                const checkDone = checkHws.length > 0 && checkHws.every((h) => h.status === "done");
                const testCnt = data.testLog.filter((t) => t.studentId === s.id && t.date === day).length;
                return (
                <div id={"mathcard-" + e.key} key={e.key} className={"eng-dash-card" + (open ? " open" : "") + (out ? " out" : "") + (done ? " alldone" : "")}
                  onDragOver={(ev) => ev.preventDefault()}
                  onDrop={(ev) => { ev.preventDefault(); if (dragKey) move(dragKey, e.key, cardEntries.map((x) => x.key)); setDragKey(null); }}>
                  {/* 요약 줄 — 항상 보임. 요약줄 아무 데나 잡아 드래그(버튼·입력은 제외). */}
                  <div className="eng-dash-sum draggable" draggable
                    onDragStart={(ev) => { if (isInteractiveTarget(ev.target)) { ev.preventDefault(); return; } setDragKey(e.key); }}>
                    <span className="eng-dash-sum-name">{s.name}</span>
                    <button className="eng-dash-rec" onClick={() => openModal(<MathMonthlyModal studentId={s.id} name={s.name} />)} title="누적 기록 보기 (출결·진도·시험)" aria-label="누적 기록"><Icon name="chart" /></button>
                    <span className="eng-dash-sum-tags">
                      {out && <span className="badge b-gray">하원</span>}
                      {e.extra && <span className="badge b-blue" title="예정에 없던 추가 등원">추가</span>}
                      <GradeBadge grade={s.grade} />
                      {e.time && <span className="eng-sum-chip">{e.time}{lesson ? ` · ${lesson.duration}분` : ""}</span>}
                      {lesson && st ? <span className={"badge " + mathAttTone(st)}>{st}{st === "지각" && lateMin ? ` ${lateMin}분` : ""}</span> : null}
                      {!lesson && e.makeups.length > 0 && <span className="badge b-blue">보강{mkAllDone ? " 완료" : ""}</span>}
                      {(() => { const ch = arrivalOf(approvedChanges, s.id, "math", day); return ch && ch.fromDate && ch.fromDate !== day ? <span className="eng-sum-chip" title="다른 날에서 옮겨온 수업">이동</span> : null; })()}
                      {bks.length > 0 && <span className="eng-sum-chip" title="진도·교재관리 진행중 교재">교재 {bks.join(", ")}</span>}
                      {checkHws.length > 0 && <span className={"eng-sum-chip" + (checkDone ? " ok" : " todo")}>숙제검사 {checkDone ? "완료" : "미완"}</span>}
                      {testCnt > 0 && <span className="eng-sum-chip">시험 {testCnt}</span>}
                      {!!s.birthdate && s.birthdate.slice(5) === day.slice(5) && <span className="badge b-pink" title="오늘 생일">🎂</span>}
                      {done && <span className="eng-dot ok" title="출결·숙제 완료" />}
                    </span>
                    <button className={"eng-dash-out" + (out ? " on" : "")} onClick={() => toggleOut(e.key)} title={out ? "다시 등원으로 (맨 위로)" : "하원 — 카드를 맨 아래로 접어요"}>{out ? "등원" : "하원"}</button>
                  </div>
                  {/* 접혀 있을 땐 블러로 살짝 보이고, 펼치면 입력 (중고등영어 카드와 동일) */}
                  <div className={"eng-dash-peek math-card-body" + (open ? " open" : "")}>

                  {/* 출결 */}
                  {lesson && (
                    <div className="eng-field">
                      <div className="eng-label">출결</div>
                      <div className="today-seg">
                        {QUICK.map((q) => (
                          <button key={q.s} className={st === q.s ? q.cls : ""} onClick={() => mark(lesson, q.s)}>{q.s}</button>
                        ))}
                      </div>
                      {st === "지각" && (
                        <label className="eng-late-row">지각 <input className="sm-input" style={{ maxWidth: 90 }} type="number" min={0} step={5} placeholder="분" value={data.attendance[keyOf(lesson)]?.lateMinutes ?? ""} onChange={(ev) => setLateMin(lesson, +ev.target.value || 0)} /> 분</label>
                      )}
                      {(st === "결석" || st === "무단결석") && (() => {
                        const k = keyOf(lesson);
                        const saved = data.attendance[k]?.note ?? "";
                        // uncontrolled — 15초 동기화 리렌더가 입력 DOM 값을 다시 안 써서 한글 조합이 안 깨짐(글자 중복 방지). 저장은 blur 때만.
                        return (
                          <input
                            key={k}
                            className="input today-absent-note"
                            style={{ marginTop: 8 }}
                            placeholder="결석 사유 (월말리포트 특이사항에 반영)"
                            defaultValue={saved}
                            onBlur={(ev) => commitNote(lesson, ev.target.value)}
                            onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }}
                          />
                        );
                      })()}
                    </div>
                  )}

                  {/* 보강 완료 */}
                  {e.makeups.length > 0 && (
                    <div className="eng-field today-mk-field">
                      <div className="eng-label">보강</div>
                      <div className="today-actions">
                        {e.makeups.map((mk) => (
                          <button
                            key={mk.id}
                            className={"btn sm" + (mk.status === "done" ? "" : " primary")}
                            onClick={() => (mk.status === "done" ? uncompleteMakeup(mk.id) : completeMakeup(mk.id))}
                            title="보강 완료 표시"
                          >
                            <Icon name="check" />{mk.status === "done" ? "보강 완료됨" : "보강 완료"}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 수업태도 (정규 출결 찍은 학생만) */}
                  {lesson && st && (
                    <div className="eng-field">
                      <div className="eng-label">수업 태도</div>
                      <div className="today-mood-seg">
                        {ATTITUDES.map((a) => {
                          const on = data.attendance[keyOf(lesson)]?.attitude === a;
                          return <button key={a} className={on ? "on" : ""} onClick={() => setAttitude(lesson, a)}>{a}</button>;
                        })}
                      </div>
                    </div>
                  )}

                  {/* 수업태도 (보강 전용 등원일 — 정규 수업이 없어도 보강으로 왔으면 입력 가능) */}
                  {!lesson && e.makeups.length > 0 && (
                    <div className="eng-field">
                      <div className="eng-label">수업 태도</div>
                      <div className="today-mood-seg">
                        {ATTITUDES.map((a) => {
                          const on = makeupAttitude(e.makeups[0]) === a;
                          return <button key={a} className={on ? "on" : ""} onClick={() => setMakeupAttitude(e.makeups[0], a)}>{a}</button>;
                        })}
                      </div>
                    </div>
                  )}

                  {/* 검사할 숙제 (오늘 마감) */}
                  <div className="eng-field today-hwsec">
                    <div className="eng-label">검사할 숙제</div>
                    {checkHws.length === 0 ? (
                      <div className="today-hwrow-empty">오늘 검사할 숙제 없음</div>
                    ) : (
                      checkHws.map((hw) => {
                        const pctVal = pctDraft[hw.id] ?? String(hw.completion);
                        return (
                          <div className="today-hwrow" key={hw.id}>
                          <div className="today-hwitem">
                            <span className="today-hwitem-name" title={hw.book}>
                              <span className="today-hwitem-title">{hw.book || "숙제"}{hw.tags.length ? <span className="muted"> · {hw.tags.join(", ")}</span> : null}</span>
                              {hw.carriedFrom ? <span className="badge b-blue" title={fmtMDDow(hw.carriedFrom) + " 결석으로 이월"}>결석 이월</span> : null}
                              {hw.delayCount ? <span className="badge b-orange">{hw.delayCount}차 밀림</span> : null}
                            </span>
                            <span className="today-pct-quick">
                              {PCT_QUICK.map((p) => (
                                <button key={p} className={hw.completion === p ? "on" : ""} onClick={() => setPct(hw.id, p)}>{p}</button>
                              ))}
                            </span>
                            <span className="today-hw-pctwrap">
                              <input
                                className="today-hw-pct"
                                type="number"
                                min={0}
                                max={100}
                                aria-label="완성도"
                                value={pctVal}
                                onChange={(e) => setPctDraft((m) => ({ ...m, [hw.id]: e.target.value }))}
                                onBlur={() => commitPctDraft(hw.id)}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              />
                              <span className="today-hw-pctsign">%</span>
                            </span>
                            <button className={"btn sm hw-donebtn" + (hw.status === "done" ? " on" : "")} onClick={() => toggleDone(hw.id)} title={hw.status === "done" ? "다시 누르면 '검사 전'으로 돌아가요" : "검사 완료로 표시해요"}>
                              <Icon name="check" />{hw.status === "done" ? ((hw.delayCount || 0) > 0 ? "지연 검사완료됨" : "검사완료됨") : ((hw.delayCount || 0) > 0 ? "지연검사완료" : "검사완료")}
                            </button>
                            {hw.status === "done" && <span className="hw-donenote">검사가 완료되었어요</span>}
                            <button className={"btn ghost sm" + (schedOpen === hw.id ? " on" : "")} onClick={() => openSched(hw.id, schedDef)} title="지연·검사일 변경"><Icon name="cal" /> 검사일</button>
                          </div>
                          {schedOpen === hw.id && (
                            <div className="today-sched">
                              <span className="today-sched-lbl">다시 검사할 날</span>
                              <button type="button" className="today-sched-quick" onClick={() => setSchedDraft((m) => ({ ...m, [hw.id]: schedDef }))} title="다음 수업일로">다음 수업일</button>
                              <input className="today-due-input" type="date" aria-label="다시 검사할 날짜" value={schedDraft[hw.id] ?? schedDef} onChange={(ev) => setSchedDraft((m) => ({ ...m, [hw.id]: ev.target.value }))} />
                              <button type="button" className="btn sm" onClick={() => delayHwTo(hw.id, schedDraft[hw.id] ?? schedDef)} title="숙제를 못 해서 미뤄요 (밀림 +1)">지연으로 미루기{(hw.delayCount || 0) > 0 ? " (밀림 +1)" : ""}</button>
                              <button type="button" className="btn ghost sm" onClick={() => rescheduleHw(hw.id, schedDraft[hw.id] ?? schedDef)} title="밀림 횟수는 그대로 두고 검사 날짜만 옮겨요">검사일만 변경</button>
                            </div>
                          )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* 지연 예정 숙제 — 미뤄둬서 오늘 목록엔 없지만 검사일을 바꾸거나 오늘 검사할 수 있게. */}
                  {delayedHws.length > 0 && (
                    <div className="eng-field today-hwsec">
                      <div className="eng-label">지연 예정 숙제 <span className="muted">검사일을 바꾸거나 오늘 검사할 수 있어요</span></div>
                      {delayedHws.map((hw) => (
                        <div className="today-hwitem" key={hw.id}>
                          <span className="today-hwitem-name" title={hw.book}>
                            <span className="today-hwitem-title">{hw.book || "숙제"}{hw.tags.length ? <span className="muted"> · {hw.tags.join(", ")}</span> : null}</span>
                            {hw.delayCount ? <span className="badge b-orange">{hw.delayCount}차 밀림</span> : null}
                            <span className="muted"> · {fmtMDDow(hw.recheckDate as string)} 검사 예정</span>
                          </span>
                          <input className="today-due-input" type="date" aria-label="검사 예정일" value={schedDraft[hw.id] ?? (hw.recheckDate as string)} onChange={(ev) => setSchedDraft((m) => ({ ...m, [hw.id]: ev.target.value }))} />
                          <button type="button" className="btn sm" onClick={() => rescheduleHw(hw.id, schedDraft[hw.id] ?? (hw.recheckDate as string))}>날짜 변경</button>
                          <button type="button" className="btn ghost sm" onClick={() => bringHwToday(hw.id)} title="오늘 검사 목록으로 가져와요"><Icon name="undo" /> 오늘 검사</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ✏️ 내줄 숙제 (여러 개 가능) */}
                  <div className="eng-field today-hwsec assign">
                    <div className="eng-label">내줄 숙제</div>
                    {none ? (
                      <div className="today-hwitem">
                        <span className="today-hwitem-name"><Icon name="check" /> 숙제 없음으로 정리됨</span>
                        <button className="btn ghost sm" onClick={() => undoNoHw(s)}>되돌리기</button>
                      </div>
                    ) : (
                      <>
                        {assignedHws.map((hw) => (
                          editHw === hw.id ? (
                            <div className="today-hwitem assigned editing" key={hw.id}>
                              <input className="today-assign-input" aria-label="숙제 내용" value={editBook} onChange={(e) => setEditBook(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveHwEdit(hw.id); }} placeholder="숙제 내용" />
                              <input className="today-due-input" type="date" aria-label="마감일" value={editDue} onChange={(e) => setEditDue(e.target.value)} />
                              <span className="today-tagchips">
                                {AREA_TAGS.map((t) => {
                                  const on = editTags.includes(t);
                                  return <button key={t} className={on ? "on" : ""} onClick={() => setEditTags(on ? editTags.filter((x) => x !== t) : [...editTags, t])}>{t}</button>;
                                })}
                              </span>
                              <button className="btn sm" onClick={() => saveHwEdit(hw.id)}>저장</button>
                              <button className="btn ghost sm" onClick={() => setEditHw(null)}>취소</button>
                            </div>
                          ) : (
                            <div className="today-hwitem assigned" key={hw.id}>
                              <span className="today-hwitem-name">
                                <b>{hw.book}</b>{hw.tags.length ? <span className="muted"> · {hw.tags.join(", ")}</span> : null}
                                <span className="muted"> · 마감 {fmtMDDow(hw.date)}</span>
                              </span>
                              <button className="btn ghost sm" onClick={() => startEditHw(hw)} title="수정"><Icon name="edit" /></button>
                              <button className="btn ghost sm" onClick={() => removeHw(hw.id)} title="삭제"><Icon name="trash" /></button>
                            </div>
                          )
                        ))}
                        {ingBooksOf(s.id).length > 0 && (
                          <div className="today-bookchips">
                            <span className="today-bookchips-lbl">진행중 교재</span>
                            {ingBooksOf(s.id).map((bk) => (
                              <button
                                key={bk}
                                className={"today-bookchip" + ((assignDraft[s.id] ?? "") === bk ? " on" : "")}
                                onClick={() => setAssignDraft((m) => ({ ...m, [s.id]: bk }))}
                                title="이 교재로 숙제 채우기"
                              >
                                {bk}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="today-assignrow">
                          <input
                            className="today-assign-input"
                            placeholder="내줄 숙제 입력 후 Enter (진행중 교재 선택 또는 직접 입력)"
                            value={assignDraft[s.id] ?? ""}
                            onChange={(e) => setAssignDraft((m) => ({ ...m, [s.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") assignHw(s); }}
                          />
                          <input
                            className="today-due-input"
                            type="date"
                            aria-label="숙제 마감일"
                            title="숙제 마감일 (기본: 다음 수업일)"
                            value={dueDraft[s.id] ?? nextDueOf(s)}
                            onChange={(e) => setDueDraft((m) => ({ ...m, [s.id]: e.target.value }))}
                          />
                          <button className="btn sm" onClick={() => assignHw(s)} disabled={!(assignDraft[s.id] ?? "").trim()}>추가</button>
                          {assignedHws.length === 0 && (
                            <button className="btn ghost sm" onClick={() => markNoHw(s)} title="오늘은 숙제 없음">숙제 없음</button>
                          )}
                          <span className="today-tagchips">
                            {AREA_TAGS.map((t) => {
                              const on = (tagDraft[s.id] ?? []).includes(t);
                              return <button key={t} className={on ? "on" : ""} onClick={() => toggleTag(s.id, t)}>{t}</button>;
                            })}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* 시험 — 오늘 본 시험 + 다음 시간 예약 (영어 '오늘'과 동일 흐름, 수학 평가 기록) */}
                  <TodayTests student={s} day={day} />

                  {/* 1:1 보충학습 — 오늘·대시보드 공용 (월말리포트 자동 반영) */}
                  <SupLearn student={s} day={day} />

                  {/* 알림장 — 학생 화면에 오늘 숙제와 함께 보여줄 메모 */}
                  <ClassNoteBox studentId={s.id} date={day} />
                  </div>
                  <button className="eng-dash-more" onClick={() => toggleOpen(e.key)} aria-expanded={open}>
                    {open ? "접기" : "자세히 보기 / 입력하기"}
                  </button>
                </div>
                );
              })}
            </div>
              </>
            )}
          </>
        )}
      </div>

    </section>
  );
}

