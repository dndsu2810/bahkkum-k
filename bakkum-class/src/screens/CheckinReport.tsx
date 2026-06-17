import { useEffect, useMemo, useState } from "react";
import { checkinApi, type CheckinRow } from "../lib/checkinApi";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { saveElementAsImage } from "../lib/reportImage";
import { Icon } from "../icons";

const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
const fmtH = (min: number) => { const h = Math.floor(min / 60); const m = min % 60; return h > 0 ? `${h}시간 ${m}분` : `${m}분`; };
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const todayYm = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
function shiftYm(ym: string, by: number) { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

interface DayAgg { date: string; in: number | null; out: number | null; subjects: string[] }

/** 학생별 수업시간 리포트 — 월말리포트처럼 보고서 카드로 보고 이미지 저장. 등하원 (라). */
export function CheckinReport() {
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [sel, setSel] = useState("");
  const [q, setQ] = useState("");
  const [hist, setHist] = useState<CheckinRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [ym, setYm] = useState(todayYm());
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { getRoster().then(setRoster).catch(() => {}); }, []);
  useEffect(() => {
    if (!sel) { setHist([]); return; }
    setLoading(true); setMemo("");
    checkinApi.student(sel).then((r) => setHist(r.history)).catch(() => {}).finally(() => setLoading(false));
  }, [sel]);

  const students = roster.filter((s) => (s.status || "재원") === "재원").slice().sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const qq = q.trim().toLowerCase();
  const shown = qq ? students.filter((s) => s.name.toLowerCase().includes(qq)) : students;
  const selStudent = roster.find((s) => s.id === sel) || null;
  const weeklyReg = selStudent ? [...(selStudent.mathSlots || []), ...(selStudent.engSlots || [])].reduce((a, s) => a + (s.duration || 0), 0) : 0;

  // 월 → 일별 집계.
  const byMonth = useMemo(() => {
    const map = new Map<string, Map<string, DayAgg>>();
    for (const r of hist) {
      const m = (r.date || "").slice(0, 7); if (!m) continue;
      if (!map.has(m)) map.set(m, new Map());
      const days = map.get(m)!;
      const d = days.get(r.date) || { date: r.date, in: null, out: null, subjects: [] };
      const t = toMin(r.time);
      if (r.kind === "등원" && t != null) d.in = d.in == null ? t : Math.min(d.in, t);
      if (r.kind === "하원" && t != null) d.out = d.out == null ? t : Math.max(d.out, t);
      if (r.subject && !d.subjects.includes(r.subject)) d.subjects.push(r.subject);
      days.set(r.date, d);
    }
    return map;
  }, [hist]);

  const dayMin = (d: DayAgg) => (d.in != null && d.out != null && d.out > d.in ? d.out - d.in : 0);
  const monthMinutes = (m: string) => { const days = byMonth.get(m); if (!days) return 0; let s = 0; for (const d of days.values()) s += dayMin(d); return s; };

  const days = useMemo(() => [...(byMonth.get(ym)?.values() || [])].sort((a, b) => (a.date < b.date ? -1 : 1)), [byMonth, ym]);
  const curMin = monthMinutes(ym);
  const prevMin = monthMinutes(shiftYm(ym, -1));
  const diff = curMin - prevMin;
  const [y, mo] = ym.split("-").map(Number);

  // 주차별(1~5주) 누적 — 막대그래프.
  const weeks = [0, 0, 0, 0, 0, 0];
  for (const d of days) { const wk = Math.ceil(Number(d.date.slice(8, 10)) / 7); weeks[wk] = (weeks[wk] || 0) + dayMin(d); }
  const weekList = weeks.map((v, i) => ({ wk: i, min: v })).filter((w) => w.wk >= 1 && w.wk <= 5);
  const maxWk = Math.max(1, ...weekList.map((w) => w.min));

  // 과목별(수학/영어) 분리 수업시간 — 영수 동시 수강생용. 과목 태그가 같은 등원/하원끼리 짝지어 계산.
  const subjMinutes = (subj: string) => {
    const dmap = new Map<string, { in: number | null; out: number | null }>();
    for (const r of hist) {
      if ((r.date || "").slice(0, 7) !== ym || r.subject !== subj) continue;
      const t = toMin(r.time); if (t == null) continue;
      const d = dmap.get(r.date) || { in: null, out: null };
      if (r.kind === "등원") d.in = d.in == null ? t : Math.min(d.in, t);
      if (r.kind === "하원") d.out = d.out == null ? t : Math.max(d.out, t);
      dmap.set(r.date, d);
    }
    let s = 0; for (const d of dmap.values()) if (d.in != null && d.out != null && d.out > d.in) s += d.out - d.in;
    return s;
  };
  const mathMin = subjMinutes("수학");
  const engMin = subjMinutes("영어");
  const maxSubj = Math.max(1, mathMin, engMin);
  const dualEnroll = !!selStudent
    && ((selStudent.mathSlots?.length || 0) > 0 || selStudent.subjects.includes("math"))
    && ((selStudent.engSlots?.length || 0) > 0 || !!selStudent.englishBand || selStudent.subjects.includes("english"));

  async function save() {
    if (!selStudent || saving) return;
    setSaving(true);
    try { await saveElementAsImage("cr-card", `${selStudent.name}_${y}년${mo}월_수업시간리포트`, 720); }
    finally { setSaving(false); }
  }

  return (
    <div className="sm-wrap">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">수업시간 리포트</h1>
          <p className="sm-desc">등하원 기록을 월 단위로 합산한 수업시간 보고서입니다. 이미지로 저장해 상담·청구에 쓰세요. (등원~하원 기준)</p>
        </div>
      </div>

      <div className="eng-split">
        <div className="eng-side-wrap card">
          <input className="input" style={{ marginBottom: 8 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 검색" />
          <div className="eng-side">
            {shown.map((s) => (
              <div key={s.id} className={"eng-stu" + (sel === s.id ? " on" : "")}>
                <button className="eng-stu-name" onClick={() => setSel(s.id)}>{s.name}{s.grade && <span className="eng-lv">{s.grade}</span>}</button>
              </div>
            ))}
            {shown.length === 0 && <div className="eng-side-empty">학생이 없어요.</div>}
          </div>
        </div>

        <div className="eng-main">
          {!selStudent ? (
            <div className="hub-muted" style={{ padding: 20 }}>왼쪽에서 학생을 선택하면 수업시간 리포트를 볼 수 있어요.</div>
          ) : loading ? (
            <div className="sp-muted" style={{ padding: 16 }}>불러오는 중…</div>
          ) : (
            <>
              <div className="cr-toolbar">
                <div className="cr-monthnav">
                  <button className="btn ghost sm" onClick={() => setYm(shiftYm(ym, -1))} aria-label="이전 달">‹</button>
                  <span className="cr-monthlabel">{y}년 {mo}월</span>
                  <button className="btn ghost sm" onClick={() => setYm(shiftYm(ym, 1))} aria-label="다음 달">›</button>
                </div>
                <button className="btn primary" onClick={save} disabled={saving}><Icon name="camera" /> {saving ? "저장 중…" : "이미지 저장"}</button>
              </div>

              <div id="cr-card" className="cr-card">
                <div className="cr-card-head">
                  <div className="cr-brand">바꿈영수학원</div>
                  <div className="cr-title">{y}년 {mo}월 · 수업시간 리포트</div>
                  <div className="cr-stu">{selStudent.name}<span>{selStudent.grade}</span></div>
                </div>

                <div className="cr-stats">
                  <div className="cr-stat"><b>{fmtH(curMin)}</b><span>이번 달 누적</span></div>
                  <div className="cr-stat"><b>{days.filter((d) => d.in != null).length}일</b><span>등원 일수</span></div>
                  <div className="cr-stat"><b>{weeklyReg ? fmtH(weeklyReg) : "—"}</b><span>주 등록 수업</span></div>
                  <div className={"cr-stat" + (diff < 0 ? " minus" : "")}><b>{diff >= 0 ? "+" : "−"}{fmtH(Math.abs(diff))}</b><span>지난달 대비</span></div>
                </div>

                <div className="cr-sec-t">주차별 수업시간</div>
                {weekList.some((w) => w.min > 0) ? (
                  <div className="cr-bars">
                    {weekList.map((w) => (
                      <div className="cr-bar-col" key={w.wk}>
                        <div className="cr-bar-wrap"><div className="cr-bar" style={{ height: Math.round((w.min / maxWk) * 100) + "%" }} /></div>
                        <div className="cr-bar-val">{w.min ? fmtH(w.min) : "—"}</div>
                        <div className="cr-bar-lbl">{w.wk}주</div>
                      </div>
                    ))}
                  </div>
                ) : <div className="hub-muted" style={{ padding: "6px 2px" }}>이 달 등하원 기록이 없어요.</div>}

                {dualEnroll && (
                  <>
                    <div className="cr-sec-t">과목별 수업시간 (수학 · 영어)</div>
                    <div className="cr-subj">
                      <div className="cr-subj-row">
                        <span className="cr-subj-lbl math">수학</span>
                        <div className="cr-subj-track"><div className="cr-subj-bar math" style={{ width: Math.round((mathMin / maxSubj) * 100) + "%" }} /></div>
                        <span className="cr-subj-val">{mathMin ? fmtH(mathMin) : "—"}</span>
                      </div>
                      <div className="cr-subj-row">
                        <span className="cr-subj-lbl eng">영어</span>
                        <div className="cr-subj-track"><div className="cr-subj-bar eng" style={{ width: Math.round((engMin / maxSubj) * 100) + "%" }} /></div>
                        <span className="cr-subj-val">{engMin ? fmtH(engMin) : "—"}</span>
                      </div>
                    </div>
                  </>
                )}

                <div className="cr-sec-t">일별 기록</div>
                <table className="cr-table">
                  <thead><tr><th>날짜</th><th>등원</th><th>하원</th><th>수업시간</th></tr></thead>
                  <tbody>
                    {days.length === 0 ? (
                      <tr><td colSpan={4} className="cr-empty">기록 없음</td></tr>
                    ) : days.map((d) => (
                      <tr key={d.date}>
                        <td className="cr-td-date">{mo}/{Number(d.date.slice(8, 10))}{d.subjects.length ? ` (${d.subjects.join("·")})` : ""}</td>
                        <td>{d.in != null ? hhmm(d.in) : "—"}</td>
                        <td>{d.out != null ? hhmm(d.out) : "—"}</td>
                        <td className="cr-td-min">{dayMin(d) ? fmtH(dayMin(d)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="cr-memo">
                  <div className="cr-sec-t">상담 메모</div>
                  <input className="cr-memo-in" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="상담 메모 한 줄 (이미지에 함께 저장)" />
                </div>
                <div className="cr-foot">바꿈영수학원 · 수업시간은 등원~하원 기록 기준입니다.</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
