import { useState } from "react";
import { useAuth } from "../auth";
import { loginStudent, loginTeacher } from "../lib/authApi";
import { getCachedLogo } from "../lib/configApi";
import { SoezLogo, Bee } from "../soez";

type Tab = "teacher" | "student";

const ERR_MSG: Record<string, string> = {
  invalid_credentials: "정보가 맞지 않아요. 이름과 입력값을 다시 확인해 주세요.",
  name_required: "이름을 입력해 주세요.",
  login_failed: "로그인에 실패했어요. 다시 시도해 주세요.",
};

export function Login() {
  const { setUser } = useAuth();
  const [tab, setTab] = useState<Tab>("teacher");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [birth, setBirth] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const logo = getCachedLogo();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    if (!name.trim()) {
      setErr("이름을 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const user =
        tab === "teacher" ? await loginTeacher(name, pin) : await loginStudent(name, birth);
      setUser(user);
    } catch (e2) {
      const code = String((e2 as Error).message || "");
      setErr(ERR_MSG[code] || (tab === "student" ? "이름 또는 생년월일이 맞지 않아요." : "이름 또는 비밀번호가 맞지 않아요."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-hero"><SoezLogo size={46} /></div>
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          {logo.url ? <img className="auth-logo auth-logo-img" src={logo.url} alt="바꿈영수학원" /> : <span className="auth-logo soez-mark-bee"><Bee size={34} /></span>}
          <div>
            <b>바꿈영수학원</b>
            <span>선생님·학생 로그인</span>
          </div>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "teacher"}
            className={"auth-tab" + (tab === "teacher" ? " on" : "")}
            onClick={() => {
              setTab("teacher");
              setErr("");
            }}
          >
            선생님
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "student"}
            className={"auth-tab" + (tab === "student" ? " on" : "")}
            onClick={() => {
              setTab("student");
              setErr("");
            }}
          >
            학생
          </button>
        </div>

        <label className="auth-field">
          <span>이름</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름"
            autoFocus
            autoComplete="off"
          />
        </label>

        {tab === "teacher" ? (
          <label className="auth-field">
            <span>비밀번호 (숫자)</span>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="숫자 비밀번호"
              autoComplete="off"
            />
          </label>
        ) : (
          <label className="auth-field">
            <span>생년월일 6자리</span>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={birth}
              onChange={(e) => setBirth(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="010703"
              autoComplete="off"
            />
            <small className="auth-hint">생일이 2001년 7월 3일이면 010703</small>
          </label>
        )}

        {err && <div className="auth-err">{err}</div>}

        <button className="btn primary auth-submit" type="submit" disabled={busy}>
          {busy ? "확인 중…" : "로그인"}
        </button>
      </form>
      <footer className="maker-credit">제작자 EZ</footer>
    </div>
  );
}
