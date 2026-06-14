import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { ENG_CRITERIA, ENG_GRADES, engApi, type EngReport as Rep } from "../lib/engApi";
import { listUsers, type UserRow } from "../lib/authApi";

function curMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function captureCard(id: string, name: string, month: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", width: 720, windowWidth: 720 });
  const a = document.createElement("a");
  a.download = `${name}_${month}_영어리포트.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

/** 영어 월말리포트(초등 전용) — 담당교사 드롭다운 · 학생별/전체 저장 · 미리보기. 수학 리포트와 같은 흐름. */
export function EngReport() {
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [teachers, setTeachers] = useState<UserRow[]>([]);
  const [month, setMonth] = useState(curMonth());
  const [reps, setReps] = useState<Record<string, Rep>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    getRoster().then(setRoster).catch(() => setErr("명단을 불러오지 못했어요. (배포 환경에서만 동작)"));
    listUsers().then(setTeachers).catch(() => {});
  }, []);
  useEffect(() => {
    engApi
      .reportsByMonth(month)
      .then((list) => {
        const m: Record<string, Rep> = {};
        for (const r of list) m[r.studentId] = r;
        setReps(m);
      })
      .catch(() => {});
  }, [month]);

  // 초등영어 학생만 대상(중고등 영어 리포트 없음).
  const students = useMemo(
    () => roster.filter((s) => s.subjects.includes("english") && s.englishBand === "elem"),
    [roster]
  );
  // 담당교사 후보 = 초등영어 강사(+원장). 없으면 학생 제외 전 스태프.
  const teacherNames = useMemo(() => {
    const elem = teachers.filter((u) => u.role === "english_elem" || u.role === "admin").map((u) => u.name);
    if (elem.length) return elem;
    return teachers.filter((u) => u.role !== "student").map((u) => u.name);
  }, [teachers]);

  function repOf(sid: string): Rep {
    return reps[sid] || { studentId: sid, month, teacher: "", scores: {}, comments: "", updatedAt: 0 };
  }
  function persist(sid: string, next: Rep) {
    if (saveTimers.current[sid]) clearTimeout(saveTimers.current[sid]);
    saveTimers.current[sid] = setTimeout(() => {
      engApi.saveReport({ studentId: sid, month, teacher: next.teacher, scores: next.scores, comments: next.comments }).catch(() => setErr("저장에 실패했어요."));
    }, 600);
  }
  function update(sid: string, patch: Partial<Rep>) {
    const next = { ...repOf(sid), ...patch, studentId: sid, month };
    setReps((cur) => ({ ...cur, [sid]: next }));
    persist(sid, next);
  }
  function setScore(sid: string, crit: string, grade: string) {
    update(sid, { scores: { ...repOf(sid).scores, [crit]: grade } });
  }
  function setTeacherAll(name: string) {
    setReps((cur) => {
      const next = { ...cur };
      for (const s of students) {
        const r = { ...repOf(s.id), teacher: name, studentId: s.id, month };
        next[s.id] = r;
        persist(s.id, r);
      }
      return next;
    });
  }

  async function exportOne(s: RosterStudent) {
    setBusy(true);
    try {
      await captureCard("eng-card-" + s.id, s.name, month);
    } catch {
      setErr("이미지 저장 중 오류가 났어요.");
    } finally {
      setBusy(false);
    }
  }
  async function exportAll() {
    if (busy || students.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      for (let i = 0; i < students.length; i++) {
        const s = students[i];
        setProgress(`${i + 1}/${students.length} · ${s.name}`);
        await captureCard("eng-card-" + s.id, s.name, month);
        await new Promise((r) => setTimeout(r, 400));
      }
      setProgress("완료! 전체 저장됨");
    } catch {
      setErr("이미지 저장 중 오류가 났어요.");
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(""), 3000);
    }
  }

  const previewStudent = students.find((s) => s.id === preview) || null;

  return (
    <div className="er">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">영어 월말리포트 (초등)</h1>
          <p className="sm-desc">월을 고르고 담당교사·항목 등급을 입력한 뒤, 학생별 미리보기·저장 또는 전체 한 번에 저장하세요.</p>
        </div>
        <div className="sm-count">{students.length}명</div>
      </div>

      <div className="er-toolbar">
        <input className="sm-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <label className="er-tall">
          담당교사 일괄
          <select className="sm-input" defaultValue="" onChange={(e) => { if (e.target.value) setTeacherAll(e.target.value); }}>
            <option value="">선택…</option>
            {teacherNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="btn primary" style={{ marginLeft: "auto" }} onClick={exportAll} disabled={busy || students.length === 0}>
          {busy ? "저장 중…" : "전체 이미지 저장"}
        </button>
      </div>
      {progress && <div className="er-progress">{progress}</div>}
      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}

      {students.length === 0 ? (
        <div className="hub-muted">초등영어 학생이 없어요. <b>학생 명단</b>에서 학생에 영어 + 초등을 지정하세요.</div>
      ) : (
        <div className="er-table-wrap">
          <table className="er-table">
            <thead>
              <tr>
                <th className="er-sticky">학생</th>
                <th>담당교사</th>
                {ENG_CRITERIA.map((c) => (
                  <th key={c.key} title={c.ko}>{c.en}</th>
                ))}
                <th>코멘트</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const r = repOf(s.id);
                const teacherOpts = r.teacher && !teacherNames.includes(r.teacher) ? [r.teacher, ...teacherNames] : teacherNames;
                return (
                  <tr key={s.id}>
                    <td className="er-sticky sm-name">{s.name}</td>
                    <td>
                      <select className="sm-input er-tsel" value={r.teacher} onChange={(e) => update(s.id, { teacher: e.target.value })}>
                        <option value="">—</option>
                        {teacherOpts.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>
                    {ENG_CRITERIA.map((c) => (
                      <td key={c.key}>
                        <select className="sm-input er-g" value={r.scores[c.key] || ""} onChange={(e) => setScore(s.id, c.key, e.target.value)}>
                          <option value="">—</option>
                          {ENG_GRADES.map((g) => (
                            <option key={g.value} value={g.value}>{g.value}</option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td>
                      <input className="sm-input er-cm" value={r.comments} onChange={(e) => update(s.id, { comments: e.target.value })} placeholder="코멘트" />
                    </td>
                    <td>
                      <div className="er-acts">
                        <button className="btn ghost sm" onClick={() => setPreview(s.id)}>미리보기</button>
                        <button className="btn ghost sm" onClick={() => exportOne(s)} disabled={busy}>저장</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 캡처용 숨김 성적표 (화면 밖) */}
      <div style={{ position: "fixed", left: -10000, top: 0 }} aria-hidden>
        {students.map((s) => (
          <ReportCard key={s.id} id={"eng-card-" + s.id} name={s.name} month={month} rep={repOf(s.id)} />
        ))}
      </div>

      {previewStudent && (
        <div className="prof-overlay" onClick={() => setPreview(null)}>
          <div className="prof er-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="prof-top">
              <div className="prof-top-main"><div className="prof-name">{previewStudent.name} · 성적표 미리보기</div></div>
              <button className="modal-x" onClick={() => setPreview(null)} aria-label="닫기">✕</button>
            </div>
            <div className="prof-body er-preview-body">
              <ReportCard id={"eng-preview-card"} name={previewStudent.name} month={month} rep={repOf(previewStudent.id)} />
            </div>
            <div className="prof-foot">
              <button className="btn ghost" onClick={() => setPreview(null)}>닫기</button>
              <button className="btn primary" onClick={() => exportOne(previewStudent)} disabled={busy}>이미지 저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const GRADE_FULL: Record<string, string> = Object.fromEntries(ENG_GRADES.map((g) => [g.value, g.full]));

function ReportCard({ id, name, month, rep }: { id: string; name: string; month: string; rep: Rep }) {
  const [y, mo] = month.split("-");
  return (
    <div id={id} className="erc">
      <div className="erc-head">
        <div className="erc-brand">바꿈영수학원 · English</div>
        <div className="erc-month">{y}년 {Number(mo)}월 평가</div>
      </div>
      <div className="erc-name">{name}</div>
      <div className="erc-grid">
        {ENG_CRITERIA.map((c) => {
          const g = rep.scores[c.key] || "";
          return (
            <div className="erc-item" key={c.key}>
              <div className="erc-item-name">
                <b>{c.en}</b>
                <span>{c.ko}</span>
              </div>
              <div className={"erc-grade g-" + (g || "none")}>
                <span className="erc-g-v">{g || "—"}</span>
                {g && <span className="erc-g-f">{GRADE_FULL[g]}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {rep.comments && (
        <div className="erc-comments">
          <div className="erc-comments-h">Comments</div>
          <div className="erc-comments-b">{rep.comments}</div>
        </div>
      )}
      <div className="erc-foot">담당 선생님 {rep.teacher || "—"}</div>
    </div>
  );
}
