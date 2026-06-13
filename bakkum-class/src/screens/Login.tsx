import { useState } from "react";
import { useAuth } from "../auth";
import { loginStudent, loginTeacher } from "../lib/authApi";

type Tab = "teacher" | "student";

const ERR_MSG: Record<string, string> = {
  invalid_credentials: "이름 또는 비밀번호가 맞지 않아요.",
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
      setErr(ERR_MSG[code] || "이름 또는 비밀번호가 맞지 않아요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="auth-logo">바</div>
          <div>
            <b>바꿈 통합 허브</b>
            <span>바꿈영수학원</span>
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
            <span>생년월일</span>
            <input
              className="input"
              type="date"
              value={birth}
              onChange={(e) => setBirth(e.target.value)}
            />
            <small className="auth-hint">생년월일이 비밀번호예요.</small>
          </label>
        )}

        {err && <div className="auth-err">{err}</div>}

        <button className="btn primary auth-submit" type="submit" disabled={busy}>
          {busy ? "확인 중…" : "로그인"}
        </button>
      </form>
    </div>
  );
}
