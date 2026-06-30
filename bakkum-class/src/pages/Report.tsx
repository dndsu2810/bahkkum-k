import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import type { Student, SupLog } from "../types";
import type { EvalItem, ProgressInfo, ReportData, ReportExtras } from "../lib/reportTypes";
import { emptyExtras } from "../lib/reportTypes";
import { computeAtt, deriveNotes } from "../lib/reportCompute";
import { loadExtras, saveExtras } from "../lib/reportExtras";
import { saveReportAsImages } from "../lib/reportImage";
import { curMonthStr, inMonth, monthOptions, studentById, sortStudents } from "../lib/logic";
import { uid } from "../lib/dates";
import { Select } from "../components/ui";
import { StudentSortToggle, useStudentSort } from "../components/StudentSortToggle";
import { Icon } from "../icons";
import { ReportCard } from "../components/ReportCard";
import { ReportPreview } from "./ReportPreview";

const TEACHER = "이지현";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Report() {
  const { data, toast } = useStore();
  const [ym, setYm] = useState(curMonthStr());
  const [selected, setSelected] = useState<Set<string>>(new Set()); // 일괄 저장 체크
  const [sel, setSel] = useState<string>(""); // 2단 — 왼쪽에서 고른 학생
  const [q, setQ] = useState("");
  const [extrasMap, setExtrasMap] = useState<Record<string, ReportExtras>>({});
  const [preview, setPreview] = useState<ReportData | null>(null);
  const [saving, setSaving] = useState(false);
  const [render, setRender] = useState<ReportData | null>(null); // offscreen capture target
  const [bulk, setBulk] = useState<{ running: boolean; i: number; n: number }>({ running: false, i: 0, n: 0 });

  const [year, month] = useMemo(() => ym.split("-").map(Number), [ym]);

  // reset per-month extras cache when month changes
  useEffect(() => {
    setExtrasMap({});
  }, [ym]);

  // preload the (large) logo so offscreen captures aren't blank on first save
  useEffect(() => {
    const img = new Image();
    img.src = "/report-logo.png";
  }, []);

  const [sort, setSort] = useStudentSort("report");
  // 리포트 달 기준으로, 아직 수학을 시작하지 않은 학생은 숨긴다.
  // (예: 첫등원 7/1인 학생은 6월 리포트에 뜰 필요 없음) — 수학 첫등원일(mathStart) 우선, 없으면 등록일.
  const sorted = useMemo(
    () =>
      sortStudents(
        data.students.filter((s) => {
          const startM = (s.mathStart || s.startDate || "").slice(0, 7);
          return !startM || startM <= ym; // 첫등원 달이 리포트 달보다 미래면 제외
        }),
        sort
      ),
    [data.students, ym, sort]
  );

  function defaultExtras(studentId: string): ReportExtras {
    const saved = loadExtras(studentId, ym);
    if (!saved) return { ...emptyExtras(), notes: deriveNotes(data, studentId, year, month) };
    // 저장본은 있는데 '출결 특이사항'만 비어 있으면(기록이 없던 시절에 저장됨) 출결에서 자동으로 다시 만든다.
    // 손으로 적은 특이사항이 있으면 그대로 보존(이미 notes가 있으면 건드리지 않음).
    if (!saved.notes?.length) {
      const derived = deriveNotes(data, studentId, year, month);
      if (derived.length) return { ...saved, notes: derived };
    }
    return saved;
  }
  function getExtras(studentId: string): ReportExtras {
    return extrasMap[studentId] || defaultExtras(studentId);
  }
  function updateExtras(studentId: string, next: ReportExtras) {
    setExtrasMap((m) => ({ ...m, [studentId]: next }));
    saveExtras(studentId, ym, next);
  }
  function buildData(studentId: string): ReportData {
    const s = studentById(data.students, studentId) as Student;
    const stored = getExtras(studentId); // comment / evals / notes (manual)
    // 숙제·진도는 '숙제 관리'·'진도 관리' 기록(D1)에서 해당 월로 자동 채움
    const homeworks = data.homeworkLog
      .filter((h) => h.studentId === studentId && inMonth(h.date, ym))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((h) => ({ id: h.id, date: h.date, book: h.book, tags: h.tags, completion: h.completion, status: h.status, memo: h.memo, delayCount: h.delayCount, checkedDate: h.checkedDate }));
    // 진도는 날짜가 아니라 진행중/완료 기준 → 현재 진도(진행중 우선, 없으면 최신 시작일)
    const progList = data.progressLog
      .filter((p) => p.studentId === studentId)
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
    const current = progList.find((p) => p.pct < 100) || progList[0];
    // 이 달 기준 교재: 진행중(이 달까지 시작했고 아직 미완료) / 완료(이 달에 완료한 교재)
    const toBook = (p: (typeof progList)[number]) => ({ unit: p.unit, area: p.area, startDate: p.startDate, endDate: p.endDate });
    const booksInProgress = progList
      .filter((p) => p.pct < 100 && (!p.startDate || p.startDate.slice(0, 7) <= ym))
      .map(toBook);
    const booksCompleted = progList
      .filter((p) => p.pct >= 100 && p.endDate && inMonth(p.endDate, ym))
      .sort((a, b) => ((a.endDate || "") < (b.endDate || "") ? -1 : 1))
      .map(toBook);
    const progress: ProgressInfo = current
      ? { pct: current.pct, unit: current.unit, area: current.area, startDate: current.startDate, weeks: "", booksInProgress, booksCompleted }
      : { ...emptyExtras().progress, booksInProgress, booksCompleted };
    // 테스트(완료) 기록을 이 달 '평가 결과'에 자동 반영 + 수동 입력 평가와 합침
    const testEvals: EvalItem[] = data.testLog
      .filter((t) => t.studentId === studentId && t.status === "완료" && inMonth(t.date, ym))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((t) => {
        // 입력 방식(만점·갯수)이면 '43/50' · '17/20문항'을 범위와 함께 표시. 점수(score)는 환산값.
        const detail = t.scoreMode === "ratio" && t.scoreDen ? `${t.scoreNum ?? 0}/${t.scoreDen}문항`
          : t.scoreMode === "max" && t.scoreDen ? `${t.scoreNum ?? 0}/${t.scoreDen}` : "";
        return {
          id: "t_" + t.id,
          type: t.type.includes("경시") ? "경시대회" : "주간평가",
          name: t.round || t.type || "테스트",
          meta: [t.range, detail].filter(Boolean).join(" · "),
          date: t.date,
          score: t.score,
        };
      });
    // 1:1 보충학습(보충수업) — 오늘/대시보드/리포트에서 입력한 것 이번 달 자동 반영.
    const supplements = (data.supplements || [])
      .filter((sp) => sp.studentId === studentId && inMonth(sp.date, ym))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((sp) => ({ id: sp.id, date: sp.date, minutes: sp.minutes, reason: sp.reason, name: sp.name, content: sp.content, note: sp.note }));
    return {
      studentId,
      studentName: s ? s.name : "학생",
      year,
      month,
      teacher: TEACHER,
      att: computeAtt(data, studentId, year, month),
      extras: { ...stored, homeworks, progress, evals: [...testEvals, ...stored.evals], supplements },
    };
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else {
        n.add(id);
        setExtrasMap((m) => (m[id] ? m : { ...m, [id]: defaultExtras(id) }));
      }
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === sorted.length ? new Set() : new Set(sorted.map((x) => x.id))));
  }
  function selectStudent(id: string) {
    setSel(id);
    setExtrasMap((m) => (m[id] ? m : { ...m, [id]: defaultExtras(id) }));
  }

  /** render one student offscreen, capture as 2 PNGs */
  async function captureStudent(d: ReportData) {
    setRender(d);
    await delay(450); // allow render + logo load
    await saveReportAsImages(d.studentName, d.year, d.month);
    setRender(null);
  }

  async function onPreviewSave() {
    if (!preview) return;
    setSaving(true);
    try {
      await saveReportAsImages(preview.studentName, preview.year, preview.month);
      toast("이미지 2장을 저장했어요.");
    } finally {
      setSaving(false);
    }
  }

  async function handleBulk() {
    const ids = [...selected];
    if (!ids.length) {
      toast("학생을 먼저 선택해 주세요.");
      return;
    }
    setBulk({ running: true, i: 0, n: ids.length });
    for (let i = 0; i < ids.length; i++) {
      setBulk({ running: true, i: i + 1, n: ids.length });
      await captureStudent(buildData(ids[i]));
      await delay(800); // 다운로드 간격
    }
    setBulk({ running: false, i: 0, n: ids.length });
    toast(ids.length + "명의 리포트를 저장했어요.");
  }

  const qq = q.trim().toLowerCase();
  const shown = qq ? sorted.filter((s) => (s.name + " " + (s.grade || "")).toLowerCase().includes(qq)) : sorted;
  const cur = sel ? sorted.find((s) => s.id === sel) ?? null : null;

  if (preview) {
    return (
      <ReportPreview
        data={preview}
        saving={saving}
        onBack={() => setPreview(null)}
        onSave={onPreviewSave}
      />
    );
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">월말 리포트</h1>
          <div className="page-desc">학생·월 선택 → 내용 작성 → 이미지 2장(상/하) 저장. 출결은 자동 집계됩니다.</div>
        </div>
        <div className="head-actions">
          <Select value={ym} onChange={setYm} options={monthOptions()} />
          <button className="btn" onClick={toggleAll}>
            {selected.size === sorted.length && sorted.length > 0 ? "전체 해제" : "전체 선택"}
          </button>
          <button className="btn primary" onClick={handleBulk} disabled={bulk.running}>
            <Icon name="copy" />
            {bulk.running ? `${bulk.i}/${bulk.n} 저장 중…` : "일괄 이미지 저장"}
          </button>
        </div>
      </div>

      {bulk.running && (
        <div className="rep-bar" style={{ marginBottom: 14 }}>
          <Icon name="refresh" />
          {bulk.n}명 중 {bulk.i}번째 처리 중… 브라우저 다운로드 팝업을 허용해 주세요.
        </div>
      )}

      {/* 중고등영어처럼 2단 — 왼쪽 학생 목록 / 오른쪽 선택 학생 입력 */}
      <div className="eng-split rep-split">
        <div className="eng-side-wrap card">
          <input className="input" style={{ marginBottom: 8 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 검색" />
          <div style={{ marginBottom: 8 }}><StudentSortToggle value={sort} onChange={setSort} /></div>
          <div className="eng-side">
            {shown.length === 0 ? (
              <div className="eng-side-empty">학생이 없어요.</div>
            ) : (
              shown.map((s) => {
                const att = computeAtt(data, s.id, year, month);
                return (
                  <div key={s.id} className={"eng-stu rep-side-row" + (sel === s.id ? " on" : "")}>
                    <input type="checkbox" className="rep-side-chk" checked={selected.has(s.id)} onChange={() => toggle(s.id)} onClick={(e) => e.stopPropagation()} title="일괄 이미지 저장 선택" />
                    <button className="eng-stu-name rep-side-btn" onClick={() => selectStudent(s.id)}>
                      <span className="rep-side-top">
                        <span className="rep-side-nm">{s.name}</span>
                        <span className="eng-lv">{s.grade}</span>
                      </span>
                      <span className="rep-side-att">출석 {att.present} · 보강 {att.makeup} · 결석 {att.absent}</span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="eng-main">
          {!cur ? (
            <div className="hub-muted" style={{ padding: 20 }}>왼쪽에서 학생을 선택하면 리포트 내용을 입력할 수 있어요.</div>
          ) : (
            <>
              <div className="rep-detail-head">
                <div className="rep-detail-title">
                  <b>{cur.name}</b>
                  <span className="badge b-gray">{cur.grade}</span>
                  {(() => { const a = computeAtt(data, cur.id, year, month); return <span className="rep-detail-att">출석 {a.present} · 보강 {a.makeup} · 결석 {a.absent}</span>; })()}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn ghost sm" onClick={() => setPreview(buildData(cur.id))}>미리보기</button>
                  <button className="btn sm" onClick={() => captureStudent(buildData(cur.id))}><Icon name="copy" />이미지 저장</button>
                </div>
              </div>
              <StudentEditor
                studentId={cur.id}
                ym={ym}
                extras={getExtras(cur.id)}
                onChange={(next) => updateExtras(cur.id, next)}
              />
            </>
          )}
        </div>
      </div>

      {/* offscreen capture target for bulk/single save */}
      {render && (
        <div className="rep-offscreen" aria-hidden>
          <ReportCard data={render} />
        </div>
      )}
    </section>
  );
}

/* ---------------- per-student content editor ---------------- */
function StudentEditor({
  studentId,
  ym,
  extras,
  onChange,
}: {
  studentId: string;
  ym: string;
  extras: ReportExtras;
  onChange: (next: ReportExtras) => void;
}) {
  const { data, mutate } = useStore();
  const set = (patch: Partial<ReportExtras>) => onChange({ ...extras, ...patch });

  // 1:1 보충학습 = 보충수업(SupLog) 통합 — 오늘/대시보드/리포트가 같은 데이터를 본다.
  const sups = (data.supplements || []).filter((sp) => sp.studentId === studentId && inMonth(sp.date, ym)).sort((a, b) => (a.date < b.date ? -1 : 1));
  function addSup() {
    mutate((d) => { d.supplements = [...(d.supplements || []), { id: uid(), studentId, date: ym + "-01", minutes: 0, reason: "", name: "", content: "", note: "" }]; });
  }
  function editSup(id: string, patch: Partial<SupLog>) {
    mutate((d) => { const sp = (d.supplements || []).find((x) => x.id === id); if (sp) Object.assign(sp, patch); });
  }
  function removeSup(id: string) {
    mutate((d) => { d.supplements = (d.supplements || []).filter((x) => x.id !== id); });
  }

  return (
    <div className="rep-editor">
      {/* 코멘트 */}
      <div className="rep-mini">선생님 종합 코멘트</div>
      <textarea
        className="input"
        rows={3}
        style={{ width: "100%", resize: "vertical" }}
        placeholder="학부모님께 전할 종합 의견"
        value={extras.comment}
        onChange={(e) => set({ comment: e.target.value })}
      />

      <div className="page-desc" style={{ margin: "12px 0 2px" }}>
        숙제·진도·평가·출결 특이사항은 기록하면 이 달 리포트에 자동으로 반영됩니다.
      </div>

      {/* 1:1 보충학습 — 오늘/대시보드 보충수업과 같은 데이터. 여기서 미리 추가·수정해도 되고, 오늘/대시보드에서 입력해도 자동으로 떠요. */}
      <div className="rep-mini" style={{ marginTop: 14 }}>
        1:1 보충학습
        <span className="page-desc" style={{ marginLeft: 8, fontWeight: 500 }}>‘오늘’·‘대시보드’에서 입력한 보충도 자동으로 떠요</span>
      </div>
      <div className="rep-suprows">
        {sups.length > 0 && (
          <div className="rep-suprow rep-suprow-head">
            <span>보충일시</span><span>시간</span><span>보충명</span><span>학습내용</span><span>보충사유</span><span>비고</span><span />
          </div>
        )}
        {sups.map((sp) => (
          <div className="rep-suprow" key={sp.id}>
            <input className="input" type="date" value={sp.date} onChange={(e) => editSup(sp.id, { date: e.target.value })} />
            <input className="input" type="number" min={0} step={5} placeholder="분" value={sp.minutes || ""} onChange={(e) => editSup(sp.id, { minutes: +e.target.value || 0 })} />
            <input className="input" placeholder="연산학습 등" value={sp.name || ""} onChange={(e) => editSup(sp.id, { name: e.target.value })} />
            <input className="input" placeholder="학습내용" value={sp.content || ""} onChange={(e) => editSup(sp.id, { content: e.target.value })} />
            <input className="input" placeholder="보충사유" value={sp.reason || ""} onChange={(e) => editSup(sp.id, { reason: e.target.value })} />
            <input className="input" placeholder="비고" value={sp.note || ""} onChange={(e) => editSup(sp.id, { note: e.target.value })} />
            <button className="rep-x" onClick={() => removeSup(sp.id)}><Icon name="x" /></button>
          </div>
        ))}
      </div>
      <button className="btn ghost sm" style={{ marginTop: 7 }} onClick={addSup}>
        <Icon name="plus" />
        1:1 보충학습 추가
      </button>
    </div>
  );
}
