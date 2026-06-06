import { useStore } from "../store";
import type { AttStatus, Student } from "../types";
import { DOW, TODAY, fmtFull, timeToMin, todayStr } from "../lib/dates";
import { activeStudents, mkStatus, studentById } from "../lib/logic";
import { applyMakeup } from "../lib/attendanceLogic";
import { awardPoints } from "../api";
import { Avatar, GradeBadge, Empty } from "../components/ui";
import { HomeworkModal, ProgressModal } from "../components/modals";
import { Icon } from "../icons";

interface LessonOnDate {
  student: Student;
  time: string;
  duration: number;
}

const QUICK: { s: AttStatus; cls: string }[] = [
  { s: "출석", cls: "on-present" },
  { s: "지각", cls: "" },
  { s: "결석", cls: "on-absent" },
];

export function Today() {
  const { data, mutate, toast, openModal } = useStore();
  const day = todayStr();
  const dow = DOW[TODAY.getDay()];

  const lessons: LessonOnDate[] = [];
  activeStudents(data.students).forEach((s) =>
    (s.lessons || []).forEach((l) => {
      if (l.day === dow) lessons.push({ student: s, time: l.time, duration: l.duration });
    })
  );
  lessons.sort((a, b) => timeToMin(a.time) - timeToMin(b.time));

  const keyOf = (it: LessonOnDate) => day + "|" + it.student.id + "|" + it.time;
  const unchecked = lessons.filter((it) => !data.attendance[keyOf(it)]);

  const dueHw = data.homeworkLog.filter((h) => h.date === day);
  const makeupsToday = data.makeups.filter((k) => mkStatus(k) === "scheduled" && k.makeupDate === day);

  async function mark(it: LessonOnDate, status: AttStatus) {
    const key = keyOf(it);
    const prev = data.attendance[key];
    const prevAwarded = prev?.pointsAwarded === true;
    const willAward = status === "출석";
    mutate((d) => {
      const cur = d.attendance[key];
      d.attendance[key] = { ...(cur || {}), status, pointsAwarded: prevAwarded };
      applyMakeup(d, key, it.student.id, it.duration, status);
    });
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
    toast(it.student.name + " · " + status);
  }

  function toggleHwDone(id: string) {
    mutate((d) => {
      const h = d.homeworkLog.find((x) => x.id === id);
      if (h) h.status = h.status === "done" ? "pending" : "done";
    });
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <div className="page-title">오늘</div>
          <div className="page-desc">{fmtFull(TODAY)} · 한 화면에서 출결·숙제·진도를 빠르게</div>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi"><div className="kpi-top"><span className="kpi-label">오늘 수업</span></div><div className="kpi-num">{lessons.length}<span className="kpi-unit">건</span></div></div>
        <div className="kpi"><div className="kpi-top"><span className="kpi-label">출결 미체크</span></div><div className="kpi-num">{unchecked.length}<span className="kpi-unit">명</span></div></div>
        <div className="kpi"><div className="kpi-top"><span className="kpi-label">검사할 숙제</span></div><div className="kpi-num">{dueHw.length}<span className="kpi-unit">건</span></div></div>
        <div className="kpi"><div className="kpi-top"><span className="kpi-label">보강 예정</span></div><div className="kpi-num">{makeupsToday.length}<span className="kpi-unit">건</span></div></div>
      </div>

      {/* 오늘 등원 학생 + 빠른 입력 */}
      <div className="card sec-gap">
        <div className="card-head"><div><div className="card-title">오늘 등원 학생</div><div className="card-sub">출결을 찍고, 숙제·진도를 바로 기록하세요</div></div></div>
        <div style={{ marginTop: 6 }}>
          {lessons.length === 0 ? (
            <Empty>오늘은 예정된 수업이 없습니다.</Empty>
          ) : (
            lessons.map((it) => {
              const s = it.student;
              const st = data.attendance[keyOf(it)]?.status;
              return (
                <div className="att-row" key={keyOf(it)}>
                  <div className="att-time">{it.time}</div>
                  <div className="att-stu">
                    <Avatar name={s.name} grade={s.grade} />
                    <div>
                      <div style={{ fontWeight: 700 }}>{s.name} <GradeBadge grade={s.grade} /></div>
                      <div style={{ fontSize: "11.5px", color: "var(--text3)", fontWeight: 600 }}>
                        {it.duration}분{st ? " · " + st : " · 미체크"}
                      </div>
                    </div>
                  </div>
                  <div className="mk-actions">
                    <div className="att-seg">
                      {QUICK.map((q) => (
                        <button key={q.s} className={st === q.s ? q.cls || "on-present" : ""} onClick={() => mark(it, q.s)}>
                          {q.s}
                        </button>
                      ))}
                    </div>
                    <button className="btn ghost sm" onClick={() => openModal(<HomeworkModal id={null} presetStudentId={s.id} />)}>
                      <Icon name="book" />숙제
                    </button>
                    <button className="btn ghost sm" onClick={() => openModal(<ProgressModal id={null} presetStudentId={s.id} />)}>
                      <Icon name="chart" />진도
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="grid-2">
        {/* 오늘 검사할 숙제 */}
        <div className="card">
          <div className="card-head"><div><div className="card-title">오늘 검사할 숙제</div><div className="card-sub">마감 {day}</div></div></div>
          {dueHw.length === 0 ? (
            <Empty>오늘 검사할 숙제가 없습니다.</Empty>
          ) : (
            <div className="mk-list">
              {dueHw.map((h) => {
                const s = studentById(data.students, h.studentId);
                return (
                  <div className="mk-item" key={h.id}>
                    <div className="mk-main">
                      <div className="mk-name">{s ? s.name : "?"} <span className={"badge " + (h.status === "done" ? "b-green" : h.status === "late" ? "b-orange" : "b-gray")}>{h.status === "done" ? "검사완료" : h.status === "late" ? "지연" : "검사 전"}</span></div>
                      <div className="mk-meta"><span>{h.book || "숙제"}{h.tags.length ? " · " + h.tags.join(", ") : ""} · {h.completion}%</span></div>
                    </div>
                    <div className="mk-actions">
                      <button className="btn ghost sm" onClick={() => toggleHwDone(h.id)}><Icon name="check" />검사</button>
                      <button className="btn ghost sm" onClick={() => openModal(<HomeworkModal id={h.id} />)}><Icon name="edit" />수정</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 오늘 보강 예정 + 미체크 */}
        <div className="card">
          <div className="card-head"><div><div className="card-title">오늘 보강 · 미체크</div><div className="card-sub">보강 {makeupsToday.length}건 · 미체크 {unchecked.length}명</div></div></div>
          <div className="mk-list">
            {makeupsToday.map((k) => {
              const s = studentById(data.students, k.studentId);
              return (
                <div className="mk-item" key={k.id}>
                  <span className="av av-blue av-lg">{(s ? s.name : "?").slice(-2)}</span>
                  <div className="mk-main">
                    <div className="mk-name">{s ? s.name : "?"} <span className="badge b-blue">보강</span></div>
                    <div className="mk-meta"><span>{k.makeupTime} · {k.makeupDuration}분</span></div>
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
      </div>
    </section>
  );
}
