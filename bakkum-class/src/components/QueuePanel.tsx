// 강사 대시보드 번호표 대기열 — 번호순, 호출/완료, 학생 손들기 표시.
import { useEffect, useRef, useState } from "react";
import { queueApi, SUBJECT_LABEL, type QueueRow, type QueueSubject } from "../lib/queueApi";
import { Icon } from "../icons";

export function QueuePanel({ subject }: { subject: QueueSubject }) {
  const [list, setList] = useState<QueueRow[]>([]);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = () => queueApi.list(subject).then((l) => { if (alive.current) setList(l); }).catch(() => {});
  useEffect(() => {
    alive.current = true;
    void load();
    const iv = window.setInterval(load, 10000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { alive.current = false; window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try { await fn(); await load(); } catch { /* ignore */ } finally { setBusy(false); }
  }

  const raisedCount = list.filter((r) => r.raised).length;

  return (
    <div className="card sec-gap qp">
      <div className="card-head">
        <div>
          <div className="card-title">번호표 대기열 <span className="qp-subj">{SUBJECT_LABEL[subject]}</span></div>
          <div className="card-sub">학생이 뽑은 순서대로 — 호출하면 학생 화면에 ‘차례’ 알림, 완료하면 줄에서 빠져요</div>
        </div>
        {raisedCount > 0 && <span className="qp-raised-badge"><Icon name="bell" /> 손든 학생 {raisedCount}</span>}
      </div>
      {list.length === 0 ? (
        <div className="qp-empty">대기 중인 학생이 없어요.</div>
      ) : (
        <div className="qp-list">
          {list.map((r) => (
            <div className={"qp-row" + (r.status === "called" ? " called" : "") + (r.raised ? " raised" : "")} key={r.id}>
              <span className="qp-num">{r.number}</span>
              <span className="qp-name">{r.name}</span>
              {r.raised && <span className="qp-raised">손듦</span>}
              {r.status === "called" && <span className="qp-called">호출됨</span>}
              <div className="qp-btns">
                <button className="btn ghost sm" disabled={busy} onClick={() => act(() => queueApi.call(r.id))}>호출</button>
                <button className="btn primary sm" disabled={busy} onClick={() => act(() => queueApi.done(r.id))}>완료</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
