import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Icon } from "../icons";
import { Scoreboard } from "../components/Scoreboard";
import { baseballApi, type ClassResp, type ClassRow, type LogEntry } from "../lib/baseballApi";
import { type BaseballRule, type RuleTrigger, type BaseballConfig } from "../lib/baseball";

/* 수학 야구(수학 전광판) — 선생님 관리 화면.
 *  · 반 학생별 스트라이크·볼·아웃 현황(출결·숙제에서 자동 반영).
 *  · 볼 주기 / 스트라이크 취소 / 아웃 면제 / 보충 완료 / 자동 스트라이크 무효화(+메모).
 *  · 벌·상 항목(규칙)과 기준값을 추가·수정·삭제. */

const TRIGGER_OPTS: { v: RuleTrigger; label: string }[] = [
  { v: "att:무단결석", label: "무단결석(출결)" },
  { v: "att:지각", label: "지각(출결)" },
  { v: "att:결석", label: "결석(출결)" },
  { v: "att:조퇴", label: "조퇴(출결)" },
  { v: "att:attitude_미흡", label: "수업태도 미흡(출결)" },
  { v: "hw:late", label: "숙제 지연(숙제)" },
  { v: "hw:low", label: "숙제 완성도 이하(숙제)" },
  { v: "manual", label: "수동(선생님이 직접)" },
];
const KIND_LABEL: Record<string, string> = {
  strike: "스트라이크", ball: "볼", cancel_strike: "스트라이크 취소", exempt_out: "아웃 면제", makeup_done: "보충 완료",
};

function MiniDots({ filled, total, tone }: { filled: number; total: number; tone: string }) {
  return (
    <span className="bb-dots sm">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={"bb-dot " + (i < filled ? "on bb-" + tone : "")} />
      ))}
    </span>
  );
}

export function MathBaseball() {
  const { toast } = useStore();
  const [view, setView] = useState<ClassResp | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string>(""); // 펼친 학생 id
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  async function refresh() {
    try { setView(await baseballApi.classView()); setErr(""); }
    catch (e) { setErr(String((e as Error)?.message || e)); }
  }
  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), 30000);
    return () => clearInterval(iv);
  }, []);

  const students = useMemo(() => {
    const list = view?.students || [];
    const qq = q.trim().toLowerCase();
    return qq ? list.filter((s) => (s.name + " " + s.grade).toLowerCase().includes(qq)) : list;
  }, [view, q]);

  async function act(fn: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(true);
    try { await fn(); await refresh(); toast(done); }
    catch (e) { toast("실패: " + String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  }

  const giveBall = (sid: string, r: BaseballRule) => act(() => baseballApi.addEvent({ studentId: sid, kind: "ball", points: r.points, label: r.label }), `볼 +${r.points} (${r.label})`);
  const cancelStrike = (sid: string) => act(() => baseballApi.addEvent({ studentId: sid, kind: "cancel_strike", points: 1, label: "스트라이크 취소", memo }), "스트라이크 1개 취소");
  const exemptOut = (sid: string) => act(() => baseballApi.addEvent({ studentId: sid, kind: "exempt_out", points: 1, label: "아웃 면제", memo }), "아웃 1개 면제");
  const addStrike = (sid: string) => act(() => baseballApi.addEvent({ studentId: sid, kind: "strike", points: 1, label: memo.trim() || "수동 스트라이크", memo }), "스트라이크 +1");
  const makeupDone = (sid: string) => act(() => baseballApi.addEvent({ studentId: sid, kind: "makeup_done", label: "보충 완료", memo }), "보충 완료 처리");
  const ignoreAuto = (sid: string, e: LogEntry) => act(() => baseballApi.addEvent({ studentId: sid, kind: "ignore_auto", ref: e.id, label: e.label + " 무효화", memo }), "자동 스트라이크 무효화");
  const undoIgnore = (e: LogEntry) => act(() => baseballApi.delEvent(e.ignoreEventId), "무효화 되돌림");
  const delManual = (e: LogEntry) => act(() => baseballApi.delEvent(e.id), "기록 삭제");

  const ballRules = (view?.rules || []).filter((r) => r.kind === "ball" && r.enabled).sort((a, b) => a.sort - b.sort);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">수학 야구</h1>
          <p className="page-sub">출결·숙제가 자동으로 스트라이크·볼·아웃에 반영돼요. 학생 화면 ‘수학 전광판’에 실시간으로 보여요.</p>
        </div>
        <div className="page-head-actions">
          <button className="btn ghost" onClick={() => void refresh()}><Icon name="refresh" /> 새로고침</button>
          <button className="btn" onClick={() => setRulesOpen(true)}><Icon name="edit" /> 벌·상 항목 설정</button>
        </div>
      </div>

      <div className="bb-search">
        <input className="input" placeholder="학생 이름·학년으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {err && <div className="bb-error">현황을 불러오지 못했어요. 잠시 후 다시 시도해 주세요. ({err})</div>}
      {!view && !err && <div className="bb-loading">불러오는 중…</div>}
      {view && students.length === 0 && <div className="empty">수학 수강생이 없어요.</div>}

      <div className="bb-list">
        {students.map((s) => (
          <StudentCard
            key={s.id} s={s} expanded={open === s.id}
            onToggle={() => { setOpen(open === s.id ? "" : s.id); setMemo(""); }}
            ballRules={ballRules} busy={busy} memo={memo} setMemo={setMemo}
            onBall={giveBall} onCancel={cancelStrike} onExempt={exemptOut} onAddStrike={addStrike}
            onMakeup={makeupDone} onIgnore={ignoreAuto} onUndoIgnore={undoIgnore} onDelManual={delManual}
          />
        ))}
      </div>

      {rulesOpen && view && <RulesEditor rules={view.rules} cfg={view.cfg} onClose={() => setRulesOpen(false)} onSaved={async () => { setRulesOpen(false); await refresh(); toast("규칙을 저장했어요"); }} />}
    </div>
  );
}

function StudentCard({ s, expanded, onToggle, ballRules, busy, memo, setMemo, onBall, onCancel, onExempt, onAddStrike, onMakeup, onIgnore, onUndoIgnore, onDelManual }: {
  s: ClassRow; expanded: boolean; onToggle: () => void; ballRules: BaseballRule[]; busy: boolean; memo: string; setMemo: (v: string) => void;
  onBall: (sid: string, r: BaseballRule) => void; onCancel: (sid: string) => void; onExempt: (sid: string) => void; onAddStrike: (sid: string) => void;
  onMakeup: (sid: string) => void; onIgnore: (sid: string, e: LogEntry) => void; onUndoIgnore: (e: LogEntry) => void; onDelManual: (e: LogEntry) => void;
}) {
  const b = s.board;
  return (
    <div className={"bb-card" + (expanded ? " open" : "")}>
      <div className="bb-card-top" onClick={onToggle}>
        <div className="bb-card-id">
          <b className="bb-card-name">{s.name}</b>
          <span className="bb-card-grade">{s.grade}</span>
        </div>
        <div className="bb-card-dots">
          <MiniDots filled={b.S} total={3} tone="strike" />
          <MiniDots filled={b.B} total={4} tone="ball" />
          <MiniDots filled={b.O} total={3} tone="out" />
        </div>
        <div className="bb-card-side">
          <span className="bb-countbadge">현재 S{b.S} B{b.B} O{b.O}</span>
          <span className="bb-rounds-chip">{b.penaltyRounds + 1}회</span>
          {b.pendingMakeup && <span className="bb-status bb-st-makeup">보충</span>}
          <span className="bb-card-caret"><Icon name="chev" /></span>
        </div>
      </div>

      {/* 볼 주기 — 항상 보이는 빠른 버튼 */}
      <div className="bb-ballbar" onClick={(e) => e.stopPropagation()}>
        <span className="bb-ballbar-l">볼 주기</span>
        {ballRules.map((r) => (
          <button key={r.id} className="bb-ballbtn" disabled={busy} onClick={() => onBall(s.id, r)}>{r.label} <em>+{r.points}</em></button>
        ))}
      </div>

      {expanded && (
        <div className="bb-detail">
          <Scoreboard board={b} />

          <div className="bb-actions">
            <input className="input bb-memo" placeholder="메모(취소·면제 사유 — 선택)" value={memo} onChange={(e) => setMemo(e.target.value)} />
            <div className="bb-actbtns">
              <button className="btn ghost" disabled={busy || b.S === 0} onClick={() => onCancel(s.id)}>스트라이크 취소</button>
              <button className="btn ghost" disabled={busy || b.O === 0} onClick={() => onExempt(s.id)}>아웃 면제</button>
              <button className="btn ghost" disabled={busy} onClick={() => onAddStrike(s.id)}>직접 스트라이크</button>
              {b.pendingMakeup && <button className="btn primary" disabled={busy} onClick={() => onMakeup(s.id)}>보충 완료</button>}
            </div>
          </div>

          {/* 기록 목록 — 수정·삭제 */}
          <div className="bb-log">
            <p className="bb-log-h">기록 (자동/수동) — 수정·삭제</p>
            {s.log.length === 0 && <p className="bb-log-empty">아직 기록이 없어요.</p>}
            {s.log.map((e) => (
              <div className={"bb-log-row" + (e.ignored ? " ignored" : "")} key={e.id}>
                <span className={"bb-log-tag tag-" + (e.source === "auto" ? "auto" : e.kind)}>{e.source === "auto" ? "자동" : KIND_LABEL[e.kind] || e.kind}</span>
                <span className="bb-log-label">{e.label}{e.kind === "strike" || e.source === "auto" ? ` · S+${e.points}` : e.kind === "ball" ? ` · 볼+${e.points}` : ""}</span>
                {e.memo && <span className="bb-log-memo">“{e.memo}”</span>}
                <span className="bb-log-date">{e.date.slice(5).replace("-", "/")}</span>
                {e.source === "auto" ? (
                  e.ignored
                    ? <button className="bb-log-btn undo" disabled={busy} onClick={() => onUndoIgnore(e)}>되돌리기</button>
                    : <button className="bb-log-btn" disabled={busy} onClick={() => onIgnore(s.id, e)}>무효화</button>
                ) : (
                  <button className="bb-log-btn del" disabled={busy} onClick={() => onDelManual(e)} aria-label="삭제"><Icon name="trash" /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* 규칙 한 묶음(벌/상) — 최상위 컴포넌트로 분리해 입력할 때마다 리마운트되지 않게(렉 방지). */
function RuleSection({ draft, kind, title, upd, del, add }: {
  draft: BaseballRule[]; kind: "strike" | "ball"; title: string;
  upd: (i: number, patch: Partial<BaseballRule>) => void; del: (i: number) => void; add: (kind: "strike" | "ball") => void;
}) {
  return (
    <div className="bb-rsec">
      <div className="bb-rsec-h"><b>{title}</b><button className="btn ghost sm" onClick={() => add(kind)}><Icon name="plus" /> 항목 추가</button></div>
      {draft.map((r, i) => r.kind !== kind ? null : (
        <div className="bb-rrow" key={i}>
          <input className="input" placeholder="항목 이름" value={r.label} onChange={(e) => upd(i, { label: e.target.value })} />
          <label className="bb-rpt">{kind === "ball" ? "볼" : "S"} <input className="input num" type="number" min={1} value={r.points} onChange={(e) => upd(i, { points: Math.max(1, +e.target.value || 1) })} /></label>
          {kind === "strike" && (
            <select className="input" value={r.trigger} onChange={(e) => upd(i, { trigger: e.target.value as RuleTrigger })}>
              {TRIGGER_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          )}
          {kind === "strike" && r.trigger === "hw:low" && (
            <label className="bb-rpt">≤<input className="input num" type="number" min={0} max={100} value={r.threshold ?? 50} onChange={(e) => upd(i, { threshold: +e.target.value || 0 })} />%</label>
          )}
          <label className="bb-rtoggle"><input type="checkbox" checked={r.enabled} onChange={(e) => upd(i, { enabled: e.target.checked })} /> 사용</label>
          <button className="bb-log-btn del" onClick={() => del(i)} aria-label="삭제"><Icon name="trash" /></button>
        </div>
      ))}
    </div>
  );
}

/* ───────── 벌·상 항목(규칙) + 기준값 설정 모달 ───────── */
function RulesEditor({ rules, cfg, onClose, onSaved }: { rules: BaseballRule[]; cfg: BaseballConfig; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<BaseballRule[]>(() => rules.map((r) => ({ ...r })));
  const [c, setC] = useState<BaseballConfig>({ ...cfg });
  const [saving, setSaving] = useState(false);

  const upd = (i: number, patch: Partial<BaseballRule>) => setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const del = (i: number) => setDraft((d) => d.filter((_, j) => j !== i));
  const add = (kind: "strike" | "ball") => setDraft((d) => [...d, { id: "", kind, label: "", points: 1, trigger: "manual", threshold: 50, enabled: true, sort: d.filter((r) => r.kind === kind).length }]);

  async function save() {
    setSaving(true);
    try { await baseballApi.saveRules(draft.filter((r) => r.label.trim()), c); onSaved(); }
    catch { setSaving(false); }
  }

  return (
    <div className="prof-overlay bb-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bb-rules-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} aria-label="닫기"><Icon name="x" /></button>
        <h2 className="bb-rules-title">벌·상 항목 설정</h2>
        <p className="bb-rules-sub">출결·숙제에서 자동으로 인식할 벌(스트라이크)과, 선생님이 직접 줄 상(볼)을 정해요.</p>

        <RuleSection draft={draft} kind="strike" title="벌 — 스트라이크 (자동 인식)" upd={upd} del={del} add={add} />
        <RuleSection draft={draft} kind="ball" title="상 — 볼 (선생님이 직접)" upd={upd} del={del} add={add} />

        <div className="bb-cfg">
          <b className="bb-cfg-h">기준값</b>
          <div className="bb-cfg-grid">
            <label>스트라이크 → 아웃<input className="input num" type="number" min={1} value={c.strikesPerOut} onChange={(e) => setC({ ...c, strikesPerOut: Math.max(1, +e.target.value || 1) })} /></label>
            <label>볼 → 아웃 삭제<input className="input num" type="number" min={1} value={c.ballsToClearOut} onChange={(e) => setC({ ...c, ballsToClearOut: Math.max(1, +e.target.value || 1) })} /></label>
            <label>아웃 → 보충<input className="input num" type="number" min={1} value={c.outsForMakeup} onChange={(e) => setC({ ...c, outsForMakeup: Math.max(1, +e.target.value || 1) })} /></label>
            <label>볼 하루 한도<input className="input num" type="number" min={1} value={c.dailyBallCap} onChange={(e) => setC({ ...c, dailyBallCap: Math.max(1, +e.target.value || 1) })} /></label>
            <label className="bb-cfg-wide"><input type="checkbox" checked={c.monthlyReset} onChange={(e) => setC({ ...c, monthlyReset: e.target.checked })} /> 매월 1일 초기화 (보충 누적 회차는 유지)</label>
            <label className="bb-cfg-wide">시작일(이전 기록 제외)<input className="input" type="date" value={c.since} onChange={(e) => setC({ ...c, since: e.target.value })} /></label>
          </div>
        </div>

        <div className="bb-rules-foot">
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn primary" disabled={saving} onClick={save}>{saving ? "저장 중…" : "저장"}</button>
        </div>
      </div>
    </div>
  );
}
