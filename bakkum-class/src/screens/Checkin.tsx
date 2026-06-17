import { useEffect, useState } from "react";
import { checkinApi, type CheckinRow } from "../lib/checkinApi";

function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function fmtDate(d: string): string {
  if (!d) return "";
  const [y, mo, da] = d.split("-").map(Number);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, mo - 1, da).getDay()];
  return `${mo}월 ${da}일 (${dow})`;
}

/** 등하원 관리(선생님) — 오늘 현황 + 시간 수정 + 학부모 알림(테스트 모드). */
export function Checkin() {
  const [date, setDate] = useState(todayKst());
  const [rows, setRows] = useState<CheckinRow[]>([]);
  const [summary, setSummary] = useState({ arrive: 0, leave: 0, unsent: 0 });
  const [days, setDays] = useState<{ date: string; count: number; unsent: number }[]>([]);
  const [q, setQ] = useState("");
  const [onlyUnsent, setOnlyUnsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  async function load(d = date) {
    setLoading(true);
    try {
      const r = await checkinApi.today(d);
      setRows(r.list); setSummary(r.summary);
    } catch { setMsg("불러오지 못했어요."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(date); /* eslint-disable-next-line */ }, [date]);
  useEffect(() => { checkinApi.days().then((r) => setDays(r.days)).catch(() => {}); }, []);

  async function send(row: CheckinRow) {
    setMsg("");
    try {
      const r = await checkinApi.send(row.id);
      setMsg(r.testMode ? `${row.name} 학부모에게 '${r.template}' 알림 — 테스트 모드(실발송 전, 기록만)` : `${row.name} 발송 완료`);
      await load();
    } catch { setMsg("발송에 실패했어요."); }
  }
  async function editTime(row: CheckinRow, time: string) {
    if (!/^\d{1,2}:\d{2}$/.test(time) || time === row.time) return;
    try { await checkinApi.setTime(row.id, time); await load(); } catch { setMsg("시간 수정에 실패했어요."); }
  }

  const ql = q.trim().toLowerCase();
  const shown = rows.filter((r) => (!onlyUnsent || !r.sent) && (!ql || (r.name + " " + r.grade).toLowerCase().includes(ql)));

  const stOf = (r: CheckinRow) => {
    if (r.corrected) return { label: "정정됨", cls: "fix" };
    return { label: `${r.kind}완료`, cls: r.kind === "등원" ? "in" : "out" };
  };

  return (
    <div className="sm-wrap ci">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">등하원 관리</h1>
          <p className="sm-desc">학생이 찍은 등하원을 확인하고, 학부모에게 알림을 보내세요. 아직 안 보낸 건 빨간색으로 표시돼요.</p>
        </div>
        <input className="ctrl" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="날짜" />
      </div>

      <div className="ci-summary">
        <div className="ci-sum"><b>{summary.arrive}</b><span>등원</span></div>
        <div className="ci-sum"><b>{summary.leave}</b><span>하원</span></div>
        <div className={"ci-sum" + (summary.unsent ? " warn" : "")}><b>{summary.unsent}</b><span>미발송</span></div>
      </div>

      <div className="ci-controls">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 이름·반 검색" />
        <button className={"sm-fchip" + (!onlyUnsent ? " on" : "")} onClick={() => setOnlyUnsent(false)}>전체</button>
        <button className={"sm-fchip" + (onlyUnsent ? " on" : "")} onClick={() => setOnlyUnsent(true)}>미발송만</button>
      </div>

      {msg && <div className="ci-msg">{msg}</div>}

      <div className="ci-daterow">{fmtDate(date)} <span className="ci-cnt">{rows.length}명</span>{summary.unsent > 0 && <span className="ci-unsent-badge">미발송 {summary.unsent}</span>}</div>

      {loading ? (
        <div className="sp-muted" style={{ padding: 16 }}>불러오는 중…</div>
      ) : shown.length === 0 ? (
        <div className="issue-empty">{onlyUnsent ? "미발송 건이 없어요." : "이 날의 등하원 기록이 없어요."}</div>
      ) : (
        <div className="ci-list">
          {shown.map((r) => {
            const st = stOf(r);
            const needSend = !r.sent || r.corrected;
            return (
              <div className={"ci-row" + (needSend ? " unsent" : "")} key={r.id}>
                <span className="ci-ini">{r.name.slice(0, 1)}</span>
                <div className="ci-main">
                  <div className="ci-name">{r.name}<span className="ci-grade">{r.grade}</span>{r.subject && <span className="ci-subj">{r.subject}</span>}</div>
                  <div className="ci-line">
                    <span className={"ci-st " + st.cls}>{st.label}</span>
                    <input className="ci-time" defaultValue={r.time} onBlur={(e) => editTime(r, e.target.value.trim())} aria-label="시간" />
                  </div>
                </div>
                {r.sent && !r.corrected ? (
                  <span className="ci-sent">발송됨 ✓</span>
                ) : (
                  <button className="btn primary sm" onClick={() => send(r)}>{r.corrected ? "정정 보내기" : "알림 보내기"}</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {days.filter((d) => d.date !== date).length > 0 && (
        <div className="ci-pastdays">
          <div className="ci-past-h">지난 기록</div>
          {days.filter((d) => d.date !== date).map((d) => (
            <button key={d.date} className="ci-pastday" onClick={() => setDate(d.date)}>
              {fmtDate(d.date)} <span className="ci-cnt">{d.count}명</span>{d.unsent > 0 ? <span className="ci-unsent-badge">미발송 {d.unsent}</span> : <span className="ci-allsent">전원 발송</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
