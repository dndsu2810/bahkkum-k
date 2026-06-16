import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import type { AttRecord, Attitude, AttStatus, HwLog, Makeup, Student } from "../types";
import { DOW, fmtFull, fmtMDDow, parseD, timeToMin, todayStr, uid, ymd } from "../lib/dates";
import { activeStudents, attendsOn, effectiveLessons, nextLessonDate, studentById } from "../lib/logic";
import { applyMakeup, findBoKey } from "../lib/attendanceLogic";
import { holidayName } from "../lib/holidays";
import { awardPoints, pushAttendanceNotion, pushHomeworkNotion, attendancePoints, loadPointCatalog } from "../api";
import { GradeBadge, Empty } from "../components/ui";
import { TestModal, StudentModal } from "../components/modals";
import { Icon } from "../icons";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { useApprovedChanges, arrivalOf, findSlotConflicts } from "../lib/changeReqLive";
import { ConflictPopup, ApprovedBanner } from "../components/ChangeReqLive";

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
}

const QUICK: { s: AttStatus; cls: string }[] = [
  { s: "출석", cls: "on-present" },
  { s: "지각", cls: "on-late" },
  { s: "결석", cls: "on-absent" },
];

// 수업태도 (노션 '수업태도' select 옵션과 동일 라벨)
const ATTITUDES = ["매우좋음", "보통", "미흡"];

const PCT_QUICK = [0, 50, 80, 100];
// 오늘 내주기에서 고르는 숙제 영역(노션 '영역' multi_select). 노션과 동일 라벨.
const AREA_TAGS = ["개념", "연산", "복습", "오답", "심화", "활용", "사고력", "서술형", "수학익힘"];

export function Today() {
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
  const [gradeTab, setGradeTab] = useState<"all" | "cho" | "jung">("all");
  // 영어식 마스터-디테일: 왼쪽에서 고른 학생을 오른쪽 상세에 표시.
  const [sel, setSel] = useState<string>("");
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
  // 1회성 이동 반영(수학): 이 날에서 다른 날로 빠진 학생 제거 + 이 날로 옮겨온 학생 추가.
  if (!holiday && approvedChanges.length) {
    const movedOut = new Set(
      approvedChanges.filter((c) => c.subject === "math" && c.fromDate === day && (c.toDate || c.changeDate) !== day).map((c) => c.studentId)
    );
    for (let i = lessons.length - 1; i >= 0; i--) if (movedOut.has(lessons[i].student.id)) lessons.splice(i, 1);
    for (const c of approvedChanges.filter((c) => c.subject === "math" && (c.toDate || c.changeDate) === day && c.fromDate && c.fromDate !== day)) {
      const s = studentById(data.students, c.studentId);
      if (s && !lessons.some((l) => l.student.id === s.id && l.time === c.toTime)) {
        lessons.push({ student: s, time: c.toTime, duration: 60 });
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
  // 학생의 다음 수업일 (내주기 마감일 기본값)
  const nextDueOf = (s: Student): string => nextLessonDate(s, day);
  // 내준(예정) 숙제들 = 마감일이 오늘 이후 — 여러 개 가능
  const assignedHwsOf = (sid: string): HwLog[] =>
    data.homeworkLog.filter((h) => h.studentId === sid && h.date > day).sort((a, b) => (a.date < b.date ? -1 : 1));

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
    toast(`${targets.length}명 전체 출석 처리`, doUndo);
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
  function toggleDone(hwId: string) {
    let synced: HwLog | null = null;
    mutate((d) => {
      const h = d.homeworkLog.find((x) => x.id === hwId);
      if (h) h.status = h.status === "done" ? "pending" : "done";
      synced = d.homeworkLog.find((x) => x.id === hwId) ?? null;
    });
    if (synced) pushCheck(synced);
  }
  // 지연: 다시 검사할 날짜를 지정 → 그날 다시 뜸. 노션 '숙제 현황'에 N차 밀림.
  function delayHw(hwId: string) {
    const cur = data.homeworkLog.find((x) => x.id === hwId);
    if (!cur) return;
    const s = studentById(data.students, cur.studentId);
    const def = (s && nextLessonDate(s, day)) || day;
    const input = window.prompt("이 숙제를 다시 검사할 날짜 (YYYY-MM-DD)", def);
    if (input === null) return;
    const date = input.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast("YYYY-MM-DD 형식으로 입력해주세요.");
      return;
    }
    let synced: HwLog | null = null;
    mutate((d) => {
      const h = d.homeworkLog.find((x) => x.id === hwId);
      if (h) {
        h.status = "late";
        h.delayCount = (h.delayCount || 0) + 1;
        h.recheckDate = date;
      }
      synced = d.homeworkLog.find((x) => x.id === hwId) ?? null;
    });
    if (synced) {
      const r: HwLog = synced;
      pushCheck(r);
      toast(`${s?.name ?? ""} · ${r.delayCount}차 밀림 · ${fmtMDDow(date)} 다시 검사`);
    }
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
  // 오늘 검사 대상 숙제 중 아직 '검사완료'가 아닌 건 수(전체)
  const checkRemaining = lessons.reduce((n, it) => n + todayHwsOf(it.student.id).filter((h) => h.status !== "done").length, 0);
  // 검사 처리됨 = 오늘 검사 대상 숙제가 없거나, 전부 검사완료

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
  const testsToday = data.testLog.filter((t) => t.date === day);
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
  entries.sort((a, b) => timeToMin(a.time || "99:99") - timeToMin(b.time || "99:99"));
  const entryIsCho = (e: DayEntry) => (e.student.grade || "").startsWith("초");
  const choEntries = entries.filter(entryIsCho).length;
  const shownEntries = gradeTab === "all" ? entries : entries.filter((e) => (gradeTab === "cho" ? entryIsCho(e) : !entryIsCho(e)));
  const todayCount = new Set(entries.map((e) => e.student.id)).size;
  // 선택된 학생(없거나 필터에서 빠지면 첫 학생). 오른쪽 상세에 표시.
  const activeEntry = shownEntries.find((e) => e.key === sel) || shownEntries[0] || null;

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">오늘</h1>
          <div className="page-desc">등원 학생의 출결·숙제·진도를 한 화면에서 빠르게 입력하세요</div>
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

      {/* ✨ 오늘 한 줄 브리핑 (B-6) — 그날 할 일을 한 문장으로 (중복되던 KPI 카드는 제거) */}
      {!holiday && entries.length > 0 && (
        <div className="today-brief">
          {isToday ? "오늘은 " : "이 날은 "}<b>{todayCount}명</b> 등원 <span className="brief-mut">(초등 {choEntries}·중등 {entries.length - choEntries})</span>
          {unchecked.length > 0 && <> · 출결 <button className="brief-link" onClick={() => navigate("attendance")}>{unchecked.length}명 대기</button></>}
          {checkRemaining > 0 && <> · 숙제 <button className="brief-link" onClick={() => navigate("homework")}>{checkRemaining}건 검사</button></>}
          {makeupsToday.length > 0 && <> · 보강 <button className="brief-link" onClick={() => navigate("makeup")}>{makeupsToday.length}건</button></>}
          {testsToday.length > 0 && <> · 테스트 <button className="brief-link" onClick={() => navigate("tests")}>{testsToday.length}건</button></>}
          {unchecked.length === 0 && checkRemaining === 0 && <> · 출결·숙제 정리 끝 👏</>}
        </div>
      )}

      {/* 오늘 테스트 예정 (있을 때만) */}
      {testsToday.length > 0 && (
        <div className="card sec-gap">
          <div className="card-head"><div><div className="card-title">오늘 테스트 예정</div><div className="card-sub">{fmtFull(dDate)} 예정된 평가</div></div></div>
          <div className="mk-list">
            {testsToday.map((t) => {
              const s = studentById(data.students, t.studentId);
              return (
                <div className="mk-item" key={t.id}>
                  <div className="mk-main">
                    <div className="mk-name">
                      {s ? s.name : "?"}{" "}
                      <span className={"badge " + (t.status === "완료" ? "b-green" : "b-orange")}>
                        {t.type || "테스트"}{t.status === "완료" ? ` · ${t.score}점` : " · 예정"}
                      </span>
                    </div>
                    <div className="mk-meta"><span>{[t.round, t.range].filter(Boolean).join(" · ") || "범위 미입력"}</span></div>
                  </div>
                  <div className="mk-actions">
                    <button className="btn ghost sm" onClick={() => openModal(<TestModal id={t.id} />)}>
                      <Icon name="edit" />기록
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 오늘 등원 학생 — 학생별 카드 */}
      <div className="card sec-gap">
        <div className="card-head">
          <div><div className="card-title">오늘 등원 학생</div><div className="card-sub">학생별로 출결·태도·숙제를 기록하세요</div></div>
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
        ) : entries.length === 0 ? (
          <Empty>
            <div>{isToday ? "오늘" : "이 날"} 등원 예정 학생이 없어요.</div>
            <button className="btn ghost sm empty-cta" onClick={() => navigate("timetable")}><Icon name="cal" />시간표 보기</button>
          </Empty>
        ) : (
          <div className="today-split eng-split">
            <div className="eng-side">
              {shownEntries.map((e) => {
                const s = e.student;
                const lesson = e.lesson;
                const st = lesson ? data.attendance[keyOf(lesson)]?.status : undefined;
                const checkHws = todayHwsOf(s.id);
                const assignedHws = assignedHwsOf(s.id);
                const none = isNone(s.id);
                const mkAllDone = e.makeups.length > 0 && e.makeups.every((m) => m.status === "done");
                const attOk = lesson ? !!st : mkAllDone;
                const done = attOk && checkHws.every((h) => h.status === "done") && (assignedHws.length > 0 || none);
                const lateMin = lesson ? data.attendance[keyOf(lesson)]?.lateMinutes : undefined;
                const stCls = st === "출석" ? "g" : st === "지각" ? "w" : st === "결석" ? "b" : "";
                return (
                  <div key={e.key} className={"eng-stu today-side-row" + (activeEntry?.key === e.key ? " on" : "")}>
                    <button className="eng-stu-name" onClick={() => setSel(e.key)}>
                      <span className="today-side-nm">{s.name}</span>
                      {e.time && <span className="eng-stu-time">{e.time}</span>}
                      {(() => { const ch = arrivalOf(approvedChanges, s.id, "math", day); return ch && ch.fromDate && ch.fromDate !== day ? <span className="eng-stu-chg" title="다른 날에서 옮겨온 수업">이동</span> : null; })()}
                      {lesson && st && <span className={"today-side-st " + stCls}>{st}{st === "지각" && lateMin ? ` ${lateMin}분` : ""}</span>}
                      {!lesson && <span className="today-side-st blue">보강{mkAllDone ? " 완료" : ""}</span>}
                      {done && <span className="eng-dot ok" title="출결·숙제 완료" />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="eng-main">
              {!activeEntry ? (
                <div className="hub-muted" style={{ padding: 20 }}>왼쪽에서 학생을 선택하면 출결·태도·숙제를 기록할 수 있어요.</div>
              ) : ((e) => {
                const s = e.student;
                const lesson = e.lesson;
                const st = lesson ? data.attendance[keyOf(lesson)]?.status : undefined;
                const checkHws = todayHwsOf(s.id);
                const assignedHws = assignedHwsOf(s.id);
                const none = isNone(s.id);
                const mkAllDone = e.makeups.length > 0 && e.makeups.every((m) => m.status === "done");
                const attOk = lesson ? !!st : mkAllDone;
                const done = attOk && checkHws.every((h) => h.status === "done") && (assignedHws.length > 0 || none);
                return (
                <div key={e.key} className={"eng-daily today-detail" + (done ? " alldone" : "")}>
                  {/* 영어 일일기록과 동일한 라벨+필드 세로 레이아웃 (항목은 수학 그대로) */}
                  <div className="eng-daily-h today-detail-h">
                    <h2>
                      <button type="button" className="stu-namelink" onClick={() => openModal(<StudentModal id={s.id} />)} title="학생 상세">{s.name}</button>
                      <GradeBadge grade={s.grade} />
                      <span className="today-detail-time">
                        {e.time || "보강"}
                        {lesson ? ` · ${lesson.duration}분` : e.makeups[0]?.makeupDuration ? ` · ${e.makeups[0].makeupDuration}분` : ""}
                      </span>
                      {done && <span className="badge b-green">완료</span>}
                      {e.makeups.length > 0 && <span className="badge b-blue">보강</span>}
                      {!!s.birthdate && s.birthdate.slice(5) === day.slice(5) && (
                        <span className="badge b-pink" title="오늘 생일">🎂 생일</span>
                      )}
                    </h2>
                  </div>

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
                    </div>
                  )}

                  {/* 보강 완료 */}
                  {e.makeups.length > 0 && (
                    <div className="eng-field">
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

                  {/* 검사할 숙제 (오늘 마감) */}
                  <div className="eng-field today-hwsec">
                    <div className="eng-label">검사할 숙제</div>
                    {checkHws.length === 0 ? (
                      <div className="today-hwrow-empty">오늘 검사할 숙제 없음</div>
                    ) : (
                      checkHws.map((hw) => {
                        const pctVal = pctDraft[hw.id] ?? String(hw.completion);
                        return (
                          <div className="today-hwitem" key={hw.id}>
                            <span className="today-hwitem-name" title={hw.book}>
                              {hw.book || "숙제"}{hw.tags.length ? <span className="muted"> · {hw.tags.join(", ")}</span> : null}
                              {hw.carriedFrom ? <span className="badge b-blue" style={{ marginLeft: 6 }} title={fmtMDDow(hw.carriedFrom) + " 결석으로 이월"}>결석 이월</span> : null}
                              {hw.delayCount ? <span className="badge b-orange" style={{ marginLeft: 6 }}>{hw.delayCount}차 밀림</span> : null}
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
                            <button className={"btn sm" + (hw.status === "done" ? " primary" : "")} onClick={() => toggleDone(hw.id)} title="검사 완료">
                              <Icon name="check" />{hw.status === "done" ? "완료됨" : "검사완료"}
                            </button>
                            <button className="btn ghost sm" onClick={() => delayHw(hw.id)} title="지연 — 다시 검사할 날짜 지정">지연</button>
                          </div>
                        );
                      })
                    )}
                  </div>

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
                          <div className="today-hwitem assigned" key={hw.id}>
                            <span className="today-hwitem-name">
                              <b>{hw.book}</b>{hw.tags.length ? <span className="muted"> · {hw.tags.join(", ")}</span> : null}
                              <span className="muted"> · 마감 {fmtMDDow(hw.date)}</span>
                            </span>
                            <button className="btn ghost sm" onClick={() => removeHw(hw.id)} title="삭제"><Icon name="trash" /></button>
                          </div>
                        ))}
                        <div className="today-assignrow">
                          <input
                            className="today-assign-input"
                            placeholder="내줄 숙제 입력 후 Enter (계속 추가 가능)"
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
                </div>
                );
              })(activeEntry)}
            </div>
          </div>
        )}
      </div>

    </section>
  );
}
