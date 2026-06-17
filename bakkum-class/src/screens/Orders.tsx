import { useEffect, useMemo, useState } from "react";
import { ordersApi, type Order, type OrderKind } from "../lib/ordersApi";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { fmtWhen } from "../lib/dates";
import { Icon } from "../icons";

type Tab = "all" | "교재" | "비품";

// 교재: 주문·배송·배부(대상 전원) / 비품: 주문·배송·비치(위치 입력)
function isDone(o: Order): boolean {
  if (!o.purchased || !o.shipped) return false;
  if (o.kind === "교재") return o.studentIds.length === 0 || o.studentIds.every((id) => o.distributedIds.includes(id));
  return o.placed || !!o.place.trim();
}

export function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editOrder, setEditOrder] = useState<Order | null>(null);

  const nameOf = (id: string) => roster.find((s) => s.id === id)?.name ?? "(학생)";

  async function load() {
    setLoading(true);
    try { setOrders(await ordersApi.list()); setErr(""); }
    catch { setErr("불러오지 못했어요."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); getRoster().then(setRoster).catch(() => {}); }, []);

  async function patch(o: Order, p: Partial<Order>) {
    try { await ordersApi.update({ id: o.id, ...p }); await load(); window.dispatchEvent(new Event("orders-changed")); }
    catch { setErr("저장에 실패했어요."); }
  }
  async function remove(o: Order) {
    if (!window.confirm(`'${o.name}' 신청을 삭제할까요?`)) return;
    try { await ordersApi.remove(o.id); await load(); window.dispatchEvent(new Event("orders-changed")); }
    catch { setErr("삭제에 실패했어요."); }
  }

  const shown = useMemo(() => orders.filter((o) => tab === "all" || o.kind === tab), [orders, tab]);
  const pre = shown.filter((o) => !o.purchased);
  const post = shown.filter((o) => o.purchased);
  const preCount = orders.filter((o) => !o.purchased).length;

  return (
    <div className="sm-wrap ord">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">주문 관리</h1>
          <p className="sm-desc">교재·비품을 신청하면 주문 → 배송 → 배부(교재)/비치(비품)까지 단계별로 관리해요. 주문 전 건은 위에 주황색으로 표시됩니다.</p>
        </div>
        <button className="btn primary" onClick={() => { setEditOrder(null); setShowForm((v) => !v); }}><Icon name="plus" /> 신청하기</button>
      </div>

      {(showForm || editOrder) && (
        <OrderForm
          roster={roster}
          edit={editOrder}
          onDone={() => { setShowForm(false); setEditOrder(null); void load(); window.dispatchEvent(new Event("orders-changed")); }}
        />
      )}

      <div className="sm-filters" style={{ margin: "12px 0 10px" }}>
        {(["all", "교재", "비품"] as Tab[]).map((t) => (
          <button key={t} className={"sm-fchip" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>
            {t === "all" ? "전체" : t} <span className="sns-fcnt">{t === "all" ? orders.length : orders.filter((o) => o.kind === t).length}</span>
          </button>
        ))}
        {preCount > 0 && <span className="ord-pre-badge">주문 전 {preCount}</span>}
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 8 }}>{err}</div>}
      {loading ? (
        <div className="sp-muted" style={{ padding: 16 }}>불러오는 중…</div>
      ) : shown.length === 0 ? (
        <div className="issue-empty">아직 신청한 주문이 없어요.</div>
      ) : (
        <>
          {pre.length > 0 && (
            <section className="ord-sec">
              <h2 className="ord-sec-t pre">주문 전 <span>{pre.length}</span></h2>
              <div className="ord-list">{pre.map((o) => <OrderCard key={o.id} o={o} nameOf={nameOf} onPatch={patch} onRemove={remove} onEdit={() => { setEditOrder(o); setShowForm(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)}</div>
            </section>
          )}
          {post.length > 0 && (
            <section className="ord-sec">
              <h2 className="ord-sec-t post">주문 후 <span>{post.length}</span></h2>
              <div className="ord-list">{post.map((o) => <OrderCard key={o.id} o={o} nameOf={nameOf} onPatch={patch} onRemove={remove} onEdit={() => { setEditOrder(o); setShowForm(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function OrderForm({ roster, edit, onDone }: { roster: RosterStudent[]; edit?: Order | null; onDone: () => void }) {
  const [kind, setKind] = useState<OrderKind>(edit?.kind || "교재");
  const [name, setName] = useState(edit?.name || "");
  const [needBy, setNeedBy] = useState(edit?.needBy || "");
  const [studentIds, setStudentIds] = useState<string[]>(edit?.studentIds || []);
  const [qty, setQty] = useState(edit?.qty ? String(edit.qty) : "");
  const [link, setLink] = useState(edit?.link || "");
  const [reason, setReason] = useState(edit?.reason || "");
  const [forClass, setForClass] = useState(edit?.forClass || "");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const active = roster.filter((s) => (s.status || "재원") === "재원");
  const ql = q.trim().toLowerCase();
  const opts = ql ? active.filter((s) => s.name.toLowerCase().includes(ql)) : active;
  const toggle = (id: string) => setStudentIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const payload = { name: name.trim(), needBy, studentIds: kind === "교재" ? studentIds : [], qty: kind === "비품" ? Number(qty) || 0 : 0, link, reason, forClass };
    try {
      if (edit) await ordersApi.update({ id: edit.id, ...payload });
      else await ordersApi.create({ kind, ...payload });
      onDone();
    } catch { /* noop */ } finally { setBusy(false); }
  }

  return (
    <div className="ord-form card">
      {edit && <div className="ord-form-edit">‘{edit.name}’ 신청 수정 중</div>}
      <div className="ord-kind-seg">
        {(["교재", "비품"] as OrderKind[]).map((k) => (
          <button key={k} className={"seg-btn" + (kind === k ? " on" : "")} onClick={() => !edit && setKind(k)} disabled={!!edit} title={edit ? "종류는 수정할 수 없어요" : ""}>{k}</button>
        ))}
      </div>
      <div className="ord-form-grid">
        <label className="ord-f"><span>품목명</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "교재" ? "예: 쎈 중1-1" : "예: A4 용지"} /></label>
        <label className="ord-f"><span>필요한 날짜(기한)</span><input className="input" type="date" value={needBy} onChange={(e) => setNeedBy(e.target.value)} /></label>
        {kind === "비품" && <>
          <label className="ord-f"><span>수량</span><input className="input" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          <label className="ord-f"><span>필요한 수업</span><input className="input" value={forClass} onChange={(e) => setForClass(e.target.value)} placeholder="예: 중등 수학" /></label>
          <label className="ord-f wide"><span>주문 링크</span><input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="주문처 주소(선택)" /></label>
          <label className="ord-f wide"><span>주문 사유</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="왜 필요한지(선택)" /></label>
        </>}
      </div>
      {kind === "교재" && (
        <div className="ord-stusel">
          <div className="ord-f"><span>대상 학생 (여러 명 선택){studentIds.length > 0 ? ` · ${studentIds.length}명` : ""}</span></div>
          <input className="input" style={{ marginBottom: 6 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 검색" />
          <div className="ord-stuchips">
            {opts.map((s) => (
              <button key={s.id} type="button" className={"ord-stuchip" + (studentIds.includes(s.id) ? " on" : "")} onClick={() => toggle(s.id)}>{s.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="ord-form-foot">
        <button className="btn ghost" onClick={onDone}>취소</button>
        <button className="btn primary" onClick={submit} disabled={!name.trim() || busy}>{busy ? "저장 중…" : edit ? "수정 저장" : "신청"}</button>
      </div>
    </div>
  );
}

function OrderCard({ o, nameOf, onPatch, onRemove, onEdit }: { o: Order; nameOf: (id: string) => string; onPatch: (o: Order, p: Partial<Order>) => void; onRemove: (o: Order) => void; onEdit: () => void }) {
  const done = isDone(o);
  const lastStepLabel = o.kind === "교재" ? "배부완료" : "비치완료";
  const distAll = o.studentIds.length > 0 && o.studentIds.every((id) => o.distributedIds.includes(id));
  const toggleDist = (id: string) => {
    const next = o.distributedIds.includes(id) ? o.distributedIds.filter((x) => x !== id) : [...o.distributedIds, id];
    onPatch(o, { distributedIds: next });
  };
  return (
    <div className={"ord-card" + (o.purchased ? " post" : " pre") + (done ? " done" : "")}>
      <div className="ord-card-top">
        <span className={"ord-kindbadge " + (o.kind === "교재" ? "book" : "item")}>{o.kind}</span>
        <span className="ord-name">{o.name}</span>
        {done && <span className="ord-donebadge">완료</span>}
        <span className="ord-meta">{o.requester}{o.needBy ? ` · 기한 ${o.needBy}` : ""} · {fmtWhen(o.createdAt)}</span>
        <button className="btn ghost sm" onClick={onEdit} title="신청 내용 수정"><Icon name="edit" /> 수정</button>
        <button className="issue-del" onClick={() => onRemove(o)} title="삭제">×</button>
      </div>

      {o.kind === "비품" && (o.qty > 0 || o.forClass || o.reason || o.link) && (
        <div className="ord-detail">
          {o.qty > 0 && <span>수량 {o.qty}</span>}
          {o.forClass && <span>· {o.forClass}</span>}
          {o.reason && <span>· {o.reason}</span>}
          {o.link && <a href={o.link} target="_blank" rel="noopener noreferrer">주문 링크</a>}
        </div>
      )}
      {o.kind === "교재" && o.studentIds.length > 0 && (
        <div className="ord-detail">대상 {o.studentIds.length}명: {o.studentIds.map(nameOf).join(", ")}</div>
      )}

      <div className="ord-steps">
        <label className={"ord-step" + (o.purchased ? " on" : "")}>
          <input type="checkbox" checked={o.purchased} onChange={(e) => onPatch(o, { purchased: e.target.checked })} /> 주문 완료
        </label>
        <label className={"ord-step" + (o.shipped ? " on" : "")}>
          <input type="checkbox" checked={o.shipped} onChange={(e) => onPatch(o, { shipped: e.target.checked })} /> 배송완료
        </label>
        {o.kind === "비품" ? (
          <label className={"ord-step" + (o.placed || o.place ? " on" : "")}>
            <input type="checkbox" checked={o.placed || !!o.place} onChange={(e) => onPatch(o, { placed: e.target.checked })} /> {lastStepLabel}
          </label>
        ) : (
          <span className={"ord-step static" + (distAll ? " on" : "")}>{lastStepLabel}{o.studentIds.length > 0 ? ` (${o.distributedIds.filter((id) => o.studentIds.includes(id)).length}/${o.studentIds.length})` : ""}</span>
        )}
      </div>

      {o.kind === "비품" && o.shipped && (
        <input className="input ord-place" defaultValue={o.place} placeholder="비치 위치 (적으면 비치완료)" onBlur={(e) => { const v = e.target.value.trim(); if (v !== o.place) onPatch(o, { place: v, placed: !!v }); }} />
      )}
      {o.kind === "교재" && o.shipped && o.studentIds.length > 0 && (
        <div className="ord-distrib">
          <span className="ord-distrib-l">배부 체크:</span>
          {o.studentIds.map((id) => (
            <button key={id} type="button" className={"ord-stuchip sm" + (o.distributedIds.includes(id) ? " on" : "")} onClick={() => toggleDist(id)}>{nameOf(id)}</button>
          ))}
        </div>
      )}
    </div>
  );
}
