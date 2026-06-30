import { useEffect, useMemo, useState } from "react";
import { DOW_ORDER, TODAY, fmtMD, mondayOf, ymd } from "../lib/dates";
import { useAuth } from "../auth";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { ProfileModal } from "./StudentMaster";

/** 전체 시간표(공통) — 수학·영어 통합, 학생 이름 전체 표시. 데스크 전용이던 화면을 모든 스태프 공통으로.
 *  학생 이름을 누르면 학생 정보 프로필(수정 가능)을 띄운다. */
interface TtLesson { studentId: string; name: string; subject: "math" | "english"; day: string; time: string; duration: number }
interface TtPerson { studentId: string; name: string; subject: string }

const timeKey = (t: string): number => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const fmtTime = (t: string): string => { const [h, m] = t.split(":"); return `${h}:${(m || "00").padStart(2, "0")}`; };

export function TimetableAll() {
  const { user } = useAuth();
  const canEdit = !!user && user.role !== "student"; // 전 스태프 편집 가능(학생 화면 제외)
  const [tt, setTt] = useState<TtLesson[]>([]);
  const [err, setErr] = useState("");
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0); // 0=이번주. 미래 적용일(예: 7/1) 시간표 미리보기.
  const [filterId, setFilterId] = useState("all"); // "all" 또는 학생 id — 한 학생만 보기.

  // 주차 선택 시 그 주 월요일 기준으로 다시 조회. 이번주(0)는 날짜 없이=라이브와 동일.
  useEffect(() => {
    const mon = mondayOf(TODAY, weekOffset);
    const qs = weekOffset === 0 ? "" : "?date=" + ymd(mon);
    fetch("/api/timetable" + qs, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { lessons: [] }))
      .then((j) => { setTt((j.lessons as TtLesson[]) || []); setErr(""); })
      .catch(() => setErr("시간표를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."));
  }, [weekOffset]);
  useEffect(() => {
    getRoster().then(setRoster).catch(() => { /* 명단 없으면 이름은 보이되 클릭만 비활성 */ });
  }, []);

  // 학생별 필터 옵션 — 재원생 명단 기준(주가 바뀌어도 선택 유지). 명단 못 받으면 현재 주 시간표에서 추출.
  const students = useMemo(() => {
    const active = roster.filter((r) => r.status === "재원");
    if (active.length) return active.map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
    const map = new Map<string, string>();
    for (const l of tt) map.set(l.studentId, l.name);
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [roster, tt]);
  const shown = useMemo(() => (filterId === "all" ? tt : tt.filter((l) => l.studentId === filterId)), [tt, filterId]);
  const mon = mondayOf(TODAY, weekOffset);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const weekLabel = weekOffset === 0 ? "이번 주" : weekOffset === 1 ? "다음 주" : weekOffset === -1 ? "지난 주" : `${fmtMD(mon)}~${fmtMD(sun)}`;

  // 요일별로 같은 시간대를 묶어 한 줄에(수학·영어 통합).
  const byDay = useMemo(() => {
    const map: Record<string, Record<string, TtPerson[]>> = {};
    for (const d of DOW_ORDER) map[d] = {};
    for (const l of shown) {
      (map[l.day] ||= {});
      (map[l.day][l.time] ||= []).push({ studentId: l.studentId, name: l.name, subject: l.subject });
    }
    const out: Record<string, { time: string; people: TtPerson[] }[]> = {};
    for (const d of DOW_ORDER) {
      out[d] = Object.keys(map[d] || {}).sort((a, b) => timeKey(a) - timeKey(b)).map((time) => ({ time, people: map[d][time] }));
    }
    return out;
  }, [shown]);

  const openStudent = roster.find((r) => r.id === openId) || null;
  // 저장 후 로컬 명단 갱신(다음 열람에 반영).
  function applyLocal(next: RosterStudent) {
    setRoster((cur) => cur.map((r) => (r.id === next.id ? next : r)));
  }

  return (
    <div className="sm-wrap">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">전체 시간표</h1>
          <p className="sm-desc">수학·영어 통합 시간표입니다. 학생 이름을 누르면 정보를 보고 수정할 수 있어요.</p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <div className="sp-week">
          <button className="sp-week-arr" onClick={() => setWeekOffset((w) => w - 1)} aria-label="이전 주">‹</button>
          <span className="sp-week-lbl">{weekLabel}</span>
          <button className="sp-week-arr" onClick={() => setWeekOffset((w) => w + 1)} aria-label="다음 주">›</button>
        </div>
        <select className="inline-select" value={filterId} onChange={(e) => setFilterId(e.target.value)} aria-label="학생 선택">
          <option value="all">전체 학생</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {weekOffset !== 0 && <span className="hub-muted" style={{ fontSize: "var(--t-cap)" }}>적용일 예약 시간표가 있으면 그 주 기준으로 보여요.</span>}
      </div>
      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
      <p className="hub-muted" style={{ marginBottom: 10 }}>
        <span className="tt-dot math" /> 수학 <span className="tt-dot eng" /> 영어
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
                    const known = roster.some((r) => r.id === p.studentId);
                    return known ? (
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

      {openStudent && (
        <ProfileModal
          key={openStudent.id}
          student={openStudent}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onSaved={applyLocal}
        />
      )}
    </div>
  );
}
