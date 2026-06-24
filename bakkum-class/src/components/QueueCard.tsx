// 학생 번호표 — 과목별 뽑기·내 순번·손들기. 강사가 호출하면 '당신 차례' 강조.
import { useEffect, useRef, useState } from "react";
import { queueApi, SUBJECT_LABEL, type MineResp, type QueueSubject } from "../lib/queueApi";

export function QueueCard() {
  const [data, setData] = useState<MineResp | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = () => queueApi.mine().then((d) => { if (alive.current) setData(d); }).catch(() => {});
  useEffect(() => {
    alive.current = true;
    void load();
    const iv = window.setInterval(load, 12000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { alive.current = false; window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);

  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try { await fn(); await load(); } catch { /* ignore */ } finally { setBusy(false); }
  }

  if (!data || data.subjects.length === 0) return null;

  return (
    <div className="qc">
      {data.subjects.map((s) => {
        const t = data.tickets[s] || null;
        const called = t?.status === "called";
        return (
          <div key={s} className={"qc-row" + (called ? " called" : "")}>
            <span className="qc-subj">{SUBJECT_LABEL[s as QueueSubject]} 번호표</span>
            {!t ? (
              <button className="btn primary sm qc-draw" disabled={busy} onClick={() => act(() => queueApi.draw(s))}>번호 뽑기</button>
            ) : called ? (
              <div className="qc-called">
                <b className="qc-num">{t.number}번</b>
                <span className="qc-called-txt">🙋 당신 차례예요! 들어오세요</span>
                <button className="btn ghost sm" disabled={busy} onClick={() => act(() => queueApi.cancel(s))}>취소</button>
              </div>
            ) : (
              <div className="qc-active">
                <b className="qc-num">{t.number}번</b>
                <span className="qc-ahead">{t.ahead === 0 ? "곧 내 차례!" : `앞에 ${t.ahead}명`}</span>
                <button className={"btn sm" + (t.raised ? " primary" : " ghost")} disabled={busy || t.raised} onClick={() => act(() => queueApi.raise(s))}>{t.raised ? "손든 중 ✋" : "손들기"}</button>
                <button className="btn ghost sm" disabled={busy} onClick={() => act(() => queueApi.cancel(s))}>취소</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
