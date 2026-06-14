import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { reqsApi, type ChangeReq } from "../lib/hubApi";
import { getRoster, type RosterStudent, type Slot } from "../lib/rosterApi";
import { listUsers, type UserRow } from "../lib/authApi";
import { ROLE_LABEL, type Role } from "../lib/roles";
import { DOW, fmtWhen, parseD, todayStr } from "../lib/dates";
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
  const received = reqs.filter((r) => r.targetId === mine);
  const sent = reqs.filter((r) => r.requesterId === mine);
  const pendingIn = received.filter((r) => r.status === "pending").length;

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
            <ReqCard key={r.id} r={r} incoming={tab === "in"} onRespond={respond} />
          ))}
          {(tab === "in" ? received : sent).length === 0 && (
            <div className="hub-muted" style={{ padding: 20 }}>{tab === "in" ? "받은 요청이 없어요." : "보낸 요청이 없어요."}</div>
          )}
        </div>
      )}
    </div>
  );
}

function ReqCard({ r, incoming, onRespond }: { r: ChangeReq; incoming: boolean; onRespond: (r: ChangeReq, s: "approved" | "rejected") => void }) {
  const st = r.status === "approved" ? { t: "승인됨", c: "ok" } : r.status === "rejected" ? { t: "거절됨", c: "bad" } : { t: "대기 중", c: "wait" };
  return (
    <div className="req-card">
      <div className="req-card-top">
        <span className={"req-badge " + subjClass(r.subject)}>{subjLabel(r.subject)}</span>
        <b className="req-stu">{r.studentName}</b>
        <span className={"req-status " + st.c}>{st.t}</span>
      </div>
      <div className="req-line">
        <b>{r.changeDate}</b> · {r.fromTime || "기존"} → <b>{r.toTime}</b>
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
    </div>
  );
}

const subjClass = (s: string) => (s === "english" ? "eng" : "math");

/* ---------------- 새 요청 ---------------- */
function NewRequest({ roster, users, prefill, onCreated }: { roster: RosterStudent[]; users: UserRow[]; prefill?: (ReqPrefill & { n: number }) | null; onCreated: () => void }) {
  const [studentId, setStudentId] = useState(prefill?.studentId || "");
  const [studentQ, setStudentQ] = useState(prefill?.studentName || "");
  const [subject, setSubject] = useState<"math" | "english">(prefill?.subject || "math");
  const [changeDate, setChangeDate] = useState(prefill?.changeDate || todayStr());
  const [fromTime, setFromTime] = useState(prefill?.fromTime || "");
  const [toTime, setToTime] = useState(prefill?.toTime || "17:00");
  const [reason, setReason] = useState("");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 프리필이 갱신되면(충돌 팝업에서 다시 열기 등) 폼을 그 값으로 다시 채운다.
  useEffect(() => {
    if (!prefill) return;
    setStudentId(prefill.studentId);
    setStudentQ(prefill.studentName);
    setSubject(prefill.subject);
    setChangeDate(prefill.changeDate);
    if (prefill.fromTime) setFromTime(prefill.fromTime);
    if (prefill.toTime) setToTime(prefill.toTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.n]);

  const student = roster.find((s) => s.id === studentId) || null;
  const teachers = users.filter((u) => (u.role as Role) !== "student");

  // 담당 선생님 자동 추정: 과목에 맞는 역할의 첫 강사.
  const autoTarget = useMemo(() => {
    const want: Role[] = subject === "math" ? ["math", "admin"] : ["english_elem", "english_mid", "admin"];
    return teachers.find((u) => want.includes(u.role as Role)) || null;
  }, [teachers, subject]);

  // 충돌 감지: 바꿀 날짜의 요일에 해당 학생의 수학·영어 수업이 겹치는지.
  const dow = DOW[parseD(changeDate).getDay()];
  const conflicts = useMemo(() => {
    if (!student) return [] as { subject: string; slot: Slot }[];
    const out: { subject: string; slot: Slot }[] = [];
    for (const sl of student.mathSlots) if (sl.day === dow) out.push({ subject: "math", slot: sl });
    for (const sl of student.engSlots) if (sl.day === dow) out.push({ subject: "english", slot: sl });
    return out;
  }, [student, dow]);
  const overlap = conflicts.some((a) => conflicts.some((b) => a.subject !== b.subject && a.slot.time === b.slot.time));

  // 학생/과목 선택 시 원래 시간 자동 채움(해당 요일 첫 슬롯).
  useEffect(() => {
    if (!student) return;
    const slots = subject === "math" ? student.mathSlots : student.engSlots;
    const sl = slots.find((x) => x.day === dow) || slots[0];
    if (sl) setFromTime(sl.time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, subject, changeDate]);

  async function submit() {
    if (!student || !toTime) return;
    setBusy(true);
    setErr("");
    const target = targetId ? teachers.find((u) => u.id === targetId) : autoTarget;
    try {
      await reqsApi.create({
        studentId: student.id,
        studentName: student.name,
        subject,
        changeDate,
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
      <div className="prof-grid">
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
            }}
            placeholder="학생 이름 입력"
          />
          <datalist id="req-stu-list">
            {roster.map((s) => <option key={s.id} value={s.name}>{s.grade ? `${s.grade}` : ""}</option>)}
          </datalist>
        </label>
        <label className="prof-field">
          <span className="prof-field-l">과목</span>
          <div className="sm-subj">
            <button className={"sm-subj-chip" + (subject === "math" ? " on" : "")} onClick={() => setSubject("math")}>수학</button>
            <button className={"sm-subj-chip" + (subject === "english" ? " on eng" : "")} onClick={() => setSubject("english")}>영어</button>
          </div>
        </label>
        <label className="prof-field">
          <span className="prof-field-l">바꿀 날짜</span>
          <input className="inline-input" type="date" value={changeDate} onChange={(e) => setChangeDate(e.target.value)} />
        </label>
        <label className="prof-field">
          <span className="prof-field-l">원래 시간</span>
          <input className="inline-input" type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
        </label>
        <label className="prof-field">
          <span className="prof-field-l">바꿀 시간</span>
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

      {student && conflicts.length > 0 && (
        <div className={"req-conflict" + (overlap ? " warn" : "")}>
          {overlap ? "⚠ 시간표가 겹칩니다 — " : `${dow}요일 수업: `}
          {conflicts.map((c, i) => (
            <span key={i} className="req-conflict-chip">{subjLabel(c.subject)} {c.slot.time}~{c.slot.duration}분</span>
          ))}
        </div>
      )}

      <label className="prof-field" style={{ marginTop: 10 }}>
        <span className="prof-field-l">사유</span>
        <textarea className="input prof-memo" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="변경 사유(예: 학교 행사로 5시→6시)" />
      </label>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn primary" onClick={submit} disabled={busy || !student || !toTime}>{busy ? "보내는 중…" : "변경 요청 보내기"}</button>
      </div>
    </div>
  );
}
