import { useState } from "react";
import { useStore } from "../store";
import type { AttRecord, Attitude, AttStatus, HwLog, Student } from "../types";
import { DOW, TODAY, fmtFull, fmtMDDow, timeToMin, todayStr, uid } from "../lib/dates";
import { activeStudents, attendsOn, effectiveLessons, nextLessonDate, studentById } from "../lib/logic";
import { applyMakeup } from "../lib/attendanceLogic";
import { holidayName } from "../lib/holidays";
import { awardPoints, pushAttendanceNotion, pushHomeworkNotion } from "../api";
import { GradeBadge, Empty } from "../components/ui";
import { ProgressModal, TestModal } from "../components/modals";
import { Icon, type IconName } from "../icons";

interface LessonOnDate {
  student: Student;
  time: string;
  duration: number;
}

function Kpi({
  label,
  n,
  unit,
  sub,
  empty,
  icon,
  tone,
}: {
  label: string;
  n: number;
  unit: string;
  sub: string;
  empty: string;
  icon: IconName;
  tone: "blue" | "ok" | "warn";
}) {
  const muted = n === 0;
  return (
    <div className={"kpi" + (muted ? " muted" : "")}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className={"kpi-chip c-" + (muted ? "mut" : tone)}>
          <Icon name={icon} />
        </span>
      </div>
      <div className="kpi-num">{n}<span className="kpi-unit">{unit}</span></div>
      <div className="kpi-foot">{muted ? empty : sub}</div>
    </div>
  );
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
  const { data, mutate, toast, openModal } = useStore();
  const day = todayStr();
  const dow = DOW[TODAY.getDay()];
  const holiday = holidayName(day);
  // 학생별 '내줄 숙제' 입력 임시값 · 마감일 임시값 · 검사 완성도 직접입력 임시값
  const [assignDraft, setAssignDraft] = useState<Record<string, string>>({});
  const [dueDraft, setDueDraft] = useState<Record<string, string>>({});
  const [tagDraft, setTagDraft] = useState<Record<string, string[]>>({});
  const [pctDraft, setPctDraft] = useState<Record<string, string>>({});

  const lessons: LessonOnDate[] = [];
  // 공휴일(빨간날)에는 수업/등원 없음
  if (!holiday)
    activeStudents(data.students).forEach((s) => {
      if (!attendsOn(s, day)) return;
      effectiveLessons(s, day).forEach((l) => {
        if (l.day === dow) lessons.push({ student: s, time: l.time, duration: l.duration });
      });
    });
  lessons.sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
  const choCount = lessons.filter((l) => (l.student.grade || "").startsWith("초")).length;

  const keyOf = (it: LessonOnDate) => day + "|" + it.student.id + "|" + it.time;
  const noneKey = (sid: string) => sid + "|" + day;
  const isNone = (sid: string) => (data.noHomework || []).includes(noneKey(sid));

  // 검사 기준일 = 다시 검사할 날짜(있으면) 아니면 마감일. 지연하면 recheckDate로 그날 다시 뜸.
  const effDate = (h: HwLog) => h.recheckDate || h.date;
  // 오늘 검사 대상 숙제 한 건 (마감일=오늘 또는 지연 후 다시검사일=오늘)
  const todayHwOf = (sid: string): HwLog | undefined => data.homeworkLog.find((h) => h.studentId === sid && effDate(h) === day);
  // 학생의 다음 수업일 (내주기 마감일 기본값)
  const nextDueOf = (s: Student): string => nextLessonDate(s, day);
  // '내준 숙제' = 마감일이 오늘 이후인 가장 가까운 숙제. (지연으로 다시검사일만 미래인 건 제외)
  const assignedHwOf = (s: Student): HwLog | undefined =>
    data.homeworkLog
      .filter((h) => h.studentId === s.id && h.date > day)
      .sort((a, b) => (a.date < b.date ? -1 : 1))[0];

  /* ---------- 출결 ---------- */
  async function mark(it: LessonOnDate, status: AttStatus) {
    const key = keyOf(it);
    const prev = data.attendance[key];
    const prevAwarded = prev?.pointsAwarded === true;
    const clearing = prev?.status === status;
    const willAward = !clearing && status === "출석";
    mutate((d) => {
      if (clearing) {
        delete d.attendance[key];
        d.makeups = d.makeups.filter((m) => !(m.attKey === key && m.status === "pending"));
        if (d.dismissedMakeups?.length) d.dismissedMakeups = d.dismissedMakeups.filter((k) => k !== key);
        return;
      }
      const cur = d.attendance[key];
      d.attendance[key] = { ...(cur || {}), status, pointsAwarded: prevAwarded };
      applyMakeup(d, key, it.student.id, it.duration, status);
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
    if (!prevAwarded && willAward) {
      const r = await awardPoints(it.student.id, 20, "출석");
      mutate((d) => {
        const rec = d.attendance[key];
        if (rec) rec.pointsAwarded = r.matched;
      });
    } else if (prevAwarded && !willAward) {
      await awardPoints(it.student.id, -20, "출석 취소");
      mutate((d) => {
        const rec = d.attendance[key];
        if (rec) rec.pointsAwarded = false;
      });
    }
    toast(clearing ? it.student.name + " · 출결 선택 취소" : it.student.name + " · " + status);
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
    for (const it of targets) {
      const key = keyOf(it);
      const r = await awardPoints(it.student.id, 20, "출석");
      mutate((d) => {
        const rec = d.attendance[key];
        if (rec) rec.pointsAwarded = r.matched;
      });
    }
    toast(`${targets.length}명 전체 출석 처리 · 예외만 개별 수정하세요`);
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
  function setPct(sid: string, pct: number) {
    const cur = todayHwOf(sid);
    if (!cur) return;
    const v = Math.max(0, Math.min(100, Math.round(pct) || 0));
    let synced: HwLog | null = null;
    mutate((d) => {
      const h = d.homeworkLog.find((x) => x.id === cur.id);
      if (h) h.completion = v;
      synced = d.homeworkLog.find((x) => x.id === cur.id) ?? null;
    });
    setPctDraft((m) => ({ ...m, [sid]: String(v) }));
    if (synced) pushCheck(synced);
  }
  function commitPctDraft(sid: string) {
    const raw = pctDraft[sid];
    if (raw === undefined) return;
    setPct(sid, +raw);
  }
  // 검사완료 토글: 다시 누르면 '검사 전'으로. 노션 확인완료 체크/해제.
  function toggleDone(sid: string) {
    const cur = todayHwOf(sid);
    if (!cur) return;
    let synced: HwLog | null = null;
    mutate((d) => {
      const h = d.homeworkLog.find((x) => x.id === cur.id);
      if (h) h.status = h.status === "done" ? "pending" : "done";
      synced = d.homeworkLog.find((x) => x.id === cur.id) ?? null;
    });
    if (synced) pushCheck(synced);
  }
  // 지연: 다시 검사할 날짜를 지정 → 그날 다시 뜸. 노션 '숙제 현황'에 N차 밀림.
  function delayHw(sid: string) {
    const cur = todayHwOf(sid);
    if (!cur) return;
    const s = studentById(data.students, sid);
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
      const h = d.homeworkLog.find((x) => x.id === cur.id);
      if (h) {
        h.status = "late";
        h.delayCount = (h.delayCount || 0) + 1;
        h.recheckDate = date;
      }
      synced = d.homeworkLog.find((x) => x.id === cur.id) ?? null;
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
  function assignHw(s: Student) {
    const text = (assignDraft[s.id] ?? "").trim();
    if (!text) return;
    const due = (dueDraft[s.id] ?? nextDueOf(s)).trim();
    if (!due) {
      toast("숙제 마감일을 선택해주세요 (시간표 확인)");
      return;
    }
    const tags = tagDraft[s.id] ?? [];
    let synced: HwLog | null = null;
    mutate((d) => {
      let h = d.homeworkLog.find((x) => x.studentId === s.id && x.date === due);
      if (h) { h.book = text; h.tags = tags; }
      else {
        h = { id: uid(), studentId: s.id, date: due, book: text, tags, completion: 0, status: "pending", memo: "" };
        d.homeworkLog.push(h);
      }
      if (d.noHomework?.length) d.noHomework = d.noHomework.filter((k) => k !== noneKey(s.id));
      synced = d.homeworkLog.find((x) => x.studentId === s.id && x.date === due) ?? null;
    });
    setAssignDraft((m) => ({ ...m, [s.id]: "" }));
    setDueDraft((m) => ({ ...m, [s.id]: "" }));
    setTagDraft((m) => ({ ...m, [s.id]: [] }));
    if (synced) {
      const r: HwLog = synced;
      pushHomeworkNotion(r.studentId, { date: r.date, book: r.book, tags: r.tags, completion: r.completion, done: false, memo: r.memo });
    }
    toast(`${s.name} · 숙제 내줌 (마감 ${fmtMDDow(due)})`);
  }
  function unassignHw(s: Student) {
    const a = assignedHwOf(s);
    mutate((d) => {
      if (a) d.homeworkLog = d.homeworkLog.filter((x) => x.id !== a.id);
    });
    toast(`${s.name} · 내준 숙제 취소`);
  }
  function markNoHw(s: Student) {
    const a = assignedHwOf(s);
    mutate((d) => {
      d.noHomework = [...new Set([...(d.noHomework || []), noneKey(s.id)])];
      if (a) d.homeworkLog = d.homeworkLog.filter((x) => x.id !== a.id);
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
  // 오늘 검사할 게 남은 학생 = 오늘 검사 대상 숙제가 있고 아직 '검사완료'가 아닌 학생
  // (지연 후 다시검사일이 오늘인 숙제도 포함 — 그날 다시 검사해야 하므로)
  const needsCheck = (it: LessonOnDate) => {
    const h = todayHwOf(it.student.id);
    return !!h && h.status !== "done";
  };
  const checkRemaining = lessons.filter(needsCheck).length;
  // 검사 처리됨 = 숙제 없음 / 검사완료 (= 아직 검사 안 끝난 것만 미처리)
  const inspectHandled = (it: LessonOnDate) => {
    const h = todayHwOf(it.student.id);
    return !h || h.status === "done";
  };
  const tidyDone = (it: LessonOnDate) => !!assignedHwOf(it.student) || isNone(it.student.id);

  const cardDone = (it: LessonOnDate) => attDone(it) && inspectHandled(it) && tidyDone(it);

  // 오늘 예정 + 오늘 완료한 보강 (완료 여부를 바로 토글)
  const makeupsToday = data.makeups.filter((k) => (k.status === "scheduled" || k.status === "done") && k.makeupDate === day);
  function completeMakeup(id: string) {
    mutate((d) => {
      const k = d.makeups.find((m) => m.id === id);
      if (!k) return;
      k.status = "done";
      if (k.makeupDate) {
        const key = k.makeupDate + "|" + k.studentId + "|" + (k.makeupTime || "");
        d.attendance[key] = { ...(d.attendance[key] || {}), status: "보강" };
      }
    });
    toast("보강 완료 처리했어요.");
  }
  function uncompleteMakeup(id: string) {
    mutate((d) => {
      const k = d.makeups.find((m) => m.id === id);
      if (!k) return;
      k.status = "scheduled";
      delete d.attendance[k.makeupDate + "|" + k.studentId + "|" + (k.makeupTime || "")];
    });
  }
  const testsToday = data.testLog.filter((t) => t.date === day);
  const unchecked = lessons.filter((it) => !attDone(it));

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <div className="page-title">오늘</div>
          <div className="page-desc">{fmtFull(TODAY)} · 오늘 등원 학생의 출결·숙제·진도를 한 화면에서 빠르게 입력하세요</div>
        </div>
      </div>

      <div className="kpi-row">
        <Kpi label="오늘 수업" n={lessons.length} unit="건" tone="blue" icon="cal"
          sub={`초등 ${choCount} · 중등 ${lessons.length - choCount}`} empty="수업 없는 날" />
        <Kpi label="출결 미체크" n={unchecked.length} unit="명" tone="warn" icon="info"
          sub="지금 체크가 필요해요" empty="모두 체크 완료 👏" />
        <Kpi label="검사할 숙제" n={checkRemaining} unit="건" tone="blue" icon="book"
          sub="검사 대기 중" empty="검사할 숙제 없음" />
        <Kpi label="보강 예정" n={makeupsToday.length} unit="건" tone="blue" icon="refresh"
          sub="오늘 예정" empty="예정된 보강 없음" />
        <Kpi label="오늘 테스트" n={testsToday.length} unit="건" tone="blue" icon="cap"
          sub="오늘 예정" empty="예정된 테스트 없음" />
      </div>

      {/* 오늘 테스트 예정 (있을 때만) */}
      {testsToday.length > 0 && (
        <div className="card sec-gap">
          <div className="card-head"><div><div className="card-title">오늘 테스트 예정</div><div className="card-sub">{fmtFull(TODAY)} 예정된 평가</div></div></div>
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

      {/* 오늘 등원 학생 + 빠른 입력 */}
      <div className="card sec-gap">
        <div className="card-head">
          <div><div className="card-title">오늘 등원 학생</div><div className="card-sub">출결을 찍고, 숙제 검사·내주기를 바로 기록하세요</div></div>
          {lessons.length > 0 && (
            <button className="btn sm" onClick={markAllPresent} disabled={unchecked.length === 0} title="미체크 학생 전원 출석">
              <Icon name="check" />전체 출석
            </button>
          )}
        </div>

        {holiday ? (
          <Empty>오늘은 {holiday} (공휴일) — 휴원입니다.</Empty>
        ) : lessons.length === 0 ? (
          <Empty>오늘은 예정된 수업이 없습니다.</Empty>
        ) : (
          <div className="today-list">
            {lessons.map((it) => {
              const s = it.student;
              const st = data.attendance[keyOf(it)]?.status;
              const hw = todayHwOf(s.id);
              const due = nextDueOf(s);
              const assigned = assignedHwOf(s);
              const none = isNone(s.id);
              const pctVal = pctDraft[s.id] ?? (hw ? String(hw.completion) : "");
              const done = cardDone(it);
              return (
                <div key={keyOf(it)} className={"today-stu" + (st ? " checked" : "") + (done ? " alldone" : "")}>
                  <div className="today-stu-head">
                    <div className="today-time">{it.time}</div>
                    <div className="today-id">
                      <div className="today-name">
                        {done && <span className="today-doneflag"><Icon name="check" /></span>}
                        {s.name} <GradeBadge grade={s.grade} />
                      </div>
                      <div className="today-sub">{it.duration}분{st ? " · " + st : " · 미체크"}</div>
                    </div>
                    <div className="today-actions">
                      <div className="today-seg">
                        {QUICK.map((q) => (
                          <button key={q.s} className={st === q.s ? q.cls : ""} onClick={() => mark(it, q.s)}>
                            {q.s}
                          </button>
                        ))}
                      </div>
                      <button className="btn sm" onClick={() => openModal(<ProgressModal id={null} presetStudentId={s.id} />)}>
                        <Icon name="chart" />진도
                      </button>
                    </div>
                  </div>

                  {/* 😊 수업태도 (출결 찍은 학생만) */}
                  {st && (
                    <div className="today-mood">
                      <span className="today-mood-label">태도</span>
                      <div className="today-mood-seg">
                        {ATTITUDES.map((a) => {
                          const on = data.attendance[keyOf(it)]?.attitude === a;
                          return (
                            <button key={a} className={on ? "on" : ""} onClick={() => setAttitude(it, a)}>{a}</button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 📋 오늘 마감 숙제 (검사용) */}
                  <div className="today-hwrow">
                    <span className="today-hwrow-label">📋 검사</span>
                    {hw ? (
                      <>
                        <span className="today-hwrow-name" title={hw.book}>
                          {hw.book || "숙제"}{hw.tags.length ? <span className="muted"> · {hw.tags.join(", ")}</span> : null}
                          {hw.delayCount ? <span className="badge b-orange" style={{ marginLeft: 6 }}>{hw.delayCount}차 밀림</span> : null}
                        </span>
                        <span className="today-pct-quick">
                          {PCT_QUICK.map((p) => (
                            <button key={p} className={hw.completion === p ? "on" : ""} onClick={() => setPct(s.id, p)}>{p}</button>
                          ))}
                        </span>
                        <span className="today-hw-pctwrap">
                          <input
                            className="today-hw-pct"
                            type="number"
                            min={0}
                            max={100}
                            aria-label="완성도 직접입력"
                            value={pctVal}
                            onChange={(e) => setPctDraft((m) => ({ ...m, [s.id]: e.target.value }))}
                            onBlur={() => commitPctDraft(s.id)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          />
                          <span className="today-hw-pctsign">%</span>
                        </span>
                        <button
                          className={"btn sm" + (hw.status === "done" ? " primary" : "")}
                          onClick={() => toggleDone(s.id)}
                          title="검사 완료"
                        >
                          <Icon name="check" />{hw.status === "done" ? "완료됨" : "검사완료"}
                        </button>
                        <button
                          className="btn ghost sm"
                          onClick={() => delayHw(s.id)}
                          title="지연 — 다시 검사할 날짜 지정"
                        >
                          지연
                        </button>
                      </>
                    ) : (
                      <span className="today-hwrow-empty">오늘 검사할 숙제 없음</span>
                    )}
                  </div>

                  {/* ✏️ 오늘 내줄 숙제 (입력용) */}
                  <div className="today-hwrow assign">
                    <span className="today-hwrow-label">✏️ 내주기</span>
                    {none ? (
                      <>
                        <span className="today-hwrow-doneflag"><Icon name="check" /> 숙제 없음</span>
                        <button className="btn ghost sm" onClick={() => undoNoHw(s)}>되돌리기</button>
                      </>
                    ) : assigned ? (
                      <>
                        <span className="today-hwrow-doneflag">
                          <Icon name="check" /> 내줌: <b>{assigned.book}</b>
                          <span className="muted"> · 마감 {fmtMDDow(assigned.date)}</span>
                        </span>
                        <button className="btn ghost sm" onClick={() => unassignHw(s)}>되돌리기</button>
                      </>
                    ) : (
                      <>
                        <input
                          className="today-assign-input"
                          placeholder="다음 수업에 내줄 숙제"
                          value={assignDraft[s.id] ?? ""}
                          onChange={(e) => setAssignDraft((m) => ({ ...m, [s.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") assignHw(s); }}
                        />
                        <input
                          className="today-due-input"
                          type="date"
                          aria-label="숙제 마감일"
                          title="숙제 마감일 (기본: 다음 수업일)"
                          value={dueDraft[s.id] ?? due}
                          onChange={(e) => setDueDraft((m) => ({ ...m, [s.id]: e.target.value }))}
                        />
                        <button className="btn sm" onClick={() => assignHw(s)} disabled={!(assignDraft[s.id] ?? "").trim()}>
                          내주기
                        </button>
                        <button className="btn ghost sm" onClick={() => markNoHw(s)} title="오늘은 숙제 없음">
                          숙제 없음
                        </button>
                        <span className="today-tagchips">
                          {AREA_TAGS.map((t) => {
                            const on = (tagDraft[s.id] ?? []).includes(t);
                            return (
                              <button key={t} className={on ? "on" : ""} onClick={() => toggleTag(s.id, t)}>{t}</button>
                            );
                          })}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 오늘 보강 예정 + 미체크 */}
      <div className="card sec-gap">
        <div className="card-head"><div><div className="card-title">오늘 보강 · 미체크</div><div className="card-sub">보강 {makeupsToday.length}건 · 미체크 {unchecked.length}명</div></div></div>
        <div className="mk-list">
          {makeupsToday.map((k) => {
            const s = studentById(data.students, k.studentId);
            const done = k.status === "done";
            return (
              <div className="mk-item" key={k.id}>
                <div className="mk-main">
                  <div className="mk-name">{s ? s.name : "?"} <span className={"badge " + (done ? "b-green" : "b-blue")}>{done ? "보강 완료" : "보강 예정"}</span></div>
                  <div className="mk-meta"><span>{k.makeupTime}{k.makeupDuration ? " · " + k.makeupDuration + "분" : ""}</span></div>
                </div>
                <div className="mk-actions">
                  <button className={"btn sm" + (done ? "" : " primary")} onClick={() => (done ? uncompleteMakeup(k.id) : completeMakeup(k.id))}>
                    <Icon name="check" />{done ? "완료됨" : "보강 완료"}
                  </button>
                </div>
              </div>
            );
          })}
          {unchecked.map((it) => (
            <div className="mk-item" key={"u" + keyOf(it)}>
              <div className="mk-main">
                <div className="mk-name" style={{ color: "var(--text3)" }}>{it.student.name}</div>
                <div className="mk-meta"><span>{it.time} · 출결 미체크</span></div>
              </div>
            </div>
          ))}
          {makeupsToday.length === 0 && unchecked.length === 0 && <Empty>모두 처리됐습니다 👏</Empty>}
        </div>
      </div>
    </section>
  );
}
