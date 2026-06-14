import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { ENG_CRITERIA, ENG_GRADES, engApi, type EngReport as Rep } from "../lib/engApi";
import { listUsers, type UserRow } from "../lib/authApi";
import { EngReportCard, type EngReportCardData } from "../components/EngReportCard";

function curMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 영어 이름은 스키마 변경 없이 scores의 예약키에 저장.
const NAME_KEY = "__name";

async function captureEl(id: string, filename: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", width: 720, windowWidth: 720 });
  const a = document.createElement("a");
  a.download = filename;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

function fileBase(name: string, englishName: string, month: string): string {
  const [y, mo] = month.split("-");
  const who = englishName ? `${name}_${englishName}` : name;
  return `성적표_${who}_${y}년_${Number(mo)}월`;
}

/** 영어 월말리포트(초등 전용) — 세로 입력 + 3장 양식(표지·레이더·코멘트) 미리보기/개별/일괄 저장. */
export function EngReport() {
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [teachers, setTeachers] = useState<UserRow[]>([]);
  const [month, setMonth] = useState(curMonth());
  const [reps, setReps] = useState<Record<string, Rep>>({});
  const [sel, setSel] = useState("");
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
  useEffect(() => {
    if (!sel && students.length) setSel(students[0].id);
  }, [students, sel]);

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
    const cur = repOf(sid).scores[crit];
    update(sid, { scores: { ...repOf(sid).scores, [crit]: cur === grade ? "" : grade } }); // 같은 등급 다시 누르면 해제
  }
  function setEngName(sid: string, v: string) {
    update(sid, { scores: { ...repOf(sid).scores, [NAME_KEY]: v } });
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

  function cardData(s: RosterStudent): EngReportCardData {
    const r = repOf(s.id);
    return { name: s.name, englishName: r.scores[NAME_KEY] || "", grade: s.grade, teacher: r.teacher, month, scores: r.scores, comments: r.comments };
  }
  function doneCount(sid: string): number {
    const sc = repOf(sid).scores;
    return ENG_CRITERIA.filter((c) => sc[c.key]).length;
  }

  async function exportOne(s: RosterStudent) {
    setBusy(true);
    setErr("");
    try {
      const base = fileBase(s.name, repOf(s.id).scores[NAME_KEY] || "", month);
      for (let n = 1; n <= 3; n++) {
        await captureEl(`eng-card-${s.id}-${n}`, `${base}_${n}.png`);
        await new Promise((r) => setTimeout(r, 350));
      }
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
        const base = fileBase(s.name, repOf(s.id).scores[NAME_KEY] || "", month);
        for (let n = 1; n <= 3; n++) {
          await captureEl(`eng-card-${s.id}-${n}`, `${base}_${n}.png`);
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      setProgress("완료! 전체 저장됨");
    } catch {
      setErr("이미지 저장 중 오류가 났어요.");
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(""), 3000);
    }
  }

  const selStudent = students.find((s) => s.id === sel) || null;
  const previewStudent = students.find((s) => s.id === preview) || null;
  const rep = selStudent ? repOf(selStudent.id) : null;
  const teacherOpts = rep && rep.teacher && !teacherNames.includes(rep.teacher) ? [rep.teacher, ...teacherNames] : teacherNames;

  return (
    <div className="er">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">영어 월말리포트 (초등)</h1>
          <p className="sm-desc">월을 고르고 학생별로 8개 항목 등급·코멘트를 입력한 뒤, 3장 양식(표지·레이더·코멘트)을 미리보기·저장하세요.</p>
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
          {busy ? "저장 중…" : "전체 이미지 저장 (3장씩)"}
        </button>
      </div>
      {progress && <div className="er-progress">{progress}</div>}
      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}

      {students.length === 0 ? (
        <div className="hub-muted">초등영어 학생이 없어요. <b>학생 명단</b>에서 학생에 영어 + 초등을 지정하세요.</div>
      ) : (
        <div className="eng-split">
          <div className="eng-side">
            {students.map((s) => (
              <div key={s.id} className={"eng-stu" + (sel === s.id ? " on" : "")}>
                <button className="eng-stu-name" onClick={() => setSel(s.id)}>
                  {s.name}
                  <span className="er-side-cnt">{doneCount(s.id)}/8</span>
                </button>
              </div>
            ))}
          </div>

          <div className="eng-main">
            {!selStudent || !rep ? (
              <div className="hub-muted" style={{ padding: 20 }}>왼쪽에서 학생을 선택하세요.</div>
            ) : (
              <div className="er-edit">
                <div className="er-edit-h">
                  <h2>{selStudent.name}{rep.scores[NAME_KEY] ? ` ${rep.scores[NAME_KEY]}` : ""} <span className="er-grade">{selStudent.grade || ""}</span></h2>
                  <div className="er-edit-acts">
                    <button className="btn ghost" onClick={() => setPreview(selStudent.id)}>미리보기</button>
                    <button className="btn primary" onClick={() => exportOne(selStudent)} disabled={busy}>이미지 저장 (3장)</button>
                  </div>
                </div>

                <div className="er-grid2">
                  <label className="eng-field">
                    <div className="eng-label">영어 이름</div>
                    <input className="input" value={rep.scores[NAME_KEY] || ""} onChange={(e) => setEngName(selStudent.id, e.target.value)} placeholder="예: Ivan" />
                  </label>
                  <label className="eng-field">
                    <div className="eng-label">담당교사</div>
                    <select className="sm-input" value={rep.teacher} onChange={(e) => update(selStudent.id, { teacher: e.target.value })}>
                      <option value="">—</option>
                      {teacherOpts.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                </div>

                <div className="eng-field">
                  <div className="eng-label">항목별 등급</div>
                  <div className="er-crits">
                    {ENG_CRITERIA.map((c) => {
                      const g = rep.scores[c.key] || "";
                      return (
                        <div className="er-crit" key={c.key}>
                          <div className="er-crit-name"><b>{c.en}</b> <span>{c.ko}</span></div>
                          <div className="er-crit-grades">
                            {ENG_GRADES.map((gr) => (
                              <button
                                key={gr.value}
                                className={"er-gbtn g-" + gr.value + (g === gr.value ? " on" : "")}
                                title={gr.full}
                                onClick={() => setScore(selStudent.id, c.key, gr.value)}
                              >
                                {gr.value}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="eng-field">
                  <div className="eng-label">선생님 코멘트</div>
                  <textarea className="input er-comment-ta" rows={6} value={rep.comments} onChange={(e) => update(selStudent.id, { comments: e.target.value })} placeholder="학부모 안내체로 자유롭게 작성하세요." />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 캡처용 숨김 3장 양식 (화면 밖) */}
      <div style={{ position: "fixed", left: -10000, top: 0 }} aria-hidden>
        {students.map((s) => (
          <EngReportCard key={s.id} baseId={`eng-card-${s.id}`} data={cardData(s)} />
        ))}
      </div>

      {previewStudent && (
        <div className="prof-overlay" onClick={() => setPreview(null)}>
          <div className="prof er-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="prof-top">
              <div className="prof-top-main"><div className="prof-name">{previewStudent.name} · 3장 미리보기</div></div>
              <button className="modal-x" onClick={() => setPreview(null)} aria-label="닫기">✕</button>
            </div>
            <div className="prof-body er-preview-body">
              <EngReportCard baseId={"eng-preview-card"} data={cardData(previewStudent)} />
            </div>
            <div className="prof-foot">
              <button className="btn ghost" onClick={() => setPreview(null)}>닫기</button>
              <button className="btn primary" onClick={() => exportOne(previewStudent)} disabled={busy}>이미지 저장 (3장)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
