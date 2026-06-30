// 알림장 공지 — 강사 대시보드에서 전체 수학 / 반별 / 여러 명에게 한 번에 공지. 마감일 지정 시 그 이후엔 안 보임.
// 현재 활성(떠 있는) 공지를 목록으로 보여주고 삭제 가능. 학생은 본인 화면에서 활성 공지를 봄.
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { activeStudents } from "../lib/logic";
import { fmtMDDow } from "../lib/dates";
import { mathBandOf, type MathBand } from "../lib/grade";
import { alimApi, type AlimNotice } from "../lib/alimApi";
import { Icon } from "../icons";
import type { Student } from "../types";

const BANDS: { key: MathBand; label: string }[] = [
  { key: "low", label: "초등 저학년" },
  { key: "high", label: "초등 고학년" },
  { key: "mid", label: "중고등" },
];
// 학생 분류 — 학년 기준(초1~3 저학년, 초4~6 고학년, 중·고 중고등). math_class override는 명단에 없어 학년만 사용.
const bandOf = (grade: string): MathBand => mathBandOf(grade, "");

type Mode = "all" | "band" | "pick";

export function AlimBoard({ date }: { date: string }) {
  const { data, toast } = useStore();
  const students = useMemo(() => activeStudents(data.students).slice().sort((a, b) => a.name.localeCompare(b.name, "ko")), [data.students]);
  const nameOf = useMemo(() => { const m: Record<string, string> = {}; for (const s of students) m[s.id] = s.name; return m; }, [students]);

  const [open, setOpen] = useState(false); // 공지 작성 폼 펼침
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<Mode>("all");
  const [bands, setBands] = useState<MathBand[]>([]);
  const [picks, setPicks] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [due, setDue] = useState(""); // '' = 마감 없음
  const [busy, setBusy] = useState(false);

  const [notices, setNotices] = useState<AlimNotice[]>([]);
  const alive = useRef(true);
  const load = () => alimApi.list(date).then((l) => { if (alive.current) setNotices(l); });
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [date]);

  // 대상 학생 id 목록 — 모드에 따라.
  const targetIds = useMemo(() => {
    if (mode === "all") return students.map((s) => s.id);
    if (mode === "band") return students.filter((s) => bands.includes(bandOf(s.grade))).map((s) => s.id);
    return picks;
  }, [mode, bands, picks, students]);

  const filtered = useMemo(() => {
    const k = q.trim();
    return k ? students.filter((s) => s.name.includes(k) || (s.school || "").includes(k)) : students;
  }, [q, students]);

  async function send() {
    const text = body.trim();
    if (!text) { toast("공지 내용을 입력해주세요."); return; }
    if (targetIds.length === 0) { toast("받을 학생을 골라주세요."); return; }
    if (due && due < date) { toast("마감일은 시작일 이후로 골라주세요."); return; }
    setBusy(true);
    try {
      const res = await alimApi.create({ studentIds: targetIds, body: text, startDate: date, dueDate: due });
      setBody(""); setPicks([]); setBands([]); setDue(""); setOpen(false);
      await load();
      toast(`${res.count}명에게 알림장을 보냈어요${due ? ` · ${fmtMDDow(due)}까지` : ""}`);
    } catch { toast("공지를 보내지 못했어요. 잠시 후 다시 시도해주세요."); }
    finally { setBusy(false); }
  }

  // 활성 공지를 batch로 묶기(같은 공지 = 한 줄, 대상 N명).
  const groups = useMemo(() => {
    const map = new Map<string, { batch: string; body: string; startDate: string; dueDate: string; authorName: string; createdAt: number; ids: string[] }>();
    for (const n of notices) {
      const g = map.get(n.batch);
      if (g) g.ids.push(n.studentId);
      else map.set(n.batch, { batch: n.batch, body: n.body, startDate: n.startDate, dueDate: n.dueDate, authorName: n.authorName, createdAt: n.createdAt, ids: [n.studentId] });
    }
    return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
  }, [notices]);

  // 대상 요약 — 전체면 '전체', 아니면 이름 몇 개 + 외 N명.
  function targetLabel(ids: string[]): string {
    const total = students.length;
    if (total > 0 && ids.length === total) return `전체 ${ids.length}명`;
    const names = ids.map((id) => nameOf[id]).filter(Boolean);
    if (names.length <= 3) return names.join(", ") || `${ids.length}명`;
    return `${names.slice(0, 3).join(", ")} 외 ${names.length - 3}명`;
  }

  async function del(batch: string, label: string) {
    if (!window.confirm(`이 알림장을 삭제할까요?\n(${label})`)) return;
    try { await alimApi.remove({ batch }); await load(); toast("알림장을 삭제했어요"); }
    catch { toast("삭제하지 못했어요."); }
  }

  function togglePick(id: string) { setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); }
  function toggleBand(b: MathBand) { setBands((x) => (x.includes(b) ? x.filter((y) => y !== b) : [...x, b])); }

  return (
    <div className="card sec-gap alim">
      <div className="card-head">
        <div>
          <div className="card-title">알림장 공지 {groups.length > 0 && <span className="alim-cnt">{groups.length}</span>}</div>
          <div className="card-sub">전체·반별·여러 명에게 한 번에. 마감일을 정하면 그날까지만 학생 화면에 보여요.</div>
        </div>
        <button className={"btn sm" + (open ? " ghost" : " primary")} onClick={() => setOpen((v) => !v)}>
          {open ? "닫기" : <><Icon name="plus" /> 공지 쓰기</>}
        </button>
      </div>

      {open && (
        <div className="alim-form">
          <textarea className="input alim-ta" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="공지 내용 (예: 내일은 단원평가가 있어요. 교재와 필기도구 챙겨오세요)" />
          <div className="alim-target">
            <div className="alim-mode">
              <button className={mode === "all" ? "on" : ""} onClick={() => setMode("all")}>전체 수학</button>
              <button className={mode === "band" ? "on" : ""} onClick={() => setMode("band")}>반별</button>
              <button className={mode === "pick" ? "on" : ""} onClick={() => setMode("pick")}>여러 명</button>
            </div>
            {mode === "band" && (
              <div className="alim-bands">
                {BANDS.map((b) => {
                  const cnt = students.filter((s) => bandOf(s.grade) === b.key).length;
                  return <button key={b.key} className={bands.includes(b.key) ? "on" : ""} onClick={() => toggleBand(b.key)}>{b.label} <span className="alim-bandcnt">{cnt}</span></button>;
                })}
              </div>
            )}
            {mode === "pick" && (
              <div className="alim-pick">
                <input className="input alim-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·학교로 검색" />
                <div className="alim-picklist">
                  {filtered.map((s: Student) => (
                    <button key={s.id} className={"alim-chip" + (picks.includes(s.id) ? " on" : "")} onClick={() => togglePick(s.id)}>
                      {picks.includes(s.id) && <Icon name="check" />}{s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="alim-foot">
            <label className="alim-due">
              <span>마감일</span>
              <input className="input" type="date" value={due} min={date} onChange={(e) => setDue(e.target.value)} />
              {due ? <button type="button" className="alim-due-clear" onClick={() => setDue("")} title="마감 없음으로">계속 표시</button> : <span className="alim-due-hint">안 고르면 계속 보여요</span>}
            </label>
            <span className="alim-count">{targetIds.length}명에게</span>
            <button className="btn primary sm" onClick={send} disabled={busy || !body.trim() || targetIds.length === 0}>{busy ? "보내는 중…" : "보내기"}</button>
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="alim-empty">지금 떠 있는 알림장이 없어요.</div>
      ) : (
        <div className="alim-list">
          {groups.map((g) => (
            <div className="alim-item" key={g.batch}>
              <div className="alim-item-body">{g.body}</div>
              <div className="alim-item-meta">
                <span className="alim-tag">{targetLabel(g.ids)}</span>
                <span className="alim-period">{g.dueDate ? `${fmtMDDow(g.startDate)} ~ ${fmtMDDow(g.dueDate)}` : `${fmtMDDow(g.startDate)}부터 · 계속`}</span>
                {g.authorName && <span className="alim-by">{g.authorName}</span>}
              </div>
              <button className="btn ghost sm alim-del" onClick={() => del(g.batch, g.body.slice(0, 20))} title="삭제"><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
