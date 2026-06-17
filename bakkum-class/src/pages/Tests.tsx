import { useMemo, useState } from "react";
import type { TestLog } from "../types";
import { useStore } from "../store";
import { activeStudents } from "../lib/logic";
import { todayStr, uid } from "../lib/dates";
import { TodayLink } from "../components/ui";
import { TEST_TYPES } from "../components/modals";
import { pushTestNotion } from "../api";
import { Icon } from "../icons";

// "YYYY-MM-DD" → "M/D" (없으면 —)
const mdDate = (d: string) => (d && d.length >= 10 ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : "—");

/**
 * 수학 테스트 기록 — 중고등영어·진도와 동일한 레이아웃.
 * 왼쪽에서 학생을 고르면, 그 학생의 테스트를 입력한다.
 * 평가 종류는 선택(주간test / KTC수학경시대회).
 */
export function Tests() {
  const { data, mutate, mutateAsync, toast } = useStore();
  const [sel, setSel] = useState("");
  const [q, setQ] = useState("");

  const students = useMemo(
    () => activeStudents(data.students).slice().sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [data.students]
  );
  const qq = q.trim().toLowerCase();
  const shownStudents = qq ? students.filter((s) => (s.name + " " + (s.grade || "")).toLowerCase().includes(qq)) : students;
  const plannedOf = (sid: string) => data.testLog.filter((t) => t.studentId === sid && t.status === "예정").length;

  const selStudent = students.find((s) => s.id === sel) || null;
  const myTests = useMemo(
    () => data.testLog.filter((t) => t.studentId === sel).slice().sort((a, b) => (a.date < b.date ? 1 : -1)),
    [data.testLog, sel]
  );

  // 입력 폼.
  const [type, setType] = useState(TEST_TYPES[0]);
  const [date, setDate] = useState(todayStr());
  const [round, setRound] = useState("");
  const [range, setRange] = useState("");
  const [status, setStatus] = useState<TestLog["status"]>("예정");
  const [score, setScore] = useState("");

  function add() {
    if (!sel) return;
    const rec: TestLog = {
      id: uid(),
      studentId: sel,
      date: date || todayStr(),
      type: type.trim() || TEST_TYPES[0],
      round: round.trim(),
      range: range.trim(),
      score: status === "완료" ? Math.max(0, Math.round(+score) || 0) : 0,
      status,
      memo: "",
    };
    mutate((d) => { d.testLog.push(rec); });
    pushTestNotion(rec.studentId, { date: rec.date, type: rec.type, round: rec.round, range: rec.range, score: rec.score, status: rec.status, memo: rec.memo });
    setRound(""); setRange(""); setScore(""); setStatus("예정"); setDate(todayStr());
    toast("테스트를 기록했어요.");
  }

  function apply(d: { testLog: TestLog[] }, id: string, fn: (t: TestLog) => void) {
    const t = d.testLog.find((x) => x.id === id);
    if (t) fn(t);
  }
  async function patch(t: TestLog, fn: (x: TestLog) => void) {
    let synced: TestLog | null = null;
    const ok = await mutateAsync((d) => { apply(d, t.id, fn); synced = d.testLog.find((x) => x.id === t.id) ?? null; });
    if (!ok) { toast("저장하지 못했어요 · 잠시 후 다시 시도해 주세요"); return; }
    if (synced) { const s: TestLog = synced; pushTestNotion(s.studentId, { date: s.date, type: s.type, round: s.round, range: s.range, score: s.score, status: s.status, memo: s.memo }); }
  }
  function remove(t: TestLog) {
    if (!window.confirm(`'${`${t.type} ${t.round}`.trim()}' 기록을 삭제할까요?`)) return;
    mutate((d) => { d.testLog = d.testLog.filter((x) => x.id !== t.id); });
    toast("테스트 기록을 삭제했어요.");
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">수학 테스트 기록</h1>
          <div className="page-desc">학생을 고르면 그 학생의 테스트를 입력해요. 오늘 테스트는 <TodayLink /> 화면에서도 돼요.</div>
        </div>
      </div>

      <div className="eng-split">
        <div className="eng-side-wrap card">
          <input className="input" style={{ marginBottom: 8 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 검색" />
          <div className="eng-side">
            {shownStudents.length === 0 ? (
              <div className="eng-side-empty">학생이 없어요.</div>
            ) : (
              shownStudents.map((s) => {
                const pl = plannedOf(s.id);
                return (
                  <div key={s.id} className={"eng-stu" + (sel === s.id ? " on" : "")}>
                    <button className="eng-stu-name" onClick={() => setSel(s.id)}>
                      {s.name}
                      {s.grade && <span className="eng-lv">{s.grade}</span>}
                      {pl > 0 && <span className="eng-stu-time">예정 {pl}</span>}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="eng-main">
          {!selStudent ? (
            <div className="hub-muted" style={{ padding: 20 }}>왼쪽에서 학생을 선택하면 테스트를 입력할 수 있어요.</div>
          ) : (
            <div className="eng-panel">
              <h2>{selStudent.name} · 테스트</h2>
              <div className="test-form">
                <label className="test-f">
                  <span>평가 종류</span>
                  <div className="select-wrap">
                    <select className="input" style={{ appearance: "none" }} value={type} onChange={(e) => setType(e.target.value)}>
                      {TEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <Icon name="chev" />
                  </div>
                </label>
                <label className="test-f">
                  <span>시험일</span>
                  <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className="test-f">
                  <span>회차</span>
                  <input className="input" value={round} onChange={(e) => setRound(e.target.value)} placeholder="예: 6월 2주차" />
                </label>
                <label className="test-f wide">
                  <span>시험 범위</span>
                  <input className="input" value={range} onChange={(e) => setRange(e.target.value)} placeholder="예: 5단원 분수의 덧셈과 뺄셈" />
                </label>
                <label className="test-f">
                  <span>상태</span>
                  <div className="seg">
                    {(["예정", "완료"] as const).map((s) => (
                      <button key={s} type="button" className={"seg-btn" + (status === s ? " on" : "")} onClick={() => setStatus(s)}>{s}</button>
                    ))}
                  </div>
                </label>
                <label className="test-f">
                  <span>점수</span>
                  <input className="input" type="number" min={0} max={100} value={score} disabled={status !== "완료"} placeholder={status === "예정" ? "완료 시 입력" : ""} onChange={(e) => setScore(e.target.value)} />
                </label>
                <button className="btn primary test-add" onClick={add}>추가</button>
              </div>

              <div className="test-recs">
                {myTests.map((t) => (
                  <div className={"test-rec" + (t.status === "완료" ? " done" : "")} key={t.id}>
                    <div className="test-rec-date">{mdDate(t.date)}</div>
                    <div className="test-rec-info">
                      <span className="test-rec-type">{t.type}</span>
                      {t.round && <span className="test-rec-round">{t.round}</span>}
                      {t.range && <span className="test-rec-range">{t.range}</span>}
                    </div>
                    <select className="test-rec-status" value={t.status} onChange={(e) => patch(t, (x) => { x.status = e.target.value === "완료" ? "완료" : "예정"; if (x.status === "예정") x.score = 0; })}>
                      <option value="예정">예정</option>
                      <option value="완료">완료</option>
                    </select>
                    {t.status === "완료" ? (
                      <input className="test-rec-score" type="number" min={0} max={100} defaultValue={t.score} onBlur={(e) => { const v = Math.max(0, Math.round(+e.target.value) || 0); if (v !== t.score) patch(t, (x) => { x.score = v; }); }} aria-label="점수" />
                    ) : (
                      <span className="test-rec-score muted">—</span>
                    )}
                    <button className="test-rec-del" onClick={() => remove(t)} title="삭제"><Icon name="trash" /></button>
                  </div>
                ))}
                {myTests.length === 0 && <div className="hub-muted">아직 등록된 테스트가 없어요. 위에서 입력해 추가하세요.</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
