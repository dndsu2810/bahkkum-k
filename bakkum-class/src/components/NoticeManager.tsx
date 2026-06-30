import { useEffect, useState } from "react";
import { feedbackApi, type Notice } from "../lib/feedbackApi";
import { NOTICE_AUDIENCES, audienceLabel, type NoticeAudience } from "../lib/notice";
import { Icon } from "../icons";

/** 공지 배너 관리 — 짧은 배너 문구 + 세부 내용(누르면 펼침)을 올리고/수정하고/내리고/지운다.
 *  설정 화면과 공지사항 화면에서 공용으로 쓴다(원장 전용 API). */
export function NoticeManager() {
  const [list, setList] = useState<Notice[]>([]);
  const [editId, setEditId] = useState<string | null>(null); // 수정 중인 공지 id(없으면 새 글)
  const [text, setText] = useState("");
  const [detail, setDetail] = useState("");
  const [level, setLevel] = useState<"info" | "warn">("info");
  const [audience, setAudience] = useState<NoticeAudience>("staff");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setList(await feedbackApi.noticesAll());
    } catch {
      /* ignore */
    }
  }
  useEffect(() => { void reload(); }, []);

  function resetForm() {
    setEditId(null);
    setText("");
    setDetail("");
    setLevel("info");
    setAudience("staff");
  }
  // 목록의 배너를 폼으로 불러와 수정 모드로. 활성/비활성은 그대로 유지된다.
  function startEdit(n: Notice) {
    setEditId(n.id);
    setText(n.text);
    setDetail(n.detail);
    setLevel(n.level);
    setAudience(n.audience as NoticeAudience);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function post() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const cur = editId ? list.find((n) => n.id === editId) : null;
      await feedbackApi.saveNotice({
        id: editId || undefined,
        text: text.trim(),
        detail: detail.trim(),
        level,
        audience,
        active: cur ? cur.active : true, // 수정 시 올림/내림 상태 보존
      });
      resetForm();
      await reload();
    } finally {
      setBusy(false);
    }
  }
  async function toggle(n: Notice) {
    await feedbackApi.saveNotice({ id: n.id, text: n.text, detail: n.detail, level: n.level, audience: n.audience, active: !n.active });
    await reload();
  }
  async function remove(n: Notice) {
    await feedbackApi.removeNotice(n.id);
    if (editId === n.id) resetForm();
    await reload();
  }

  return (
    <div className="card sec-gap" style={{ padding: 16, marginTop: 14 }}>
      <div className="card-title" style={{ marginBottom: 6 }}>공지 배너{editId && <span className="badge b-blue" style={{ marginLeft: 8 }}>수정 중</span>}</div>
      <div className="page-desc" style={{ marginBottom: 12 }}>대상을 골라 그 사람들 화면 상단에 한 줄로 띄워요(전체·강사만·학생 전체·초등영어·중고등영어). 목록의 ‘수정’을 누르면 여기로 불러와 고칠 수 있어요.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label className="ntc-f">
          <span>배너에 보일 문구</span>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="짧게 한 줄 (예: 오늘 6시 회의 있어요)" onKeyDown={(e) => e.key === "Enter" && post()} />
        </label>
        <label className="ntc-f">
          <span>세부 내용 <span style={{ color: "var(--ink3)", fontWeight: 400 }}>(선택 — 배너를 누르면 보여요)</span></span>
          <textarea className="input" style={{ minHeight: 72, resize: "vertical" }} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="배너를 눌렀을 때 펼쳐 보일 자세한 안내. 비우면 위 문구만 보여요." />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select className="input" style={{ width: 150 }} value={audience} onChange={(e) => setAudience(e.target.value as NoticeAudience)}>
            {NOTICE_AUDIENCES.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
          </select>
          <select className="input" style={{ width: 100 }} value={level} onChange={(e) => setLevel(e.target.value as "info" | "warn")}>
            <option value="info">공지(파랑)</option>
            <option value="warn">중요(주황)</option>
          </select>
          {editId && <button className="btn ghost" onClick={resetForm} disabled={busy}>취소</button>}
          <button className="btn primary" style={{ marginLeft: editId ? 0 : "auto" }} onClick={post} disabled={!text.trim() || busy}>{editId ? "수정 저장" : "게시"}</button>
        </div>
      </div>
      {list.length > 0 && (
        <div className="rep-list" style={{ marginTop: 12 }}>
          {list.map((n) => (
            <div className={"rep-itemrow" + (editId === n.id ? " on" : "")} key={n.id}>
              <span className={"notice-dot " + (n.level === "warn" ? "warn" : "info")} />
              <span style={{ flex: 1, minWidth: 140, opacity: n.active ? 1 : 0.5 }}>{n.text}{n.detail ? <span className="badge b-gray" style={{ marginLeft: 6 }}>세부</span> : null}</span>
              <span className={"badge " + (n.audience === "all" ? "b-blue" : n.audience === "staff" ? "b-gray" : "b-purple")}>{audienceLabel(n.audience)}</span>
              <button className="btn ghost sm" onClick={() => startEdit(n)}>수정</button>
              <button className="btn ghost sm" onClick={() => toggle(n)}>{n.active ? "내리기" : "올리기"}</button>
              <button className="rep-x" onClick={() => remove(n)} title="삭제"><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
