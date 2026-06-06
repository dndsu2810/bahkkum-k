import { useState } from "react";
import { useStore } from "../store";
import type { Student } from "../types";
import { DOW, fmtFull, parseD, timeToMin, todayStr, uid } from "../lib/dates";
import { Avatar, GradeBadge } from "../components/ui";

interface LessonOnDate {
  student: Student;
  time: string;
  duration: number;
}

function lessonsOnDate(students: Student[], dateStr: string): LessonOnDate[] {
  const d = parseD(dateStr);
  const dow = DOW[d.getDay()];
  const list: LessonOnDate[] = [];
  students.forEach((s) =>
    (s.lessons || []).forEach((l) => {
      if (l.day === dow) list.push({ student: s, time: l.time, duration: l.duration });
    })
  );
  list.sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
  return list;
}

export function Attendance() {
  const { data, mutate, toast } = useStore();
  const [attDate, setAttDate] = useState(todayStr());

  const d = parseD(attDate);
  const lessons = lessonsOnDate(data.students, attDate);
  let present = 0;
  let absent = 0;
  lessons.forEach((it) => {
    const st = data.attendance[attDate + "|" + it.student.id + "|" + it.time];
    if (st === "present") present++;
    else if (st === "absent") absent++;
  });
  const unchecked = lessons.length - present - absent;

  function mark(key: string, status: "present" | "absent", dur: number) {
    mutate((draft) => {
      draft.attendance[key] = status;
      const parts = key.split("|");
      const date = parts[0];
      const sid = parts[1];
      const time = parts[2];
      const existing = draft.makeups.find((m) => m.attKey === key);
      if (status === "absent") {
        if (!existing) {
          draft.makeups.push({
            id: uid(),
            studentId: sid,
            absentDate: date,
            absentTime: time,
            absentDuration: dur,
            attKey: key,
            status: "pending",
            makeupDate: "",
            makeupTime: "",
            makeupDuration: dur,
            parentContacted: false,
            memo: "",
            createdAt: Date.now(),
          });
        }
      } else if (existing && existing.status === "pending") {
        draft.makeups = draft.makeups.filter((m) => m.attKey !== key);
      }
    });
    if (status === "absent") toast("결석 처리 · 보강 대기에 추가했어요.");
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <div className="page-title">출결 체크</div>
          <div className="page-desc">{fmtFull(d)} · 결석 처리하면 보강 관리에 자동 등록됩니다</div>
        </div>
        <div className="head-actions">
          <input
            className="input"
            type="date"
            value={attDate}
            onChange={(e) => setAttDate(e.target.value)}
            style={{ width: "auto", fontWeight: 600 }}
          />
        </div>
      </div>

      {!lessons.length ? (
        <div className="card">
          <div className="empty">이 날에는 예정된 수업이 없습니다.</div>
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">오늘 수업 {lessons.length}건</div>
              <div className="card-sub">
                출석 {present} · 결석 {absent} · 미체크 {unchecked}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            {lessons.map((it) => {
              const s = it.student;
              const key = attDate + "|" + s.id + "|" + it.time;
              const st = data.attendance[key];
              return (
                <div className={"att-row" + (st === "absent" ? " is-absent" : "")} key={key}>
                  <div className="att-time">{it.time}</div>
                  <div className="att-stu">
                    <Avatar name={s.name} grade={s.grade} />
                    <div>
                      <div style={{ fontWeight: 700 }}>
                        {s.name} <GradeBadge grade={s.grade} />
                      </div>
                      <div style={{ fontSize: "11.5px", color: "var(--text3)", fontWeight: 600 }}>
                        {it.duration}분 수업
                      </div>
                      {st === "absent" && <div className="att-note">결석 · 보강 대기로 등록됨</div>}
                    </div>
                  </div>
                  <div className="att-seg">
                    <button
                      className={st === "present" ? "on-present" : ""}
                      onClick={() => mark(key, "present", it.duration)}
                    >
                      출석
                    </button>
                    <button
                      className={st === "absent" ? "on-absent" : ""}
                      onClick={() => mark(key, "absent", it.duration)}
                    >
                      결석
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
