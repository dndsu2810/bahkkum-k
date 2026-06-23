import { useEffect, useMemo, useState } from "react";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { listUsers, type UserRow } from "../lib/authApi";
import { ROLE_LABEL } from "../lib/roles";
import { DOW_ORDER } from "../lib/dates";
import { todayApi, type TodayRecord } from "../lib/adminApi";
import { useAuth } from "../auth";
import { ProfileModal } from "./StudentMaster";

type Tab = "today" | "timetable" | "students" | "accounts";

interface TtLesson { studentId: string; name: string; subject: "math" | "english"; day: string; time: string; duration: number }

const timeKey = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const fmtTime = (t: string): string => {
  const [h, m] = t.split(":");
  return `${h}:${(m || "00").padStart(2, "0")}`;
};

/** 데스크 화면 — 전체 시간표(수학 기준) · 학생 조회 · 강사 계정 리스트. 운영 보조용 조회 중심. */
export function Desk({ tab: initialTab }: { tab?: Tab } = {}) {
  const { user } = useAuth();
  const canEdit = !!user && user.role !== "student";
  const [tab, setTab] = useState<Tab>(initialTab || "today");
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [tt, setTt] = useState<TtLesson[]>([]);
  const [today, setToday] = useState<{ date: string; records: TodayRecord[] } | null>(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const openStudent = roster.find((r) => r.id === openId) || null;
  const applyLocal = (next: RosterStudent) => setRoster((cur) => cur.map((r) => (r.id === next.id ? next : r)));

  useEffect(() => {
    getRoster().then(setRoster).catch(() => setErr("명단을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."));
    listUsers().then(setUsers).catch(() => {});
    todayApi.list().then(setToday).catch(() => {});
    fetch("/api/timetable", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { lessons: [] }))
      .then((j) => setTt((j.lessons as TtLesson[]) || []))
      .catch(() => {});
  }, []);

  // 요일별로 '같은 시간대'를 묶어서 한 줄에 모아 보여준다(수학·영어 통합).
  const byDay = useMemo(() => {
    const map: Record<string, Record<string, { studentId: string; name: string; subject: string }[]>> = {};
    for (const d of DOW_ORDER) map[d] = {};
    for (const l of tt) {
      (map[l.day] ||= {});
      (map[l.day][l.time] ||= []).push({ studentId: l.studentId, name: l.name, subject: l.subject });
    }
    const out: Record<string, { time: string; people: { studentId: string; name: string; subject: string }[] }[]> = {};
    for (const d of DOW_ORDER) {
      out[d] = Object.keys(map[d] || {})
        .sort((a, b) => timeKey(a) - timeKey(b))
        .map((time) => ({ time, people: map[d][time] }));
    }
    return out;
  }, [tt]);

  return (
    <div className="desk">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">데스크</h1>
          <p className="sm-desc">운영·안내 보조용 조회 화면입니다.</p>
        </div>
      </div>

      <div className="desk-tabs">
        {([
          ["today", "오늘"],
          ["timetable", "전체 시간표"],
          ["students", "학생 정보"],
          ["accounts", "강사 계정"],
        ] as [Tab, string][]).map(([k, label]) => (
          <button key={k} className={"sm-fchip" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}

      {tab === "today" && <DeskToday today={today} />}

      {tab === "timetable" && (
        <>
          <p className="hub-muted" style={{ marginBottom: 10 }}>
            수학·영어 통합 시간표입니다. <span className="tt-dot math" /> 수학 <span className="tt-dot eng" /> 영어
          </p>
          <div className="desk-tt">
            {DOW_ORDER.filter((d) => (d !== "토" && d !== "일") || (byDay[d] || []).length > 0).map((d) => (
              <div className="desk-tt-col" key={d}>
                <div className="desk-tt-h">{d}</div>
                {(byDay[d] || []).map((slot, i) => (
                  <div className="desk-tt-row" key={i}>
                    <span className="desk-tt-time">{fmtTime(slot.time)}</span>
                    <span className="desk-tt-names">
                      {slot.people.map((p, j) => {
                        const cls = "desk-tt-name " + (p.subject === "english" ? "eng" : "math");
                        return roster.some((r) => r.id === p.studentId) ? (
                          <button type="button" className={cls + " is-link"} key={j} onClick={() => setOpenId(p.studentId)} title="학생 정보 보기">{p.name}</button>
                        ) : (
                          <span className={cls} key={j}>{p.name}</span>
                        );
                      })}
                    </span>
                  </div>
                ))}
                {(byDay[d] || []).length === 0 && <div className="board2-empty">—</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "students" && (
        <div className="sm-table-wrap">
          <table className="sm-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>학년</th>
                <th>상태</th>
                <th>학교</th>
                <th>학부모 연락처</th>
                <th>학생 연락처</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((s) => (
                <tr key={s.id}>
                  <td className="sm-name">{s.name}</td>
                  <td>{s.grade || "—"}</td>
                  <td><span className={"sm-st sm-st-" + (s.status === "재원" ? "on" : "off")}>{s.status || "—"}</span></td>
                  <td className="sm-dim">{s.school || "—"}</td>
                  <td className="sm-dim">{s.parentPhone || "—"}</td>
                  <td className="sm-dim">{s.studentPhone || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "accounts" && (
        <>
          <div className="acct-list">
            {users.map((u) => (
              <div className="acct-row" key={u.id}>
                <span className="nm">{u.name}</span>
                <span className="rl">{ROLE_LABEL[u.role]}</span>
              </div>
            ))}
            {users.length === 0 && <div className="hub-muted">계정이 없어요.</div>}
          </div>
          <p className="hub-muted" style={{ marginTop: 10 }}>
            비밀번호는 보안상 표시되지 않습니다. 계정 추가·비번 변경은 원장 설정에서 합니다.
          </p>
        </>
      )}

      {openStudent && (
        <ProfileModal key={openStudent.id} student={openStudent} canEdit={canEdit} onClose={() => setOpenId(null)} onSaved={applyLocal} />
      )}
    </div>
  );
}

/* ---------------- 데스크 오늘 — 등원·지각 한눈에 ---------------- */
function DeskToday({ today }: { today: { date: string; records: TodayRecord[] } | null }) {
  if (!today) return <div className="hub-muted">불러오는 중…</div>;
  const recs = today.records;
  const present = recs.filter((r) => r.status === "출석" || r.status === "지각" || r.status === "등원");
  const late = recs.filter((r) => r.status === "지각");
  const absent = recs.filter((r) => r.status === "결석");
  const subjLabel = (s: string) => (s === "english" ? "영어" : "수학");
  return (
    <div className="desk-today">
      <p className="hub-muted" style={{ marginBottom: 12 }}>{today.date} 기준 · 강사들이 기록한 출결이 자동으로 모입니다.</p>
      <div className="dash-kpis">
        <div className="kpi"><div className="kpi-v">{present.length}<span className="kpi-u">명</span></div><div className="kpi-l">현재 등원</div></div>
        <div className="kpi"><div className="kpi-v" style={{ color: "var(--warn)" }}>{late.length}<span className="kpi-u">명</span></div><div className="kpi-l">지각</div></div>
        <div className="kpi"><div className="kpi-v" style={{ color: "var(--bad)" }}>{absent.length}<span className="kpi-u">명</span></div><div className="kpi-l">결석</div></div>
      </div>

      {late.length > 0 && (
        <section className="card dash-card" style={{ marginTop: 14 }}>
          <h3 className="dash-h">지각</h3>
          <div className="desk-today-chips">
            {late.map((r, i) => (
              <span className="desk-today-chip late" key={i}>{r.name}<span className="dt-meta">{subjLabel(r.subject)}{r.late ? ` · ${r.late}분` : ""}</span></span>
            ))}
          </div>
        </section>
      )}

      <section className="card dash-card" style={{ marginTop: 14 }}>
        <h3 className="dash-h">등원 학생 {present.length}명</h3>
        {present.length === 0 ? (
          <div className="hub-muted">아직 등원 기록이 없어요.</div>
        ) : (
          <div className="desk-today-chips">
            {present.map((r, i) => (
              <span className={"desk-today-chip" + (r.status === "지각" ? " late" : "")} key={i}>{r.name}<span className="dt-meta">{subjLabel(r.subject)}{r.time ? ` · ${r.time}` : ""}</span></span>
            ))}
          </div>
        )}
      </section>

      {absent.length > 0 && (
        <section className="card dash-card" style={{ marginTop: 14 }}>
          <h3 className="dash-h">결석</h3>
          <div className="desk-today-chips">
            {absent.map((r, i) => <span className="desk-today-chip absent" key={i}>{r.name}<span className="dt-meta">{subjLabel(r.subject)}</span></span>)}
          </div>
        </section>
      )}
    </div>
  );
}
