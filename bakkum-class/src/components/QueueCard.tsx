// 학생 번호표 — 과목별 뽑기·내 순번·손들기. 강사가 호출하면 큰 배너 + 음성 안내.
import { useEffect, useRef, useState } from "react";
import { queueApi, SUBJECT_LABEL, type MineResp, type QueueSubject } from "../lib/queueApi";
import { useAuth } from "../auth";
import { Icon } from "../icons";

/** 한국어 음성 안내(가능한 기기에서). 사용자가 화면을 쓰는 중이라 보통 재생됨. */
function speak(text: string) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* 음성 미지원은 무시 */ }
}

export function QueueCard() {
  const { user } = useAuth();
  const name = user?.name || "";
  const [data, setData] = useState<MineResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [alertSub, setAlertSub] = useState<QueueSubject | null>(null); // 큰 '차례' 배너
  const alive = useRef(true);
  const lastCalledAt = useRef<Record<string, number>>({}); // 과목별 마지막 호출 시각(중복 음성 방지)

  const load = () =>
    queueApi.mine().then((d) => {
      if (!alive.current) return;
      // 새 호출(또는 다시 호출) 감지 → 음성 + 큰 배너.
      for (const s of d.subjects) {
        const t = d.tickets[s];
        if (t && t.status === "called" && t.calledAt && t.calledAt !== lastCalledAt.current[s]) {
          lastCalledAt.current[s] = t.calledAt;
          speak(`${name} 차례입니다`);
          setAlertSub(s);
        }
        if (!t || t.status !== "called") { if (alertSub === s) setAlertSub(null); }
      }
      setData(d);
    }).catch(() => {});

  useEffect(() => {
    alive.current = true;
    void load();
    const iv = window.setInterval(load, 12000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { alive.current = false; window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try { await fn(); await load(); } catch { /* ignore */ } finally { setBusy(false); }
  }

  if (!data || data.subjects.length === 0) return null;

  return (
    <>
      {/* 큰 '차례' 배너(상단 고정) — 호출되면 눈에 띄게. 확인 누르면 닫힘(다시 호출 전까지). */}
      {alertSub && (
        <div className="qc-turn" role="alert">
          <span className="qc-turn-ic"><Icon name="bell" /></span>
          <div className="qc-turn-txt">
            <b>{name} 차례입니다</b>
            <span>{SUBJECT_LABEL[alertSub]} · 들어오세요</span>
          </div>
          <button className="btn sm qc-turn-x" onClick={() => setAlertSub(null)}>확인</button>
        </div>
      )}

      <section className="sp-card qc-card">
        <h3 className="sp-card-h">번호표</h3>
        <div className="qc">
          {data.subjects.map((s) => {
            const t = data.tickets[s] || null;
            const called = t?.status === "called";
            return (
              <div key={s} className={"qc-row" + (called ? " called" : "")}>
                <span className="qc-subj">{SUBJECT_LABEL[s as QueueSubject]}</span>
                {!t ? (
                  <button className="btn primary sm qc-draw" disabled={busy} onClick={() => act(() => queueApi.draw(s))}>번호 뽑기</button>
                ) : called ? (
                  <div className="qc-called">
                    <b className="qc-num">{t.number}번</b>
                    <span className="qc-called-txt"><span className="qc-called-ic"><Icon name="bell" /></span>내 차례예요</span>
                    <button className="btn ghost sm" disabled={busy} onClick={() => act(() => queueApi.cancel(s))}>취소</button>
                  </div>
                ) : (
                  <div className="qc-active">
                    <b className="qc-num">{t.number}번</b>
                    <span className="qc-ahead">{t.ahead === 0 ? "곧 내 차례예요" : `앞에 ${t.ahead}명 남았어요`}</span>
                    <button className={"btn sm" + (t.raised ? " primary" : " ghost")} disabled={busy || t.raised} onClick={() => act(() => queueApi.raise(s))}>{t.raised ? "손든 중" : "손들기"}</button>
                    <button className="btn ghost sm" disabled={busy} onClick={() => act(() => queueApi.cancel(s))}>취소</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="qc-hint">선생님이 부르면 화면에 ‘차례’ 표시와 함께 안내가 나와요.</p>
      </section>
    </>
  );
}
