import { useState } from "react";
import { useStore } from "../store";
import type { Student, SupLog, TestLog } from "../types";
import { fmtMDDow, uid, weekOfMonthLabel } from "../lib/dates";
import { nextLessonDate } from "../lib/logic";
import { pushTestNotion } from "../api";
import { TEST_TYPES } from "./modals";
import { ScoreInput, type ScoreValue } from "./ScoreInput";
import { computeScore, type ScoreMode } from "../lib/score";
import { Icon } from "../icons";

/* 시험 점수 한 줄 — 점수/만점/갯수 토글로 입력. 예약(예정) 시험이 오늘이면 '예정' 배지와 함께 떠서 점수를 채운다. */
function TodayTestRow({ t, onScore, onToggle, onRemove, onEdit }: { t: TestLog; onScore: (v: ScoreValue) => void; onToggle: () => void; onRemove: () => void; onEdit: () => void }) {
  const mode = (t.scoreMode || "score") as ScoreMode;
  const num = mode === "score" ? t.score : (t.scoreNum ?? 0);
  const den = t.scoreDen ?? (mode === "max" ? 100 : 0);
  return (
    <div className="today-hwitem assigned test-item">
      <span className="today-hwitem-name">
        <b>{t.type || "시험"}</b>
        {t.status === "예정" && <span className="badge b-orange" title="예약된 시험 — 점수를 넣으면 완료돼요">예정</span>}
        {t.round ? <span className="test-rec-round">{t.round}</span> : null}
        {t.range ? <span className="muted"> · {t.range}</span> : null}
      </span>
      <ScoreInput mode={mode} num={num} den={den} onChange={onScore} />
      <button className={"btn sm" + (t.status === "완료" ? " primary" : "")} onClick={onToggle} title="완료/예정 전환">
        <Icon name="check" />{t.status === "완료" ? "완료" : "완료로"}
      </button>
      <button className="btn ghost sm" onClick={onEdit} title="시험명·단원 수정"><Icon name="edit" /></button>
      <button className="btn ghost sm" onClick={onRemove} title="삭제"><Icon name="trash" /></button>
    </div>
  );
}

/* 오늘 본 시험(여러 개) + 다음 시간에 볼 시험 예약 — 오늘·대시보드 공용.
   testLog(예정/완료)에 저장 → '테스트 관리' 탭·월말리포트·노션과 같은 데이터.
   예약(예정) 시험은 그 날짜가 되면 '오늘 본 시험'에 자동으로 떠서 점수를 채운다. */
export function TodayTests({ student, day }: { student: Student; day: string }) {
  const { data, mutate, toast } = useStore();
  const sid = student.id;
  const nextDate = nextLessonDate(student, day);
  const todays = data.testLog.filter((t) => t.studentId === sid && t.date === day);
  const planned = data.testLog.filter((t) => t.studentId === sid && t.date === nextDate && t.status === "예정");

  const [name, setName] = useState(TEST_TYPES[0]);
  const [sMode, setSMode] = useState<ScoreMode>("score");
  const [sNum, setSNum] = useState(0);
  const [sDen, setSDen] = useState(100);
  const [todayRange, setTodayRange] = useState("");
  const [planName, setPlanName] = useState("");
  const [planRange, setPlanRange] = useState("");
  // 예약·기록 시험 인라인 수정(시험명·단원).
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eRange, setERange] = useState("");

  const pushN = (rec: TestLog) =>
    pushTestNotion(rec.studentId, { date: rec.date, type: rec.type, round: rec.round, range: rec.range, score: rec.score, status: rec.status, memo: rec.memo });

  function addToday() {
    const nm = name.trim();
    if (!nm) return;
    const score = computeScore(sMode, sNum, sDen);
    const rec: TestLog = { id: uid(), studentId: sid, date: day, type: nm, round: weekOfMonthLabel(day), range: todayRange.trim(), score, status: "완료", memo: "", scoreMode: sMode, scoreNum: sNum, scoreDen: sDen };
    mutate((d) => { d.testLog.push(rec); });
    pushN(rec);
    setSNum(0); setTodayRange("");
    toast(`${student.name} · 시험 기록`);
  }
  function patch(t: TestLog, fn: (x: TestLog) => void) {
    let synced: TestLog | null = null;
    mutate((d) => { const x = d.testLog.find((r) => r.id === t.id); if (x) { fn(x); synced = { ...x }; } });
    if (synced) pushN(synced);
  }
  // 점수를 입력하면 자동으로 '완료'가 된다. 점수는 완료 전·후 언제든 수정 가능.
  function setScoreOf(t: TestLog, v: ScoreValue) { patch(t, (x) => { x.scoreMode = v.scoreMode; x.scoreNum = v.scoreNum; x.scoreDen = v.scoreDen; x.score = v.score; x.status = "완료"; }); }
  // 완료/예정 전환 — 점수는 절대 건드리지 않는다(완료 후 점수 작성, 점수 입력 후 완료 모두 허용).
  function toggleStatus(t: TestLog) { patch(t, (x) => { x.status = x.status === "완료" ? "예정" : "완료"; }); }
  function removeT(t: TestLog) { mutate((d) => { d.testLog = d.testLog.filter((r) => r.id !== t.id); }); }
  function startEdit(t: TestLog) { setEditId(t.id); setEName(t.type); setERange(t.range); }
  function saveEdit(t: TestLog) {
    const nm = eName.trim();
    patch(t, (x) => { if (nm) x.type = nm; x.range = eRange.trim(); });
    setEditId(null);
  }
  // 시험 수정 줄(시험명·단원) — 오늘 본 시험·예약 공용.
  const editRow = (t: TestLog) => (
    <div className="today-hwitem assigned test-edit" key={t.id}>
      <input className="today-assign-input" value={eName} onChange={(e) => setEName(e.target.value)} placeholder="시험명" onKeyDown={(e) => { if (e.key === "Enter") saveEdit(t); }} />
      <input className="today-assign-input" value={eRange} onChange={(e) => setERange(e.target.value)} placeholder="시험 범위(단원)" onKeyDown={(e) => { if (e.key === "Enter") saveEdit(t); }} />
      <button className="btn primary sm" onClick={() => saveEdit(t)}>저장</button>
      <button className="btn ghost sm" onClick={() => setEditId(null)}>취소</button>
    </div>
  );

  function addPlan() {
    const nm = planName.trim();
    if (!nm) return;
    if (!nextDate) { toast("다음 수업 일정이 없어 예약할 수 없어요."); return; }
    const rec: TestLog = { id: uid(), studentId: sid, date: nextDate, type: nm, round: weekOfMonthLabel(nextDate), range: planRange.trim(), score: 0, status: "예정", memo: "" };
    mutate((d) => { d.testLog.push(rec); });
    pushN(rec);
    setPlanName("");
    setPlanRange("");
    toast(`${student.name} · ${fmtMDDow(nextDate)} 시험 예약`);
  }

  return (
    <>
      {/* 오늘 본 시험 */}
      <div className="eng-field today-hwsec">
        <div className="eng-label">오늘 본 시험 {day ? <span className="today-sup-hint">{weekOfMonthLabel(day)}</span> : null}</div>
        {todays.length === 0 ? (
          <div className="today-hwrow-empty">아직 오늘 본 시험이 없어요. 아래에서 추가하거나, 미리 예약해 두면 그날 여기 떠요</div>
        ) : (
          todays.map((t) => (
            editId === t.id ? editRow(t) : <TodayTestRow key={t.id} t={t} onScore={(v) => setScoreOf(t, v)} onToggle={() => toggleStatus(t)} onRemove={() => removeT(t)} onEdit={() => startEdit(t)} />
          ))
        )}
        <div className="today-assignrow test-addrow">
          <input
            className="today-assign-input"
            placeholder="시험명 (예: 주간test)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addToday(); }}
          />
          <input
            className="today-assign-input"
            placeholder="시험 범위 (예: 5단원 분수)"
            value={todayRange}
            onChange={(e) => setTodayRange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addToday(); }}
          />
          <ScoreInput mode={sMode} num={sNum} den={sDen} onChange={(v) => { setSMode(v.scoreMode); setSNum(v.scoreNum); setSDen(v.scoreDen); }} />
          <button className="btn sm" onClick={addToday} disabled={!name.trim()}>추가</button>
        </div>
      </div>

      {/* 다음 시간에 볼 시험 (예약) */}
      <div className="eng-field today-hwsec">
        <div className="eng-label">다음 시간에 볼 시험 {nextDate ? <span className="today-sup-hint">{fmtMDDow(nextDate)} · {weekOfMonthLabel(nextDate)} 준비</span> : null}</div>
        {!nextDate ? (
          <div className="today-hwrow-empty">다음 수업 일정이 없어 예약할 수 없어요. (시간표 확인)</div>
        ) : (
          <>
            {planned.map((p) => (
              editId === p.id ? editRow(p) : (
              <div className="today-hwitem assigned" key={p.id}>
                <span className="today-hwitem-name">
                  <b>{p.type}</b><span className="badge b-orange">예약</span>
                  {p.round ? <span className="test-rec-round">{p.round}</span> : null}
                  {p.range ? <span className="muted"> · {p.range}</span> : <span className="muted"> · 범위 미입력</span>}
                </span>
                <button className="btn ghost sm" onClick={() => startEdit(p)} title="시험명·단원 수정"><Icon name="edit" /></button>
                <button className="btn ghost sm" onClick={() => removeT(p)} title="삭제"><Icon name="trash" /></button>
              </div>
              )
            ))}
            <div className="today-assignrow">
              <input
                className="today-assign-input"
                placeholder="다음 시간 볼 시험 (예: 6단원 평가)"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addPlan(); }}
              />
              <input
                className="today-assign-input"
                placeholder="시험 범위 (예: 5단원 분수)"
                value={planRange}
                onChange={(e) => setPlanRange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addPlan(); }}
              />
              <button className="btn sm" onClick={addPlan} disabled={!planName.trim()}>예약</button>
            </div>
            <div className="today-sup-hint" style={{ marginTop: 4 }}>미리 등록해두면 시험지 준비에 쓰고, 그날 ‘오늘 본 시험’에 자동으로 떠요.</div>
          </>
        )}
      </div>
    </>
  );
}

/* 1:1 보충학습 — 오늘·대시보드 공용. 보충일시·시간·보충명·학습내용·보충사유·비고.
   입력하면 월말리포트 '1:1 보충학습'에 자동 반영(같은 SupLog 데이터). */
export function SupLearn({ student, day }: { student: Student; day: string }) {
  const { data, mutate, toast } = useStore();
  const sid = student.id;
  const sups = (data.supplements || []).filter((x) => x.studentId === sid).sort((a, b) => (a.date < b.date ? 1 : -1));
  const [name, setName] = useState("");
  const [min, setMin] = useState("");
  const [content, setContent] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  function add() {
    const m = Math.max(0, Math.round(+min) || 0);
    const nm = name.trim(), c = content.trim(), r = reason.trim(), nt = note.trim();
    if (!m && !nm && !c) { toast("보충 시간(분)이나 보충명을 입력해 주세요."); return; }
    const rec: SupLog = { id: uid(), studentId: sid, date: day, minutes: m, reason: r, name: nm, content: c, note: nt };
    mutate((d) => { d.supplements = [...(d.supplements || []), rec]; });
    setName(""); setMin(""); setContent(""); setReason(""); setNote("");
    toast(`${student.name} · 보충 기록`);
  }
  function remove(id: string) { mutate((d) => { d.supplements = (d.supplements || []).filter((x) => x.id !== id); }); }

  const canAdd = !!(name.trim() || min.trim() || content.trim());
  return (
    <div className="eng-field today-hwsec">
      <div className="eng-label">1:1 보충학습 <span className="today-sup-hint">입력하면 월말리포트 ‘1:1 보충학습’에 자동으로 떠요</span></div>
      {sups.map((sp) => (
        <div className="today-supitem" key={sp.id}>
          <div className="today-supitem-text">
            <b>{sp.name || (sp.minutes ? `${sp.minutes}분 보충` : "보충")}</b>
            {sp.minutes ? ` · ${sp.minutes}분` : ""}
            {sp.content ? ` · ${sp.content}` : ""}
            {sp.reason ? ` · ${sp.reason}` : ""}
            {sp.note ? ` · ${sp.note}` : ""}
            {` · ${fmtMDDow(sp.date)}`}
          </div>
          <button className="btn ghost sm today-supitem-del" onClick={() => remove(sp.id)} title="삭제"><Icon name="trash" /></button>
        </div>
      ))}
      <div className="today-suprow">
        <input className="sup-name" placeholder="보충명 (예: 연산학습)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="sup-min" type="number" min={0} step={5} placeholder="분" value={min} onChange={(e) => setMin(e.target.value)} />
        <input className="sup-content" placeholder="학습내용" value={content} onChange={(e) => setContent(e.target.value)} />
        <input className="sup-reason" placeholder="보충사유" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input className="sup-note" placeholder="비고" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <button className="btn sm sup-add" onClick={add} disabled={!canAdd}>추가</button>
      </div>
    </div>
  );
}
