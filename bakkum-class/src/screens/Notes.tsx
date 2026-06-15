import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { notesApi, type NoteItem } from "../lib/hubApi";
import { fmtWhen } from "../lib/dates";

/** 강사 특이사항 — 학생별 시간순 누적, 전 강사 공용 열람. */
export function Notes() {
  const { user } = useAuth();
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [sel, setSel] = useState<string>(""); // 선택 학생 id ('' = 전체 피드)
  const [q, setQ] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function reload() {
    try {
      const [r, n] = await Promise.all([getRoster(), notesApi.list()]);
      setRoster(r);
      setNotes(n);
      setErr("");
    } catch {
      setErr("불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of roster) m[s.id] = s.name;
    return m;
  }, [roster]);

  const filteredStudents = useMemo(() => {
    const kw = q.trim();
    return roster.filter((s) => !kw || s.name.includes(kw));
  }, [roster, q]);

  const shown = useMemo(() => (sel ? notes.filter((n) => n.studentId === sel) : notes), [notes, sel]);

  async function add() {
    if (!sel || !body.trim() || busy) return;
    setBusy(true);
    try {
      await notesApi.add(sel, body.trim());
      setBody("");
      await reload();
    } catch {
      setErr("저장에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(n: NoteItem) {
    if (!window.confirm("이 특이사항을 삭제할까요?")) return;
    try {
      await notesApi.remove(n.id);
      setNotes((cur) => cur.filter((x) => x.id !== n.id));
    } catch {
      setErr("삭제 권한이 없거나 실패했어요.");
    }
  }

  return (
    <div className="notes">
      <div className="notes-side">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 검색" />
        <button className={"notes-stu" + (sel === "" ? " on" : "")} onClick={() => setSel("")}>
          전체 최근
        </button>
        <div className="notes-stulist">
          {filteredStudents.map((s) => {
            const cnt = notes.filter((n) => n.studentId === s.id).length;
            return (
              <button key={s.id} className={"notes-stu" + (sel === s.id ? " on" : "")} onClick={() => setSel(s.id)}>
                {s.name}
                {cnt > 0 && <span className="notes-cnt">{cnt}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="notes-main">
        <h1 className="sm-title">강사 특이사항</h1>
        <p className="sm-desc">
          {sel ? `${nameOf[sel] || "학생"} 님 기록` : "전체 학생의 최근 특이사항"} · 누가·언제·무엇이 시간순으로 쌓입니다.
        </p>
        {err && <div className="auth-err" style={{ margin: "10px 0" }}>{err}</div>}

        {sel && (
          <div className="notes-add">
            <textarea
              className="input"
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={`${nameOf[sel] || "학생"} 특이사항 입력…`}
            />
            <button className="btn primary" onClick={add} disabled={busy || !body.trim()}>
              {busy ? "저장…" : "기록 추가"}
            </button>
          </div>
        )}

        <div className="notes-feed">
          {shown.length === 0 ? (
            <div className="hub-muted">아직 기록이 없어요.</div>
          ) : (
            shown.map((n) => (
              <div className="note-card" key={n.id}>
                <div className="note-h">
                  {!sel && <b className="note-stu">{nameOf[n.studentId] || "학생"}</b>}
                  <span className="note-meta">
                    {n.authorName} · {fmtWhen(n.createdAt)}
                  </span>
                  {(n.authorId === user?.sub || user?.role === "admin") && (
                    <button className="note-x" onClick={() => remove(n)} title="삭제">
                      ×
                    </button>
                  )}
                </div>
                <div className="note-body">{n.body}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
