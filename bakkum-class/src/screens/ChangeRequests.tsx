import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { reqsApi, type ChangeReq } from "../lib/hubApi";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { listUsers, type UserRow } from "../lib/authApi";
import { ROLE_LABEL, type Role } from "../lib/roles";
import { DOW, fmtWhen, parseD, todayStr, ymd } from "../lib/dates";
import type { ReqPrefill } from "../lib/changeReqLive";

type Tab = "in" | "out" | "new";
const subjLabel = (s: string) => (s === "english" ? "영어" : "수학");

/** 시간표 변경 요청 — 한 학생 수업시간 임시 변경을 담당/지정 강사에게 요청 → 승인. 앱 내 알림(배지). */
export function ChangeRequests({ prefill }: { prefill?: (ReqPrefill & { n: number }) | null }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>(prefill ? "new" : "in");
  // 충돌 팝업 등에서 프리필이 도착하면 '새 요청' 탭으로 전환.
  useEffect(() => {
    if (prefill) setTab("new");
  }, [prefill?.n]);
  const [reqs, setReqs] = useState<ChangeReq[]>([]);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [err, setErr] = useState("");

  const load = () => reqsApi.list().then(setReqs).catch(() => setErr("불러오지 못했어요. (배포 환경에서만 동작)"));
  useEffect(() => {
    void load();
    getRoster().then(setRoster).catch(() => {});
    listUsers().then(setUsers).catch(() => {});
    const iv = setInterval(() => void load(), 15000);
    return () => clearInterval(iv);
  }, []);

  const mine = user?.sub || "";
  const received = reqs.filter((r) => r.targetId === mine && r.status !== "withdrawn");
  const sent = reqs.filter((r) => r.requesterId === mine);
  const pendingIn = received.filter((r) => r.status === "pending").length;

  async function withdraw(r: ChangeReq) {
    if (!window.confirm("이 변경 요청을 철회할까요?")) return;
    setReqs((cur) => cur.map((x) => (x.id === r.id ? { ...x, status: "withdrawn" } : x)));
    try { await reqsApi.withdraw(r.id); await load(); } catch { setErr("철회에 실패했어요."); }
  }

  async function respond(r: ChangeReq, status: "approved" | "rejected") {
    const memo = status === "rejected" ? window.prompt("거절/대안 사유(선택)", "") ?? "" : window.prompt("승인 메모(선택)", "") ?? "";
    setReqs((cur) => cur.map((x) => (x.id === r.id ? { ...x, status, response: memo } : x)));
    try {
      await reqsApi.respond(r.id, status, memo);
      await load();
    } catch {
      setErr("처리에 실패했어요.");
    }
  }

  return (
    <div className="sm-wrap">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">시간표 변경 요청</h1>
          <p className="sm-desc">특정일 수업시간을 임시로 바꿔야 할 때, 담당/지정 선생님께 요청하고 승인받습니다.</p>
        </div>
      </div>

      <div className="desk-tabs">
        {([["in", `받은 요청${pendingIn ? ` (${pendingIn})` : ""}`], ["out", "보낸 요청"], ["new", "새 요청"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} className={"sm-fchip" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {err && <div className="auth-err" style={{ margin: "8px 0" }}>{err}</div>}

      {tab === "new" ? (
        <NewRequest roster={roster} users={users} prefill={prefill} onCreated={() => { setTab("out"); void load(); }} />
      ) : (
        <div className="req-list">
          {(tab === "in" ? received : sent).map((r) => (
            <ReqCard key={r.id} r={r} incoming={tab === "in"} onRespond={respond} onWithdraw={withdraw} />
          ))}
          {(tab === "in" ? received : sent).length === 0 && (
            <div className="hub-muted" style={{ padding: 20 }}>{tab === "in" ? "받은 요청이 없어요." : "보낸 요청이 없어요."}</div>
          )}
        </div>
      )}
    </div>
  );
}

function ReqCard({ r, incoming, onRespond, onWithdraw }: { r: ChangeReq; incoming: boolean; onRespond: (r: ChangeReq, s: "approved" | "rejected") => void; onWithdraw: (r: ChangeReq) => void }) {
  const st =
    r.status === "approved" ? { t: "승인됨", c: "ok" }
    : r.status === "rejected" ? { t: "거절됨", c: "bad" }
    : r.status === "withdrawn" ? { t: "철회됨", c: "wait" }
    : { t: "대기 중", c: "wait" };
  const fromD = r.fromDate || r.changeDate;
  const toD = r.toDate || r.changeDate;
  const moved = fromD && fromD !== toD;
  return (
    <div className="req-card">
      <div className="req-card-top">
        <span className={"req-badge " + subjClass(r.subject)}>{subjLabel(r.subject)}</span>
        <b className="req-stu">{r.studentName}</b>
        <span className={"req-status " + st.c}>{st.t}</span>
      </div>
      <div className="req-line">
        {moved
          ? <><b>{fromD}</b> {r.fromTime || ""} → <b>{toD}</b> {r.toTime}</>
          : <><b>{toD}</b> · {r.fromTime || "기존"} → <b>{r.toTime}</b></>}
      </div>
      {r.reason && <div className="req-reason">{r.reason}</div>}
      <div className="req-meta">
        {incoming ? `요청: ${r.requesterName}` : `대상: ${r.targetName || "—"}`} · {fmtWhen(r.createdAt)}
      </div>
      {r.response && <div className="req-resp">응답: {r.response}</div>}
      {incoming && r.status === "pending" && (
        <div className="req-acts">
          <button className="btn primary sm" onClick={() => onRespond(r, "approved")}>승인</button>
          <button className="btn ghost sm" onClick={() => onRespond(r, "rejected")}>거절·대안</button>
        </div>
      )}
      {!incoming && r.status === "pending" && (
        <div className="req-acts">
          <button className="btn ghost sm" onClick={() => onWithdraw(r)}>철회</button>
        </div>
      )}
    </div>
  );
}

const subjClass = (s: string) => (s === "english" ? "eng" : "math");

/* ---------------- 새 요청 ---------------- */
// 오늘부터 가장 가까운 해당 요일의 날짜(YYYY-MM-DD).
function nextDateForDow(dayLabel: string): string {
  const start = parseD(todayStr());
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (DOW[d.getDay()] === dayLabel) return ymd(d);
  }
  return todayStr();
}

interface ClassOpt { subject: "math" | "english"; day: string; time: string; duration: number }

function NewRequest({ roster, users, prefill, onCreated }: { roster: RosterStudent[]; users: UserRow[]; prefill?: (ReqPrefill & { n: number }) | null; onCreated: () => void }) {
  const [studentId, setStudentId] = useState(prefill?.studentId || "");
  const [studentQ, setStudentQ] = useState(prefill?.studentName || "");
  const [subject, setSubject] = useState<"math" | "english">(prefill?.subject || "math");
  const [fromTime, setFromTime] = useState(prefill?.fromTime || "");
  const [fromDate, setFromDate] = useState(prefill?.fromDate || todayStr());
  const [toDate, setToDate] = useState(prefill?.toDate || prefill?.fromDate || todayStr());
  const [toTime, setToTime] = useState(prefill?.toTime || prefill?.fromTime || "17:00");
  const [reason, setReason] = useState("");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const student = roster.find((s) => s.id === studentId) || null;
  const teachers = users.filter((u) => (u.role as Role) !== "student");

  // 학생의 기존 수업(영어·수학 모두) — 이 중에서 '옮길 수업'을 고른다(과목 혼동 방지).
  const classes: ClassOpt[] = useMemo(() => {
    if (!student) return [];
    return [
      ...student.mathSlots.map((sl) => ({ subject: "math" as const, day: sl.day, time: sl.time, duration: sl.duration })),
      ...student.engSlots.map((sl) => ({ subject: "english" as const, day: sl.day, time: sl.time, duration: sl.duration })),
    ].sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time));
  }, [student]);
  const classKey = (c: { subject: string; time: string }) => `${c.subject}|${c.time}`;
  const [selKey, setSelKey] = useState("");

  // 수업을 고르면 과목·원래시간·원래날짜(가까운 그 요일)·기본 변경값을 채운다.
  function pickClass(c: ClassOpt) {
    setSelKey(classKey(c));
    setSubject(c.subject);
    setFromTime(c.time);
    const fd = nextDateForDow(c.day);
    setFromDate(fd);
    setToDate(fd);
    setToTime(c.time);
  }

  // 프리필(충돌 팝업 등)이 오면 그 값으로 채우고 일치하는 수업을 선택.
  useEffect(() => {
    if (!prefill) return;
    setStudentId(prefill.studentId);
    setStudentQ(prefill.studentName);
    setSubject(prefill.subject);
    if (prefill.fromDate) setFromDate(prefill.fromDate);
    if (prefill.toDate || prefill.fromDate) setToDate(prefill.toDate || prefill.fromDate!);
    if (prefill.fromTime) { setFromTime(prefill.fromTime); setToTime(prefill.fromTime); }
    if (prefill.fromTime) setSelKey(`${prefill.subject}|${prefill.fromTime}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.n]);

  const autoTarget = useMemo(() => {
    const want: Role[] = subject === "math" ? ["math", "admin"] : ["english_elem", "english_mid", "admin"];
    return teachers.find((u) => want.includes(u.role as Role)) || null;
  }, [teachers, subject]);

  async function submit() {
    if (!student || !toDate || !toTime) return;
    setBusy(true);
    setErr("");
    const target = targetId ? teachers.find((u) => u.id === targetId) : autoTarget;
    try {
      await reqsApi.create({
        studentId: student.id,
        studentName: student.name,
        subject,
        fromDate,
        toDate,
        fromTime,
        toTime,
        reason,
        targetId: target?.id || "",
        targetName: target?.name || "",
      });
      onCreated();
    } catch {
      setErr("요청에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card req-form">
      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
      <p className="hub-muted" style={{ marginBottom: 12 }}>
        학생을 고르고 <b>옮길 수업</b>을 누른 뒤, <b>언제로</b> 옮길지(날짜·시간)만 정하면 됩니다. 과목은 고른 수업으로 자동 지정돼요.
      </p>

      <label className="prof-field">
        <span className="prof-field-l">학생 (이름 검색)</span>
        <input
          className="inline-input"
          list="req-stu-list"
          value={studentQ}
          onChange={(e) => {
            setStudentQ(e.target.value);
            const m = roster.find((s) => s.name === e.target.value);
            setStudentId(m?.id || "");
            setSelKey("");
          }}
          placeholder="학생 이름 입력"
        />
        <datalist id="req-stu-list">
          {roster.map((s) => <option key={s.id} value={s.name}>{s.grade ? `${s.grade}` : ""}</option>)}
        </datalist>
      </label>

      {student && (
        <div className="prof-field" style={{ marginTop: 10 }}>
          <span className="prof-field-l">옮길 수업 (기존 시간표에서 선택)</span>
          {classes.length === 0 ? (
            <div className="hub-muted">이 학생은 등록된 수업이 없어요. 학생 명단에서 수업 시간을 먼저 등록하세요.</div>
          ) : (
            <div className="req-class-chips">
              {classes.map((c, i) => (
                <button
                  key={i}
                  className={"req-class-chip " + c.subject + (selKey === classKey(c) ? " on" : "")}
                  onClick={() => pickClass(c)}
                >
                  {subjLabel(c.subject)} · {c.day} {c.time}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="prof-grid" style={{ marginTop: 10 }}>
        <label className="prof-field">
          <span className="prof-field-l">원래 날짜</span>
          <input className="inline-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="prof-field">
          <span className="prof-field-l">→ 변경할 날짜</span>
          <input className="inline-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label className="prof-field">
          <span className="prof-field-l">변경할 시간</span>
          <input className="inline-input" type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
        </label>
        <label className="prof-field">
          <span className="prof-field-l">보낼 선생님</span>
          <select className="inline-select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">담당 선생님{autoTarget ? ` (${autoTarget.name})` : ""}</option>
            {teachers.map((u) => <option key={u.id} value={u.id}>{u.name} · {ROLE_LABEL[u.role]}</option>)}
          </select>
        </label>
      </div>

      {student && (
        <div className="req-summary">
          <b>{student.name}</b> · {subjLabel(subject)} 수업을{" "}
          <b>{fromDate} {fromTime || ""}</b> → <b>{toDate} {toTime}</b>(으)로 옮깁니다.
        </div>
      )}

      <label className="prof-field" style={{ marginTop: 10 }}>
        <span className="prof-field-l">사유</span>
        <textarea className="input prof-memo" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="변경 사유(예: 학교 행사)" />
      </label>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn primary" onClick={submit} disabled={busy || !student || !toDate || !toTime}>{busy ? "보내는 중…" : "변경 요청 보내기"}</button>
      </div>
    </div>
  );
}
