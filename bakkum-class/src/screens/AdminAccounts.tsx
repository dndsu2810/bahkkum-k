import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import {
  AREAS,
  ASSIGNABLE_ROLES,
  AREA_LABEL,
  DEFAULT_AREAS,
  ROLE_DESC,
  ROLE_LABEL,
  SUBJECTS,
  dutyText,
  type AreaKey,
  type Role,
} from "../lib/roles";
import { type UserRow, createUser, deleteUser, listUsers, updateUser } from "../lib/authApi";

const ERR_MSG: Record<string, string> = {
  pin_min_4_digits: "비밀번호는 숫자 4자리 이상이어야 해요.",
  name_required: "이름을 입력해 주세요.",
  last_admin: "마지막 원장 계정은 삭제할 수 없어요.",
};
function msg(e: unknown): string {
  const code = String((e as Error)?.message || "");
  return ERR_MSG[code] || "처리 중 오류가 났어요. 다시 시도해 주세요.";
}

const AREA_KEYS = AREAS.map((a) => a.key);

/** 원장 전용 — 강사 계정 등록·역할·화면(영역) 배정·관리. (설정 화면 안에 표시) */
export function AdminAccounts() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // 새 계정 입력
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("english_elem");
  const [pin, setPin] = useState("");
  const [areas, setAreas] = useState<AreaKey[]>(DEFAULT_AREAS.english_elem);
  const [duty, setDuty] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setRows(await listUsers());
      setErr("");
    } catch {
      setErr("계정 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  // 역할 바꾸면 그 역할의 기본 화면셋으로 자동 채움(이후 수정 가능)
  function pickRole(next: Role) {
    setRole(next);
    setAreas(DEFAULT_AREAS[next] || []);
  }
  function toggleArea(k: AreaKey) {
    setAreas((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  }
  function toggleDuty(k: string) {
    setDuty((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  }
  // 행(기존 계정)의 담당 과목 즉시 변경.
  async function toggleRowDuty(row: UserRow, k: string) {
    const cur = new Set(row.duty || []);
    if (cur.has(k)) cur.delete(k);
    else cur.add(k);
    setErr("");
    try {
      await updateUser({ id: row.id, duty: [...cur] });
      await refresh();
    } catch (e2) {
      setErr(msg(e2));
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    if (!name.trim()) return setErr("이름을 입력해 주세요.");
    if (!/^\d{4,}$/.test(pin)) return setErr("비밀번호는 숫자 4자리 이상이어야 해요.");
    setBusy(true);
    try {
      await createUser({ name: name.trim(), role, pin, scope: areas, duty: role === "developer" ? duty : [] });
      setName("");
      setPin("");
      setDuty([]);
      await refresh();
    } catch (e2) {
      setErr(msg(e2));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(row: UserRow, next: Role) {
    setErr("");
    try {
      // 역할 변경 시 화면셋도 그 역할 기본값으로 맞춰준다(원장이 행에서 다시 조정 가능)
      await updateUser({ id: row.id, role: next, scope: DEFAULT_AREAS[next] || [] });
      await refresh();
    } catch (e2) {
      setErr(msg(e2));
    }
  }

  async function toggleRowArea(row: UserRow, k: AreaKey) {
    const cur = new Set(row.scope || []);
    if (cur.has(k)) cur.delete(k);
    else cur.add(k);
    setErr("");
    try {
      await updateUser({ id: row.id, scope: [...cur] });
      await refresh();
    } catch (e2) {
      setErr(msg(e2));
    }
  }

  async function resetPin(row: UserRow) {
    const next = window.prompt(`${row.name} 님의 새 비밀번호(숫자 4자리 이상)`, "");
    if (next == null) return;
    if (!/^\d{4,}$/.test(next)) return setErr("비밀번호는 숫자 4자리 이상이어야 해요.");
    try {
      await updateUser({ id: row.id, pin: next });
      setErr("");
      window.alert("비밀번호를 변경했어요.");
    } catch (e2) {
      setErr(msg(e2));
    }
  }

  async function remove(row: UserRow) {
    if (!window.confirm(`${row.name}(${ROLE_LABEL[row.role]}) 계정을 삭제할까요?`)) return;
    setErr("");
    try {
      await deleteUser(row.id);
      await refresh();
    } catch (e2) {
      setErr(msg(e2));
    }
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginBottom: 4 }}>강사 계정 · 화면 배정</h3>
      <p style={{ color: "var(--ink3)", fontSize: "var(--t-sm)" }}>
        강사 이름과 숫자 비밀번호로 간단히 등록하고, 이 계정이 볼 화면을 직접 골라 주세요. (학생은 이름+생년월일로
        직접 로그인)
      </p>

      {err && <div className="auth-err" style={{ marginTop: 12 }}>{err}</div>}

      {loading ? (
        <div className="hub-muted" style={{ marginTop: 12 }}>불러오는 중…</div>
      ) : (
        <div className="acct-list">
          {rows.map((r) => {
            const isSelf = user?.sub === r.id;
            const isAdmin = r.role === "admin";
            const rowAreas = new Set(isAdmin ? AREA_KEYS : r.scope || []);
            return (
              <div className="acct-row col" key={r.id}>
                <div className="acct-row-top">
                  <span className="nm">{r.name}</span>
                  <span className="rl">{ROLE_LABEL[r.role]}{r.role === "developer" && r.duty?.length ? ` · ${dutyText(r.duty)}` : ""}</span>
                  <div className="sp">
                    <select
                      className="inline-select"
                      value={r.role}
                      onChange={(e) => changeRole(r, e.target.value as Role)}
                      disabled={isSelf}
                      title={isSelf ? "본인 역할은 바꿀 수 없어요" : "역할 변경"}
                    >
                      {ASSIGNABLE_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABEL[role]}
                        </option>
                      ))}
                    </select>
                    <button className="btn ghost" onClick={() => resetPin(r)}>
                      비번 변경
                    </button>
                    <button className="btn ghost" onClick={() => remove(r)} disabled={isSelf}>
                      삭제
                    </button>
                  </div>
                </div>
                <div className="area-chips">
                  {AREAS.map((a) => (
                    <label
                      key={a.key}
                      className={"area-chip" + (rowAreas.has(a.key) ? " on" : "") + (isAdmin ? " locked" : "")}
                      title={a.desc}
                    >
                      <input
                        type="checkbox"
                        checked={rowAreas.has(a.key)}
                        disabled={isAdmin}
                        onChange={() => toggleRowArea(r, a.key)}
                      />
                      {a.label}
                    </label>
                  ))}
                </div>
                {isAdmin && <div className="area-note">원장은 모든 화면을 봅니다.</div>}
                {r.role === "developer" && (
                  <div className="acct-duty">
                    <span className="acct-duty-label">담당 과목</span>
                    {SUBJECTS.map((s) => (
                      <label key={s.key} className={"area-chip" + ((r.duty || []).includes(s.key) ? " on" : "")}>
                        <input type="checkbox" checked={(r.duty || []).includes(s.key)} onChange={() => toggleRowDuty(r, s.key)} />
                        {s.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <form className="acct-form" onSubmit={add}>
        <label>
          이름
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="강사 이름" />
        </label>
        <label>
          비밀번호 (숫자)
          <input
            className="input"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="숫자 4자리 이상"
          />
        </label>
        <label className="full">
          역할
          <select className="inline-select" value={role} onChange={(e) => pickRole(e.target.value as Role)}>
            {ASSIGNABLE_ROLES.map((rl) => (
              <option key={rl} value={rl}>
                {ROLE_LABEL[rl]} — {ROLE_DESC[rl]}
              </option>
            ))}
          </select>
        </label>
        {role === "developer" && (
          <div className="full">
            <div className="acct-form-sub">담당 과목 (개발자가 같이 맡는 과목)</div>
            <div className="area-chips">
              {SUBJECTS.map((s) => (
                <label key={s.key} className={"area-chip" + (duty.includes(s.key) ? " on" : "")}>
                  <input type="checkbox" checked={duty.includes(s.key)} onChange={() => toggleDuty(s.key)} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="full">
          <div className="acct-form-sub">이 계정이 볼 화면</div>
          <div className="area-chips">
            {AREAS.map((a) => {
              const on = areas.includes(a.key);
              const locked = role === "admin";
              return (
                <label key={a.key} className={"area-chip" + (on || locked ? " on" : "") + (locked ? " locked" : "")} title={a.desc}>
                  <input
                    type="checkbox"
                    checked={on || locked}
                    disabled={locked}
                    onChange={() => toggleArea(a.key)}
                  />
                  {AREA_LABEL[a.key]}
                </label>
              );
            })}
          </div>
        </div>
        <button className="btn primary full" type="submit" disabled={busy}>
          {busy ? "등록 중…" : "강사 계정 추가"}
        </button>
      </form>
    </section>
  );
}
