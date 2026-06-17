import { useEffect, useMemo, useState } from "react";
import { messageApi, type Message } from "../lib/messageApi";
import { fmtWhen } from "../lib/dates";
import { Icon } from "../icons";
import { EmptyHive } from "../soez";

/** 학생에게 메시지 보내기 — 원장·수학 담당. 단체/다중 발송, 학생 1명당 1건 개별 생성. */
export function MessageSend() {
  // 발송 대상: 개별 로그인이 되는 학생 전체(과목 무관) — 백엔드가 생일 등록·숨김 아님 기준으로 제공.
  const [loginable, setLoginable] = useState<{ id: string; name: string; grade: string }[]>([]);
  useEffect(() => { messageApi.students().then(setLoginable).catch(() => {}); }, []);

  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim();
    return t ? loginable.filter((s) => s.name.includes(t)) : loginable;
  }, [loginable, q]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");
  const [sent, setSent] = useState<Message[]>([]);

  const reloadSent = () => messageApi.sent().then(setSent).catch(() => {});
  useEffect(() => {
    void reloadSent();
    // 화면을 열면 받은 답장을 '확인함'으로 처리하고, 사이드바 빨간 배지를 비운다.
    void messageApi.markRepliesSeen().then(() => window.dispatchEvent(new Event("msg-replies-seen"))).catch(() => {});
  }, []);

  // '전체 선택'은 현재 검색으로 보이는 학생 기준.
  const allShownOn = shown.length > 0 && shown.every((s) => selected.has(String(s.id)));
  function toggle(id: string) {
    setSelected((cur) => {
      const n = new Set(cur);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((cur) => {
      const n = new Set(cur);
      if (allShownOn) shown.forEach((s) => n.delete(String(s.id)));
      else shown.forEach((s) => n.add(String(s.id)));
      return n;
    });
  }

  async function send() {
    if (!body.trim() || !selected.size || sending) return;
    setSending(true);
    setErr("");
    try {
      const recipients = loginable.filter((s) => selected.has(String(s.id))).map((s) => ({ id: String(s.id), name: s.name }));
      const r = await messageApi.send(recipients, body.trim());
      setDone(`${r.count ?? recipients.length}명에게 보냈어요.`);
      setBody("");
      setSelected(new Set());
      setTimeout(() => setDone(""), 3000);
      void reloadSent();
    } catch {
      setErr("발송에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setSending(false);
    }
  }

  // 보낸 기록 — 발송 묶음(batch)별로 그룹.
  const batches = useMemo(() => {
    const m = new Map<string, Message[]>();
    for (const x of sent) {
      const k = x.batchId || x.id;
      const arr = m.get(k);
      if (arr) arr.push(x);
      else m.set(k, [x]);
    }
    return [...m.values()].sort((a, b) => b[0].createdAt - a[0].createdAt);
  }, [sent]);

  return (
    <div className="msg-send">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">학생에게 메시지 보내기</h1>
          <p className="sm-desc">고른 학생에게 알림을 보냅니다. 학생은 받은 메시지에 한 번만 답장할 수 있어요.</p>
        </div>
      </div>

      {/* 작성 */}
      <div className="card msg-compose">
        <div className="msg-target-head">
          <span className="msg-label">받는 학생 <b>{selected.size}</b>명 선택 <span className="msg-sub">· 로그인 가능 {loginable.length}명</span></span>
          <button className="btn ghost sm" onClick={toggleAll}>{allShownOn ? "전체 해제" : "전체 선택"}</button>
        </div>
        <input className="input msg-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 이름 검색" />
        <div className="msg-targets">
          {loginable.length === 0 ? (
            <div className="hub-muted">로그인 가능한 학생이 없어요. (학생 명단에 생년월일이 등록돼야 로그인·수신 가능)</div>
          ) : shown.length === 0 ? (
            <div className="hub-muted">‘{q}’ 검색 결과가 없어요.</div>
          ) : (
            shown.map((s) => {
              const on = selected.has(String(s.id));
              return (
                <button key={s.id} className={"msg-chip" + (on ? " on" : "")} onClick={() => toggle(String(s.id))}>
                  {s.name}
                </button>
              );
            })
          )}
        </div>
        <textarea
          className="input msg-body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="보낼 메시지를 입력하세요."
        />
        <div className="msg-foot">
          <button className="btn primary" onClick={send} disabled={!body.trim() || !selected.size || sending}>
            {sending ? "보내는 중…" : "보내기"}
          </button>
          {done && <span className="msg-ok"><Icon name="check" /> {done}</span>}
          {err && <span className="auth-err" style={{ margin: 0 }}>{err}</span>}
        </div>
      </div>

      {/* 보낸 기록 */}
      <div className="msg-sec-h">보낸 기록</div>
      {batches.length === 0 ? (
        <EmptyHive caption="아직 보낸 메시지가 없어요" />
      ) : (
        <div className="msg-sent-list">
          {batches.map((grp) => {
            const first = grp[0];
            const readN = grp.filter((g) => g.readAt > 0).length;
            const replyN = grp.filter((g) => g.replyAt > 0).length;
            return (
              <div className="card msg-batch" key={first.batchId || first.id}>
                <div className="msg-batch-top">
                  <span className="msg-batch-when">{fmtWhen(first.createdAt)}</span>
                  <span className="msg-batch-stat">{grp.length}명 · 읽음 {readN} · 답장 {replyN}</span>
                </div>
                <div className="msg-batch-body">{first.body}</div>
                <div className="msg-recips">
                  {grp.map((g) => (
                    <div className={"msg-recip" + (g.replyAt > 0 ? " replied" : g.readAt > 0 ? " read" : "")} key={g.id}>
                      <span className="msg-recip-name">{g.recipientName || g.recipientId}</span>
                      <span className="msg-recip-st">{g.replyAt > 0 ? "답장함" : g.readAt > 0 ? "읽음" : "안읽음"}</span>
                      {g.replyBody && <span className="msg-recip-reply">“{g.replyBody}”</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
