import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { getConfig, setConfig } from "../lib/configApi";
import { listUsers } from "../lib/authApi";
import { SUBJECTS } from "../lib/roles";
import { uid } from "../lib/dates";
import { Icon } from "../icons";

/** 강사 정보 안내 — 강사명·담당과목·추가 업무담당·전화번호. 모두 열람, 원장·개발자만 편집. */
interface TInfo { id: string; name: string; subjects: string[]; extraDuty: string; phone: string }
const CFG_KEY = "teacher_info";
// 담당과목 — 수업 과목 + 데스크.
const TG_SUBJECTS: { key: string; label: string }[] = [...SUBJECTS, { key: "desk", label: "데스크" }];
const subLabel = (k: string) => TG_SUBJECTS.find((s) => s.key === k)?.label || k;
const telHref = (phone: string) => phone.replace(/[^0-9+]/g, "");

export function TeacherGuide() {
  const { user } = useAuth();
  const canEdit = !!user && user.role !== "student"; // 강사 누구나 수정·추가
  const [rows, setRows] = useState<TInfo[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        try { const arr = JSON.parse(cfg[CFG_KEY] || "[]"); if (Array.isArray(arr)) setRows(arr as TInfo[]); } catch { /* ignore */ }
      })
      .catch(() => setErr("불러오지 못했어요. 잠시 후 다시 시도해 주세요."))
      .finally(() => setLoading(false));
    // 강사명 선택 후보 — 계정 명단(원장만 조회 가능, 실패하면 직접 입력).
    listUsers().then((us) => setNames([...new Set(us.filter((u) => u.role !== "student").map((u) => u.name))])).catch(() => {});
  }, []);

  const update = (next: TInfo[]) => { setRows(next); setDirty(true); };
  const edit = (id: string, patch: Partial<TInfo>) => update(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const toggleSub = (id: string, key: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    edit(id, { subjects: r.subjects.includes(key) ? r.subjects.filter((k) => k !== key) : [...r.subjects, key] });
  };
  const add = () => update([...rows, { id: uid(), name: "", subjects: [], extraDuty: "", phone: "" }]);
  const remove = (id: string) => update(rows.filter((r) => r.id !== id));

  async function save() {
    setSaving(true);
    setErr("");
    try {
      await setConfig({ [CFG_KEY]: JSON.stringify(rows) });
      setDirty(false);
    } catch (e) {
      setErr(e instanceof Error && e.message.includes("원장님") ? e.message : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="eng">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">강사 정보 안내</h1>
          <p className="sm-desc">선생님별 담당 과목과 연락처를 한눈에 봐요.</p>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" onClick={add}><Icon name="plus" />강사 추가</button>
            <button className="btn primary" onClick={save} disabled={saving || !dirty}>{saving ? "저장 중…" : dirty ? "저장" : "저장됨"}</button>
          </div>
        )}
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}

      {loading ? (
        <div className="hub-muted">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="hub-muted">{canEdit ? "‘강사 추가’를 눌러 첫 강사 정보를 넣어 보세요." : "아직 등록된 강사 정보가 없어요."}</div>
      ) : (
        <div className="tbl-wrap tg-wrap">
          <table className="tbl tg-tbl">
            <thead>
              <tr>
                <th>강사명</th>
                <th>담당과목</th>
                <th>추가 업무담당</th>
                <th>연락처</th>
                {canEdit && <th aria-label="삭제" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {canEdit ? (
                    <>
                      <td><input className="input" list="tg-names" value={r.name} onChange={(e) => edit(r.id, { name: e.target.value })} placeholder="강사명" /></td>
                      <td>
                        <div className="tg-subs">
                          {TG_SUBJECTS.map((s) => (
                            <button key={s.key} type="button" className={"eng-pt" + (r.subjects.includes(s.key) ? " on" : "")} onClick={() => toggleSub(r.id, s.key)}>{s.label}</button>
                          ))}
                        </div>
                      </td>
                      <td><input className="input" value={r.extraDuty} onChange={(e) => edit(r.id, { extraDuty: e.target.value })} placeholder="예: 교재 주문·상담·SNS" /></td>
                      <td>
                        <div className="tg-telcell">
                          <input className="input" value={r.phone} onChange={(e) => edit(r.id, { phone: e.target.value })} placeholder="010-0000-0000" inputMode="tel" />
                          {r.phone.trim() && <a className="tg-callbtn" href={"tel:" + telHref(r.phone)} title="전화 걸기"><Icon name="phone" /></a>}
                        </div>
                      </td>
                      <td className="tg-delcell"><button className="btn ghost sm" onClick={() => remove(r.id)} title="삭제"><Icon name="trash" /></button></td>
                    </>
                  ) : (
                    <>
                      <td className="t-name">{r.name || "—"}</td>
                      <td>
                        {r.subjects.length ? <div className="tg-view-tags">{r.subjects.map((k) => <span className="badge b-blue" key={k}>{subLabel(k)}</span>)}</div> : <span className="hub-muted">—</span>}
                      </td>
                      <td>{r.extraDuty || <span className="hub-muted">—</span>}</td>
                      <td>
                        {r.phone.trim() ? <a className="tg-tel" href={"tel:" + telHref(r.phone)}><Icon name="phone" />{r.phone}</a> : <span className="hub-muted">—</span>}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <datalist id="tg-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
    </div>
  );
}
