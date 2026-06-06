import { useState } from "react";
import { useStore } from "../store";
import type { AttStatus, Attitude, DataSnapshot, Student } from "../types";
import { DOW, fmtFull, parseD, timeToMin, todayStr, uid } from "../lib/dates";
import { activeStudents } from "../lib/logic";
import { awardPoints } from "../api";
import { Avatar, GradeBadge } from "../components/ui";

interface LessonOnDate {
  student: Student;
  time: string;
  duration: number;
}

const ATT_OPTIONS: AttStatus[] = ["출석", "지각", "결석", "조퇴", "무단결석", "보강"];
const TONE: Record<AttStatus, string> = {
  출석: "green",
  지각: "orange",
  결석: "red",
  조퇴: "orange",
  무단결석: "red",
  보강: "purple",
};
const ATTITUDES: Attitude[] = ["매우좋음", "보통", "미흡"];
/** statuses that auto-register a 보강 대기 */
const NEEDS_MAKEUP: AttStatus[] = ["결석", "무단결석", "조퇴"];

function lessonsOnDate(students: Student[], dateStr: string): LessonOnDate[] {
  const d = parseD(dateStr);
  const dow = DOW[d.getDay()];
  const list: LessonOnDate[] = [];
  activeStudents(students).forEach((s) =>
    (s.lessons || []).forEach((l) => {
      if (l.day === dow) list.push({ student: s, time: l.time, duration: l.duration });
    })
  );
  list.sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
  return list;
}

function applyMakeup(d: DataSnapshot, key: string, it: LessonOnDate, status: AttStatus) {
  const [date, , time] = key.split("|");
  const existing = d.makeups.find((m) => m.attKey === key);
  if (NEEDS_MAKEUP.includes(status)) {
    if (!existing) {
      d.makeups.push({
        id: uid(),
        studentId: it.student.id,
        absentDate: date,
        absentTime: time,
        absentDuration: it.duration,
        attKey: key,
        status: "pending",
        makeupDate: "",
        makeupTime: "",
        makeupDuration: it.duration,
        parentContacted: false,
        memo: status === "결석" ? "" : status, // 무단결석/조퇴 reason carried into memo
        createdAt: Date.now(),
      });
    }
  } else if (existing && existing.status === "pending") {
    d.makeups = d.makeups.filter((m) => m.attKey !== key);
  }
}

export function Attendance() {
  const { data, mutate, toast } = useStore();
  const [attDate, setAttDate] = useState(todayStr());

  const d = parseD(attDate);
  const lessons = lessonsOnDate(data.students, attDate);

  const counts = { 출석: 0, 지각: 0, 결석류: 0, checked: 0 };
  lessons.forEach((it) => {
    const r = data.attendance[attDate + "|" + it.student.id + "|" + it.time];
    if (!r) return;
    counts.checked++;
    if (r.status === "출석") counts.출석++;
    else if (r.status === "지각") counts.지각++;
    else if (r.status === "결석" || r.status === "무단결석" || r.status === "조퇴") counts.결석류++;
  });
  const unchecked = lessons.length - counts.checked;

  async function setStatus(it: LessonOnDate, key: string, newStatus: AttStatus) {
    const prev = data.attendance[key];
    const prevAwarded = prev?.pointsAwarded === true;
    const willAward = newStatus === "출석";

    // optimistic record + makeup update
    mutate((draft) => {
      const cur = draft.attendance[key];
      const rec = cur ? { ...cur } : { status: newStatus };
      rec.status = newStatus;
      if (newStatus !== "지각") rec.lateMinutes = undefined;
      rec.pointsAwarded = prevAwarded;
      draft.attendance[key] = rec;
      applyMakeup(draft, key, it, newStatus);
    });

    // mogakgong point side-effect (remote only; matched by name)
    if (!prevAwarded && willAward) {
      const res = await awardPoints(it.student.name, 20, "출석");
      mutate((draft) => {
        const r = draft.attendance[key];
        if (r) r.pointsAwarded = res.matched;
      });
      toast(res.matched ? "출석 · 포인트 +20" : "출석 처리 (모각공 미등록 학생 — 포인트 건너뜀)");
    } else if (prevAwarded && !willAward) {
      await awardPoints(it.student.name, -20, "출석 취소");
      mutate((draft) => {
        const r = draft.attendance[key];
        if (r) r.pointsAwarded = false;
      });
      toast(
        NEEDS_MAKEUP.includes(newStatus)
          ? newStatus + " 처리 · 보강 대기 등록 · 포인트 -20 회수"
          : newStatus + " 처리 · 포인트 -20 회수"
      );
    } else {
      toast(
        NEEDS_MAKEUP.includes(newStatus)
          ? newStatus + " 처리 · 보강 대기에 추가했어요."
          : newStatus + " 처리했어요."
      );
    }
  }

  function patchRecord(key: string, patch: Partial<{ lateMinutes: number; attitude: Attitude; note: string }>) {
    mutate((draft) => {
      const r = draft.attendance[key];
      if (r) Object.assign(r, patch);
    });
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <div className="page-title">출결 체크</div>
          <div className="page-desc">{fmtFull(d)} · 출석 시 모각공 포인트 +20 자동 적립</div>
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
                출석 {counts.출석} · 지각 {counts.지각} · 결석/조퇴 {counts.결석류} · 미체크 {unchecked}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            {lessons.map((it) => {
              const s = it.student;
              const key = attDate + "|" + s.id + "|" + it.time;
              const rec = data.attendance[key];
              const st = rec?.status;
              const missing = st === "결석" || st === "무단결석";
              return (
                <div key={key}>
                  <div className={"att-row" + (missing ? " is-absent" : "")}>
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
                        {NEEDS_MAKEUP.includes(st as AttStatus) && (
                          <div className="att-note">{st} · 보강 대기로 등록됨</div>
                        )}
                      </div>
                    </div>
                    <div className="att-seg">
                      {ATT_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          className={st === opt ? "on t-" + TONE[opt] : ""}
                          onClick={() => setStatus(it, key, opt)}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {rec && (
                    <div className="att-extra">
                      {st === "지각" && (
                        <span className="att-extra-item">
                          <span className="mini-label">지각</span>
                          <input
                            className="mini-num"
                            type="number"
                            min={0}
                            step={5}
                            placeholder="분"
                            value={rec.lateMinutes ?? ""}
                            onChange={(e) =>
                              patchRecord(key, { lateMinutes: +e.target.value || 0 })
                            }
                          />
                          <span className="mini-label">분</span>
                        </span>
                      )}
                      <span className="att-extra-item">
                        <span className="mini-label">수업태도</span>
                        <span className="mini-seg">
                          {ATTITUDES.map((a) => (
                            <button
                              key={a}
                              className={rec.attitude === a ? "on" : ""}
                              onClick={() => patchRecord(key, { attitude: a })}
                            >
                              {a}
                            </button>
                          ))}
                        </span>
                      </span>
                      <input
                        className="mini-note"
                        placeholder="특이사항 (선택)"
                        value={rec.note ?? ""}
                        onChange={(e) => patchRecord(key, { note: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
