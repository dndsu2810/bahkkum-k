import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import type { Student } from "../types";
import type { EvalItem, HwItem, NoteItem, ReportData, ReportExtras } from "../lib/reportTypes";
import { emptyExtras } from "../lib/reportTypes";
import { computeAtt, deriveNotes } from "../lib/reportCompute";
import { loadExtras, saveExtras } from "../lib/reportExtras";
import { saveReportAsImages } from "../lib/reportImage";
import { curMonthStr, monthOptions, studentById } from "../lib/logic";
import { uid } from "../lib/dates";
import { Select } from "../components/ui";
import { Icon } from "../icons";
import { ReportCard } from "../components/ReportCard";
import { ReportPreview } from "./ReportPreview";

const TEACHER = "이지현";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Report() {
  const { data, toast } = useStore();
  const [ym, setYm] = useState(curMonthStr());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
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

  const sorted = useMemo(
    () =>
      data.students
        .slice()
        .sort((a, b) => (a.grade === b.grade ? (a.name < b.name ? -1 : 1) : a.grade === "초등" ? -1 : 1)),
    [data.students]
  );

  function defaultExtras(studentId: string): ReportExtras {
    return loadExtras(studentId, ym) || { ...emptyExtras(), notes: deriveNotes(data, studentId, year, month) };
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
    return {
      studentId,
      studentName: s ? s.name : "학생",
      year,
      month,
      teacher: TEACHER,
      att: computeAtt(data, studentId, year, month),
      extras: getExtras(studentId),
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
  function toggleOpen(id: string) {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else {
        n.add(id);
        setExtrasMap((m) => (m[id] ? m : { ...m, [id]: defaultExtras(id) }));
      }
      return n;
    });
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
          <div className="page-title">월말 리포트</div>
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

      <div className="card" style={{ padding: 16 }}>
        <div className="rep-list">
          {sorted.map((s) => {
            const att = computeAtt(data, s.id, year, month);
            const isSel = selected.has(s.id);
            const isOpen = open.has(s.id);
            return (
              <div key={s.id}>
                <div className={"rep-srow" + (isSel ? " sel" : "")}>
                  <input type="checkbox" checked={isSel} onChange={() => toggle(s.id)} />
                  <span className="nm">{s.name}</span>
                  <span className="badge b-gray">{s.grade}</span>
                  <span className="att">
                    출석 {att.present} · 보강 {att.makeup} · 결석 {att.absent}
                  </span>
                  <button className="btn ghost sm" onClick={() => toggleOpen(s.id)}>
                    <Icon name="edit" />
                    내용
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => setPreview(buildData(s.id))}
                  >
                    미리보기
                  </button>
                </div>
                {isOpen && (
                  <StudentEditor
                    extras={getExtras(s.id)}
                    onChange={(next) => updateExtras(s.id, next)}
                    onReloadNotes={() =>
                      updateExtras(s.id, { ...getExtras(s.id), notes: deriveNotes(data, s.id, year, month) })
                    }
                  />
                )}
              </div>
            );
          })}
          {!sorted.length && <div className="empty">학생을 먼저 등록해 주세요.</div>}
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
  extras,
  onChange,
  onReloadNotes,
}: {
  extras: ReportExtras;
  onChange: (next: ReportExtras) => void;
  onReloadNotes: () => void;
}) {
  const set = (patch: Partial<ReportExtras>) => onChange({ ...extras, ...patch });
  const p = extras.progress;

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

      {/* 진도 */}
      <div className="rep-mini">진도 달성 현황</div>
      <div className="rep-itemrow">
        <input
          className="input"
          type="number"
          min={0}
          max={100}
          style={{ width: 90 }}
          placeholder="달성률%"
          value={p.pct || ""}
          onChange={(e) => set({ progress: { ...p, pct: +e.target.value || 0 } })}
        />
        <input
          className="input"
          style={{ flex: 1, minWidth: 160 }}
          placeholder="현재 학습 단원 (예: 3단원 소수의 나눗셈)"
          value={p.unit}
          onChange={(e) => set({ progress: { ...p, unit: e.target.value } })}
        />
      </div>
      <div className="rep-itemrow" style={{ marginTop: 7 }}>
        <input className="input" style={{ width: 120 }} placeholder="학습 영역" value={p.area} onChange={(e) => set({ progress: { ...p, area: e.target.value } })} />
        <input className="input" type="date" style={{ width: 160 }} value={p.startDate} onChange={(e) => set({ progress: { ...p, startDate: e.target.value } })} />
        <input className="input" style={{ width: 120 }} placeholder="학습 기간(약 6주차)" value={p.weeks} onChange={(e) => set({ progress: { ...p, weeks: e.target.value } })} />
      </div>

      {/* 평가 */}
      <div className="rep-mini">평가 결과 (주간평가 · 경시대회)</div>
      <div className="rep-list">
        {extras.evals.map((ev, i) => (
          <div className="rep-itemrow" key={ev.id}>
            <select className="input" value={ev.type} onChange={(e) => editEval(i, { type: e.target.value as EvalItem["type"] })}>
              <option>주간평가</option>
              <option>경시대회</option>
            </select>
            <input className="input" style={{ width: 130 }} placeholder="이름(4월 1주차)" value={ev.name} onChange={(e) => editEval(i, { name: e.target.value })} />
            <input className="input" style={{ width: 100 }} placeholder="단원" value={ev.meta} onChange={(e) => editEval(i, { meta: e.target.value })} />
            <input className="input" type="date" style={{ width: 150 }} value={ev.date} onChange={(e) => editEval(i, { date: e.target.value })} />
            <input className="input" type="number" style={{ width: 80 }} placeholder="점수" value={ev.score || ""} onChange={(e) => editEval(i, { score: +e.target.value || 0 })} />
            <button className="rep-x" onClick={() => set({ evals: extras.evals.filter((_, j) => j !== i) })}>
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
      <button className="btn ghost sm" style={{ marginTop: 7 }} onClick={() => set({ evals: [...extras.evals, { id: uid(), type: "주간평가", name: "", meta: "", date: "", score: 0 }] })}>
        <Icon name="plus" />
        평가 추가
      </button>

      {/* 숙제 */}
      <div className="rep-mini">숙제 및 수행 기록</div>
      <div className="rep-list">
        {extras.homeworks.map((h, i) => (
          <div className="rep-itemrow" key={h.id}>
            <input className="input" type="date" style={{ width: 150 }} value={h.date} onChange={(e) => editHw(i, { date: e.target.value })} />
            <input className="input" style={{ width: 150 }} placeholder="교재" value={h.book} onChange={(e) => editHw(i, { book: e.target.value })} />
            <input className="input" style={{ width: 130 }} placeholder="태그(쉼표)" value={h.tags.join(",")} onChange={(e) => editHw(i, { tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} />
            <input className="input" type="number" min={0} max={100} style={{ width: 80 }} placeholder="완성%" value={h.completion || ""} onChange={(e) => editHw(i, { completion: +e.target.value || 0 })} />
            <select className="input" value={h.status} onChange={(e) => editHw(i, { status: e.target.value as HwItem["status"] })}>
              <option value="done">검사완료</option>
              <option value="late">지연</option>
            </select>
            <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="선생님 메모(선택)" value={h.memo} onChange={(e) => editHw(i, { memo: e.target.value })} />
            <button className="rep-x" onClick={() => set({ homeworks: extras.homeworks.filter((_, j) => j !== i) })}>
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
      <button className="btn ghost sm" style={{ marginTop: 7 }} onClick={() => set({ homeworks: [...extras.homeworks, { id: uid(), date: "", book: "", tags: [], completion: 0, status: "done", memo: "" }] })}>
        <Icon name="plus" />
        숙제 추가
      </button>

      {/* 출결 특이사항 */}
      <div className="rep-mini">
        출결 특이사항
        <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={onReloadNotes}>
          <Icon name="refresh" />
          출결에서 불러오기
        </button>
      </div>
      <div className="rep-list">
        {extras.notes.map((nt, i) => (
          <div className="rep-itemrow" key={nt.id}>
            <input className="input" style={{ width: 110 }} placeholder="05 / 04" value={nt.dateLabel} onChange={(e) => editNote(i, { dateLabel: e.target.value })} />
            <select className="input" value={nt.tone} onChange={(e) => editNote(i, { tone: e.target.value as NoteItem["tone"] })}>
              <option value="r">결석(빨강)</option>
              <option value="b">보강(파랑)</option>
              <option value="g">기타(초록)</option>
            </select>
            <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="특이사항 내용" value={nt.text} onChange={(e) => editNote(i, { text: e.target.value })} />
            <button className="rep-x" onClick={() => set({ notes: extras.notes.filter((_, j) => j !== i) })}>
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
      <button className="btn ghost sm" style={{ marginTop: 7 }} onClick={() => set({ notes: [...extras.notes, { id: uid(), dateLabel: "", tone: "g", text: "" }] })}>
        <Icon name="plus" />
        특이사항 추가
      </button>
    </div>
  );

  function editEval(i: number, patch: Partial<EvalItem>) {
    set({ evals: extras.evals.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  }
  function editHw(i: number, patch: Partial<HwItem>) {
    set({ homeworks: extras.homeworks.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  }
  function editNote(i: number, patch: Partial<NoteItem>) {
    set({ notes: extras.notes.map((nt, j) => (j === i ? { ...nt, ...patch } : nt)) });
  }
}
