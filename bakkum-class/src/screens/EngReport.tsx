import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { ENG_CRITERIA, ENG_GRADES, engApi, type EngReport as Rep } from "../lib/engApi";

type BandFilter = "all" | "elem" | "mid";

function curMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 영어 월말리포트 — 월·반 선택 → 학생별 8개 항목 등급 입력 → 전체 성적표 이미지 일괄 저장. */
export function EngReport() {
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [month, setMonth] = useState(curMonth());
  const [band, setBand] = useState<BandFilter>("all");
  const [reps, setReps] = useState<Record<string, Rep>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    getRoster().then(setRoster).catch(() => setErr("명단을 불러오지 못했어요. (배포 환경에서만 동작)"));
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

  const students = useMemo(
    () =>
      roster.filter(
        (s) => s.subjects.includes("english") && (band === "all" || s.englishBand === band)
      ),
    [roster, band]
  );

  function repOf(sid: string): Rep {
    return reps[sid] || { studentId: sid, month, teacher: "", scores: {}, comments: "", updatedAt: 0 };
  }

  function update(sid: string, patch: Partial<Rep>) {
    const next = { ...repOf(sid), ...patch, studentId: sid, month };
    setReps((cur) => ({ ...cur, [sid]: next }));
    if (saveTimers.current[sid]) clearTimeout(saveTimers.current[sid]);
    saveTimers.current[sid] = setTimeout(() => {
      engApi
        .saveReport({ studentId: sid, month, teacher: next.teacher, scores: next.scores, comments: next.comments })
        .catch(() => setErr("저장에 실패했어요."));
    }, 600);
  }
  function setScore(sid: string, crit: string, grade: string) {
    update(sid, { scores: { ...repOf(sid).scores, [crit]: grade } });
  }

  async function exportAll() {
    if (busy || students.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      for (let i = 0; i < students.length; i++) {
        const s = students[i];
        setProgress(`${i + 1}/${students.length} · ${s.name}`);
        const el = document.getElementById("eng-card-" + s.id);
        if (!el) continue;
        const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", width: 720, windowWidth: 720 });
        const a = document.createElement("a");
        a.download = `${s.name}_${month}_영어리포트.png`;
        a.href = canvas.toDataURL("image/png");
        a.click();
        await new Promise((r) => setTimeout(r, 400)); // 다운로드 간격
      }
      setProgress("완료! 전체 저장됨");
    } catch {
      setErr("이미지 저장 중 오류가 났어요.");
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(""), 3000);
    }
  }

  return (
    <div className="er">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">영어 월말리포트</h1>
          <p className="sm-desc">월·반을 고르고 항목 등급을 입력한 뒤, 전체 학생 성적표를 한 번에 이미지로 저장합니다.</p>
        </div>
        <div className="sm-count">{students.length}명</div>
      </div>

      <div className="er-toolbar">
        <input className="sm-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <div className="sm-filters">
          {(["all", "elem", "mid"] as BandFilter[]).map((b) => (
            <button key={b} className={"sm-fchip" + (band === b ? " on" : "")} onClick={() => setBand(b)}>
              {b === "all" ? "전체" : b === "elem" ? "초등" : "중고등"}
            </button>
          ))}
        </div>
        <button className="btn primary" style={{ marginLeft: "auto" }} onClick={exportAll} disabled={busy || students.length === 0}>
          {busy ? "저장 중…" : "전체 이미지 저장"}
        </button>
      </div>
      {progress && <div className="er-progress">{progress}</div>}
      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}

      {students.length === 0 ? (
        <div className="hub-muted">영어 학생이 없어요. 학생 마스터에서 영어 + 반을 지정하세요.</div>
      ) : (
        <div className="er-table-wrap">
          <table className="er-table">
            <thead>
              <tr>
                <th className="er-sticky">학생</th>
                <th>담당T</th>
                {ENG_CRITERIA.map((c) => (
                  <th key={c.key} title={c.ko}>{c.en}</th>
                ))}
                <th>코멘트</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const r = repOf(s.id);
                return (
                  <tr key={s.id}>
                    <td className="er-sticky sm-name">{s.name}</td>
                    <td>
                      <input className="sm-input er-t" value={r.teacher} onChange={(e) => update(s.id, { teacher: e.target.value })} placeholder="T" />
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
