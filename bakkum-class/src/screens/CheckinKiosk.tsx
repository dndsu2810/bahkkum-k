import { useEffect, useRef, useState } from "react";
import { checkinApi, type CheckinStudent } from "../lib/checkinApi";

/**
 * 학생용 등하원 찍기(태블릿 키오스크) — 로그인 없이 동작.
 * 흐름: ① 출석번호 입력(키패드) → ② 과목·등하원 선택 → ③ 완료 확인.
 * 영수 동시 수강생은 영어/수학 × 등원/하원 4개, 한 과목만 들으면 등원/하원 2개.
 * 주소: 앱 주소 끝에 #kiosk (예: https://(앱주소)/#kiosk)
 */
type Stage = "code" | "pick" | "done";

export function CheckinKiosk() {
  const [stage, setStage] = useState<Stage>("code");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [student, setStudent] = useState<CheckinStudent | null>(null);
  const [done, setDone] = useState<{ name: string; subject: string; kind: string; time: string } | null>(null);
  const resetTimer = useRef<number | null>(null);

  function clearTimer() { if (resetTimer.current) { window.clearTimeout(resetTimer.current); resetTimer.current = null; } }
  function reset() {
    clearTimer();
    setStage("code"); setCode(""); setErr(""); setStudent(null); setDone(null);
  }
  useEffect(() => () => clearTimer(), []);

  function tap(d: string) {
    setErr("");
    setCode((c) => (c.length >= 8 ? c : c + d));
  }
  function back() { setErr(""); setCode((c) => c.slice(0, -1)); }

  async function confirmCode() {
    if (!code.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await checkinApi.lookup(code.trim());
      if (!r.found || !r.student) { setErr("없는 번호예요. 다시 확인해서 눌러주세요."); setCode(""); }
      else { setStudent(r.student); setStage("pick"); }
    } catch {
      setErr("잠시 후 다시 시도해 주세요.");
    } finally { setBusy(false); }
  }

  async function punch(subject: string, kind: string) {
    if (!student || busy) return;
    setBusy(true);
    try {
      const r = await checkinApi.punch(code.trim(), subject, kind);
      if (r.ok) {
        setDone({ name: r.name || student.name, subject: r.subject || subject, kind: r.kind || kind, time: r.time || "" });
        setStage("done");
        clearTimer();
        resetTimer.current = window.setTimeout(reset, 4000); // 4초 뒤 처음으로
      } else { setErr("찍히지 않았어요. 다시 시도해 주세요."); }
    } catch {
      setErr("찍히지 않았어요. 다시 시도해 주세요.");
    } finally { setBusy(false); }
  }

  const subjects = student?.subjects ?? [];
  const hasEng = subjects.includes("english");
  const hasMath = subjects.includes("math");
  const both = hasEng && hasMath;

  return (
    <div className="kiosk">
      <div className="kiosk-card">
        <div className="kiosk-brand">바꿈영수학원</div>
        <h1 className="kiosk-title">등하원 체크</h1>

        {stage === "code" && (
          <>
            <div className="kiosk-sub">출석번호를 누르세요</div>
            <div className={"kiosk-code" + (err ? " err" : "")}>{code ? code.replace(/./g, "•") : "– –"}</div>
            {err && <div className="kiosk-err">{err}</div>}
            <div className="kiosk-pad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} className="kiosk-key" onClick={() => tap(d)}>{d}</button>
              ))}
              <button className="kiosk-key sub" onClick={back}>지움</button>
              <button className="kiosk-key" onClick={() => tap("0")}>0</button>
              <button className="kiosk-key go" onClick={confirmCode} disabled={!code || busy}>확인</button>
            </div>
            <div className="kiosk-hint">번호를 누르고 ‘확인’을 눌러요</div>
          </>
        )}

        {stage === "pick" && student && (
          <>
            <div className="kiosk-who">
              <span className="kiosk-ini">{student.name.slice(0, 1)}</span>
              <div>
                <div className="kiosk-name">{student.name}</div>
                <div className="kiosk-grade">{student.grade}{both ? " · 영어·수학" : hasEng ? " · 영어" : hasMath ? " · 수학" : ""}</div>
              </div>
            </div>
            <div className="kiosk-sub">{both ? "과목과 등하원을 골라요" : "무엇을 할까요?"}</div>
            {both ? (
              <div className="kiosk-grid4">
                <button className="kiosk-act eng" onClick={() => punch("영어", "등원")} disabled={busy}>영어 등원</button>
                <button className="kiosk-act math" onClick={() => punch("수학", "등원")} disabled={busy}>수학 등원</button>
                <button className="kiosk-act eng out" onClick={() => punch("영어", "하원")} disabled={busy}>영어 하원</button>
                <button className="kiosk-act math out" onClick={() => punch("수학", "하원")} disabled={busy}>수학 하원</button>
              </div>
            ) : (
              <div className="kiosk-grid2">
                <button className="kiosk-act" onClick={() => punch(hasEng ? "영어" : hasMath ? "수학" : "", "등원")} disabled={busy}>등원</button>
                <button className="kiosk-act out" onClick={() => punch(hasEng ? "영어" : hasMath ? "수학" : "", "하원")} disabled={busy}>하원</button>
              </div>
            )}
            {err && <div className="kiosk-err">{err}</div>}
            <div className="kiosk-hint">누르면 지금 시간이 자동으로 기록돼요</div>
            <button className="kiosk-restart" onClick={reset}>처음으로</button>
          </>
        )}

        {stage === "done" && done && (
          <div className="kiosk-done">
            <div className="kiosk-check">✓</div>
            <div className="kiosk-doneline"><b>{done.name}</b> {done.subject ? done.subject + " " : ""}{done.kind} 완료</div>
            <div className="kiosk-donetime">{done.time}</div>
            <button className="kiosk-restart big" onClick={reset}>처음으로</button>
          </div>
        )}
      </div>
    </div>
  );
}
