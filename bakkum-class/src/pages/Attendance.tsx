import { Fragment, useRef, useState } from "react";
import { useStore } from "../store";
import type { AttStatus, Attitude, Student } from "../types";
import { DOW, fmtDayBand, parseD, timeToMin, todayStr } from "../lib/dates";
import {
  activeStudents,
  attendsOn,
  curMonthStr,
  effectiveLessons,
  inMonth,
  monthOptions,
  studentById,
} from "../lib/logic";
import { NEEDS_MAKEUP, applyMakeup } from "../lib/attendanceLogic";
import { holidayName } from "../lib/holidays";
import { awardPoints, pushAttendanceNotion } from "../api";
import { GradeBadge, Empty, Select, TodayLink } from "../components/ui";

interface LessonOnDate {
  student: Student;
  time: string;
  duration: number;
}

// 자주 쓰는 3개는 크게 항상 노출, 나머지는 '더보기'로 접는다.
const ATT_MAIN: AttStatus[] = ["출석", "지각", "결석"];
const ATT_MORE: AttStatus[] = ["조퇴", "무단결석", "보강"];
const TONE: Record<AttStatus, string> = {
  출석: "green",
  지각: "orange",
  결석: "red",
  조퇴: "orange",
  무단결석: "red",
  보강: "purple",
};
const ATTITUDES: Attitude[] = ["매우좋음", "보통", "미흡"];

function lessonsOnDate(students: Student[], dateStr: string): LessonOnDate[] {
  // 공휴일(빨간날)은 휴원 — 수업 없음
  if (holidayName(dateStr)) return [];
  const d = parseD(dateStr);
  const dow = DOW[d.getDay()];
  const list: LessonOnDate[] = [];
  activeStudents(students).forEach((s) => {
    // 첫 등원일(등록일) 이전에는 출결에 표시하지 않음
    if (!attendsOn(s, dateStr)) return;
    // 그 날짜에 유효한 시간표(버전) 사용
    effectiveLessons(s, dateStr).forEach((l) => {
      if (l.day === dow) list.push({ student: s, time: l.time, duration: l.duration });
    });
  });
  list.sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
  return list;
}

const REC_TONE: Record<string, string> = {
  출석: "b-green",
  지각: "b-orange",
  결석: "b-red",
  조퇴: "b-orange",
  무단결석: "b-red",
  보강: "b-purple",
};

export function Attendance() {
  const { data, mutate, toast } = useStore();
  const [attDate, setAttDate] = useState(todayStr());
  const [recMonth, setRecMonth] = useState(curMonthStr());
  // 줄별 '더보기'(조퇴/무단결석/보강) 펼침 — 펼친 줄의 att-key
  const [moreKey, setMoreKey] = useState<string | null>(null);
  // 키보드 단축키용 행 참조 (Enter로 다음 학생 이동) (A-7)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const holiday = holidayName(attDate);
  const lessons = lessonsOnDate(data.students, attDate);

  // 출결 기록(월별) — 라이브 체크분 + 노션에서 가져온 기록 모두 포함
  const recordRows = Object.keys(data.attendance)
    .map((key) => {
      const parts = key.split("|");
      return { key, date: parts[0], sid: parts[1], time: parts[2] || "", rec: data.attendance[key] };
    })
    .filter((r) => inMonth(r.date, recMonth))
    .sort((a, b) => (a.date === b.date ? (a.time < b.time ? -1 : 1) : a.date < b.date ? 1 : -1));

  // 날짜별 그룹 (커스텀 테이블도 InlineTable과 동일한 '날짜 띠' 형태로)
  const recordGroups: { date: string; rows: typeof recordRows }[] = (() => {
    const groups: { date: string; rows: typeof recordRows }[] = [];
    const idx = new Map<string, number>();
    for (const r of recordRows) {
      let i = idx.get(r.date);
      if (i === undefined) { i = groups.length; idx.set(r.date, i); groups.push({ date: r.date, rows: [] }); }
      groups[i].rows.push(r);
    }
    return groups;
  })();

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

  async function setStatus(it: LessonOnDate, key: string, opt: AttStatus) {
    const prev = data.attendance[key];
    const prevAwarded = prev?.pointsAwarded === true;
    // 이미 선택된 상태를 다시 누르면 선택 취소(기록 삭제)
    const clearing = prev?.status === opt;
    const newStatus = clearing ? null : opt;
    const willAward = newStatus === "출석";

    // optimistic record + makeup update
    mutate((draft) => {
      if (clearing) {
        delete draft.attendance[key];
        // 자동으로 등록됐던 '보강 대기'도 함께 제거
        draft.makeups = draft.makeups.filter((m) => !(m.attKey === key && m.status === "pending"));
        if (draft.dismissedMakeups?.length) draft.dismissedMakeups = draft.dismissedMakeups.filter((k) => k !== key);
        return;
      }
      const cur = draft.attendance[key];
      const rec = cur ? { ...cur } : { status: opt };
      rec.status = opt;
      if (opt !== "지각") rec.lateMinutes = undefined;
      rec.pointsAwarded = prevAwarded;
      draft.attendance[key] = rec;
      applyMakeup(draft, key, it.student.id, it.duration, opt);
    });

    // 출결 → 노션 자동 저장(앱→노션 단방향). 취소(clearing)는 보내지 않음.
    pushAttendanceNotion(it.student.id, {
      date: attDate,
      status: opt,
      attitude: prev?.attitude || "",
      lateMinutes: opt === "지각" ? prev?.lateMinutes || 0 : 0,
      note: prev?.note || "",
    });

    // point side-effect (remote only; awarded by roster id)
    if (!prevAwarded && willAward) {
      const res = await awardPoints(it.student.id, 20, "출석");
      mutate((draft) => {
        const r = draft.attendance[key];
        if (r) r.pointsAwarded = res.matched;
      });
      toast(res.matched ? "출석 처리 · 포인트 적립" : "출석 처리 (포인트 미적립 학생)");
    } else if (prevAwarded && !willAward) {
      await awardPoints(it.student.id, -20, "출석 취소");
      mutate((draft) => {
        const r = draft.attendance[key];
        if (r) r.pointsAwarded = false;
      });
      toast(
        clearing
          ? "출결 선택을 취소했어요 · 포인트 회수"
          : NEEDS_MAKEUP.includes(opt)
            ? opt + " 처리 · 보강 대기 등록 · 포인트 회수"
            : opt + " 처리 · 포인트 회수"
      );
    } else {
      toast(
        clearing
          ? "출결 선택을 취소했어요."
          : NEEDS_MAKEUP.includes(opt)
            ? opt + " 처리 · 보강 대기에 추가했어요."
            : opt + " 처리했어요."
      );
    }
  }

  function patchRecord(key: string, patch: Partial<{ lateMinutes: number; attitude: Attitude; note: string }>) {
    let snap: { status: AttStatus; attitude?: Attitude | ""; note?: string; lateMinutes?: number } | null = null;
    mutate((draft) => {
      const r = draft.attendance[key];
      if (r) {
        Object.assign(r, patch);
        snap = { status: r.status, attitude: r.attitude, note: r.note, lateMinutes: r.lateMinutes };
      }
    });
    // 수업태도/지각분/특이사항 변경도 노션에 반영(같은 학생·날짜 행 갱신).
    if (snap) {
      const s = snap as { status: AttStatus; attitude?: Attitude | ""; note?: string; lateMinutes?: number };
      const [date, sid] = key.split("|");
      pushAttendanceNotion(sid, {
        date,
        status: s.status,
        attitude: s.attitude || "",
        lateMinutes: s.lateMinutes || 0,
        note: s.note || "",
      });
    }
  }

  // 행 포커스 상태에서 1=출석 2=지각 3=결석, Enter=다음 학생 (A-7)
  function onRowKey(e: React.KeyboardEvent, it: LessonOnDate, key: string, idx: number) {
    const map: Record<string, AttStatus> = { "1": "출석", "2": "지각", "3": "결석" };
    if (map[e.key]) {
      e.preventDefault();
      setStatus(it, key, map[e.key]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      rowRefs.current[idx + 1]?.focus();
    }
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">출결 기록</h1>
          <div className="page-desc">
            출석 체크는 <TodayLink /> 화면에서 빠르게, 여기선 날짜별 출결 기록을 모아 보고 수정해요.
            {holiday ? " · " + holiday + " (공휴일·휴원)" : ""}
          </div>
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
          <div className="empty">
            {holiday ? holiday + " — 공휴일이라 휴원입니다." : "이 날에는 예정된 수업이 없습니다."}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">오늘 수업 {lessons.length}건</div>
              <div className="card-sub">
                출석 {counts.출석} · 지각 {counts.지각} · 결석/조퇴 {counts.결석류} · 미체크 {unchecked}
                <span className="kbd-hint"> · 행 선택 후 <kbd>1</kbd> 출석 <kbd>2</kbd> 지각 <kbd>3</kbd> 결석 <kbd>↵</kbd> 다음</span>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            {lessons.map((it, idx) => {
              const s = it.student;
              const key = attDate + "|" + s.id + "|" + it.time;
              const rec = data.attendance[key];
              const st = rec?.status;
              const missing = st === "결석" || st === "무단결석";
              return (
                <div key={key}>
                  <div
                    className={"att-row" + (missing ? " is-absent" : "")}
                    tabIndex={0}
                    ref={(el) => { rowRefs.current[idx] = el; }}
                    onKeyDown={(e) => onRowKey(e, it, key, idx)}
                  >
                    <div className="att-time">{it.time}</div>
                    <div className="att-stu">
                      <div>
                        <div style={{ fontWeight: 700 }}>
                          {s.name} <GradeBadge grade={s.grade} />
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--text3)", fontWeight: 600 }}>
                          {it.duration}분 수업
                        </div>
                        {NEEDS_MAKEUP.includes(st as AttStatus) && (
                          <div className="att-note">{st} · 보강 대기로 등록됨</div>
                        )}
                      </div>
                    </div>
                    {(() => {
                      // 조퇴/무단결석/보강이 선택돼 있으면 항상 펼쳐 보이게.
                      const forced = !!st && ATT_MORE.includes(st as AttStatus);
                      const open = forced || moreKey === key;
                      return (
                        <div className="att-segwrap">
                          <div className="att-seg">
                            {ATT_MAIN.map((opt) => (
                              <button
                                key={opt}
                                className={st === opt ? "on t-" + TONE[opt] : ""}
                                onClick={() => setStatus(it, key, opt)}
                              >
                                {opt}
                              </button>
                            ))}
                            {open &&
                              ATT_MORE.map((opt) => (
                                <button
                                  key={opt}
                                  className={st === opt ? "on t-" + TONE[opt] : ""}
                                  onClick={() => setStatus(it, key, opt)}
                                >
                                  {opt}
                                </button>
                              ))}
                          </div>
                          {!forced && (
                            <button
                              className="att-more"
                              onClick={() => setMoreKey(moreKey === key ? null : key)}
                            >
                              {open ? "접기" : "⋯ 더보기"}
                            </button>
                          )}
                        </div>
                      );
                    })()}
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

      {/* 출결 기록 (월별 조회 · 노션 가져오기 포함) */}
      <div className="card sec-gap">
        <div className="card-head">
          <div>
            <div className="card-title">출결 기록</div>
            <div className="card-sub">{recordRows.length}건 · 직접 체크한 기록과 노션에서 가져온 기록</div>
          </div>
          <Select value={recMonth} onChange={setRecMonth} options={monthOptions()} />
        </div>
        {recordRows.length === 0 ? (
          <Empty>아직 출결 기록이 없어요. <TodayLink /> 화면에서 입력하면 여기에 쌓여요.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl tbl-grouped">
              <thead>
                <tr>
                  <th>학생</th>
                  <th>출결</th>
                  <th>수업태도</th>
                  <th>특이사항</th>
                </tr>
              </thead>
              <tbody>
                {recordGroups.map((g) => (
                  <Fragment key={g.date}>
                    <tr className="tbl-grouprow">
                      <td colSpan={4}>
                        <div className="tbl-band">
                          <span className="tbl-band-date">{fmtDayBand(g.date)}</span>
                          <span className="tbl-band-cnt">{g.rows.length}건</span>
                        </div>
                      </td>
                    </tr>
                    {g.rows.map((r) => {
                      const s = studentById(data.students, r.sid);
                      return (
                        <tr key={r.key}>
                          <td style={{ fontWeight: 700, color: "var(--text)" }}>{s ? s.name : "(삭제된 학생)"}</td>
                          <td>
                            <span className={"badge " + (REC_TONE[r.rec.status] || "b-gray")}>
                              {r.rec.status}
                              {r.rec.status === "지각" && r.rec.lateMinutes ? ` ${r.rec.lateMinutes}분` : ""}
                            </span>
                          </td>
                          <td className="muted">{r.rec.attitude || "—"}</td>
                          <td className="muted">{r.rec.note || "—"}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
