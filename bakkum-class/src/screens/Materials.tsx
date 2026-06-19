import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { materialsApi, type Material, type MaterialAssign } from "../lib/hubApi";
import { getRoster, inEngBand, type RosterStudent } from "../lib/rosterApi";
import { todayStr, fmtMDDow } from "../lib/dates";
import { DateField } from "../components/DateControls";

// 자료 분류 — 공통 / 중고등영어 / 초등영어 / 수학(수학은 초·중고 합산). 'english'는 구버전 값(영어 통합).
const SUBJECTS = [
  { v: "", l: "공통" },
  { v: "eng_mid", l: "중고등영어" },
  { v: "eng_elem", l: "초등영어" },
  { v: "math", l: "수학" },
];
const FILTERS = [{ v: "", l: "전체" }, ...SUBJECTS.slice(1)];
const subjLabel = (v: string) => (v === "english" ? "영어" : SUBJECTS.find((s) => s.v === v)?.l || "공통");
// 색상 클래스 — 영어 계열(중고등·초등·구버전)은 같은 색, 수학은 브랜드색, 공통은 회색.
const subjCls = (v: string) => (v === "math" ? "math" : v === "eng_mid" || v === "eng_elem" || v === "english" ? "english" : "all");
// 자료 분류에 해당하는 학생만 — 등록 폼·배부 후보 공통 사용.
const matchSubject = (s: RosterStudent, subject: string): boolean => {
  if (subject === "math") return s.subjects.includes("math");
  if (subject === "eng_mid") return s.subjects.includes("english") && inEngBand(s.englishBand, "mid");
  if (subject === "eng_elem") return s.subjects.includes("english") && s.englishBand === "elem";
  if (subject === "english") return s.subjects.includes("english");
  return true; // 공통
};

/** 자료/프린트 배부(공용) — 인쇄할 프린트 목록 등록 → 학생에게 수업/숙제로 배부 → 완료 추적. */
export function Materials() {
  const { user } = useAuth();
  const canEdit = user?.role !== "student";
  const [materials, setMaterials] = useState<Material[]>([]);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [sel, setSel] = useState("");
  const [assigns, setAssigns] = useState<MaterialAssign[]>([]);
  const [filter, setFilter] = useState("");
  const [newName, setNewName] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newFile, setNewFile] = useState("");
  const [newCopies, setNewCopies] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newSchools, setNewSchools] = useState<string[]>([]); // 대상 학교(복수 선택 — 복합중·한국중 등)
  const [newGrade, setNewGrade] = useState("");
  const [newPrintBy, setNewPrintBy] = useState(""); // 인쇄 마감일
  const [newGiveDate, setNewGiveDate] = useState(""); // 배부 예정일
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [draggedId, setDraggedId] = useState(""); // 칸반 드래그 중인 자료

  // 대상 학교·학년 선택 → 그 학생 인원수만큼 인쇄 부수 자동.
  // 분류(공통/중고등영어/초등영어/수학)에 맞는 학생만 → 그 band의 학교·학년만 보이게.
  const activeRoster = useMemo(() => roster.filter((s) => (!s.status || s.status === "재원") && matchSubject(s, newSubject)), [roster, newSubject]);
  const schools = useMemo(() => [...new Set(activeRoster.map((s) => s.school).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")), [activeRoster]);
  const gradesForSchool = useMemo(() => [...new Set(activeRoster.filter((s) => !newSchools.length || newSchools.includes(s.school)).map((s) => s.grade).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")), [activeRoster, newSchools]);
  const matchCount = useMemo(() => activeRoster.filter((s) => (!newSchools.length || newSchools.includes(s.school)) && (!newGrade || s.grade === newGrade)).length, [activeRoster, newSchools, newGrade]);
  // 학교(들)가 정해지면 부수를 인원수로 자동 채움(학년까지 고르면 더 좁힘, 이후 수동 수정 가능).
  useEffect(() => { if (newSchools.length) setNewCopies(String(matchCount)); }, [newSchools, newGrade, matchCount]);
  // 분류를 바꾸면 대상 학교·학년 선택을 초기화(다른 band 학교가 남지 않게).
  useEffect(() => { setNewSchools([]); setNewGrade(""); }, [newSubject]);

  const reloadMaterials = () => materialsApi.list().then(setMaterials).catch(() => setErr("자료를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."));
  useEffect(() => { void reloadMaterials(); getRoster().then(setRoster).catch(() => {}); }, []);
  const reloadAssigns = (mid: string) => { if (mid) materialsApi.assigns({ materialId: mid }).then(setAssigns).catch(() => {}); else setAssigns([]); };
  useEffect(() => { reloadAssigns(sel); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sel]);

  const nameOf = useMemo(() => { const m: Record<string, string> = {}; for (const s of roster) m[s.id] = s.name; return m; }, [roster]);
  const shown = materials.filter((mt) =>
    !filter || mt.subject === "" || mt.subject === filter ||
    (mt.subject === "english" && (filter === "eng_mid" || filter === "eng_elem")) // 구버전 '영어'는 영어 탭들에 표시
  );
  const waiting = shown.filter((mt) => !mt.printed);
  const printed = shown.filter((mt) => mt.printed);
  const selMat = materials.find((mt) => mt.id === sel);

  async function addMaterial() {
    if (!newName.trim() || saving) return; // 중복 제출 방지(느릴 때 여러 번 눌러 여러 개 생기던 문제)
    setSaving(true);
    try {
      await materialsApi.save({ name: newName.trim(), subject: newSubject, filePath: newFile.trim(), copies: Number(newCopies) || 0, assignee: newAssignee.trim(), school: newSchools.join(", "), grade: newGrade, printBy: newPrintBy, giveDate: newGiveDate });
      setNewName(""); setNewFile(""); setNewCopies(""); setNewAssignee(""); setNewSchools([]); setNewGrade(""); setNewPrintBy(""); setNewGiveDate(""); setErr("");
      await reloadMaterials();
    }
    catch { setErr("저장에 실패했어요."); }
    finally { setSaving(false); }
  }
  // 칸반 드롭 — 대기(false)/배부완료(true=인쇄완료) 컬럼으로 끌어다 놓으면 상태 변경.
  async function onDropMaterial(targetPrinted: boolean) {
    const id = draggedId;
    setDraggedId("");
    if (!id) return;
    const mt = materials.find((m) => m.id === id);
    if (mt && mt.printed !== targetPrinted) { await materialsApi.setPrinted(id, targetPrinted); await reloadMaterials(); }
  }
  async function removeMaterial(mt: Material) {
    if (!window.confirm(`"${mt.name}" 자료와 배부 내역을 삭제할까요?`)) return;
    await materialsApi.remove(mt.id);
    if (sel === mt.id) setSel("");
    await reloadMaterials();
  }

  return (
    <div className="sm-wrap">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">자료 / 프린트 배부</h1>
          <p className="sm-desc">인쇄할 프린트를 등록하고, 인쇄해두면 학생에게 수업·숙제로 배부하세요. 누가 받았는지·완료됐는지 한눈에 봅니다.</p>
        </div>
        <div className="cal-viewtoggle">
          {FILTERS.map((f) => (
            <button key={f.v} className={"sm-fchip" + (filter === f.v ? " on" : "")} onClick={() => setFilter(f.v)}>{f.l}</button>
          ))}
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}

      <div className="mat-kanban">
        {canEdit && (
          <div className="mat-col mat-col-input">
            <div className="mat-col-h">새 자료 등록</div>
            <div className="mat-add">
              <input className="sm-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="자료 이름 (예: 호평중3 3과 워크북)" onKeyDown={(e) => e.key === "Enter" && addMaterial()} />
              <div className="sm-subj" style={{ marginTop: 6 }}>
                {SUBJECTS.map((s) => (
                  <button key={s.v} className={"sm-subj-chip" + (newSubject === s.v ? " on" : "")} onClick={() => setNewSubject(s.v)}>{s.l}</button>
                ))}
              </div>
              <input className="sm-input" style={{ marginTop: 6 }} value={newFile} onChange={(e) => setNewFile(e.target.value)} placeholder="프린트 문서 경로/링크 (예: 드라이브 링크·G:\\프린트\\3과.pdf)" />
              {schools.length > 0 && (
                <label className="mat-add-f" style={{ marginTop: 6 }}>
                  <span>대상 학교 (여러 곳 선택 가능)</span>
                  <div className="sm-subj" style={{ flexWrap: "wrap", gap: 4 }}>
                    {schools.map((sc) => {
                      const on = newSchools.includes(sc);
                      return (
                        <button key={sc} type="button" className={"sm-subj-chip" + (on ? " on" : "")} onClick={() => { setNewSchools(on ? newSchools.filter((x) => x !== sc) : [...newSchools, sc]); setNewGrade(""); }}>{sc}</button>
                      );
                    })}
                  </div>
                </label>
              )}
              <div className="mat-add-grid">
                <label className="mat-add-f">
                  <span>학년</span>
                  <select className="sm-input" value={newGrade} onChange={(e) => setNewGrade(e.target.value)} disabled={!newSchools.length}>
                    <option value="">{newSchools.length ? "선택" : "학교 먼저"}</option>
                    {gradesForSchool.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <label className="mat-add-f">
                  <span>부수{newSchools.length ? ` · ${matchCount}명` : ""}</span>
                  <input className="sm-input" inputMode="numeric" value={newCopies} onChange={(e) => setNewCopies(e.target.value.replace(/[^0-9]/g, ""))} placeholder="부수" />
                </label>
                <label className="mat-add-f">
                  <span>담당자</span>
                  <input className="sm-input" value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)} placeholder="인쇄 담당" />
                </label>
              </div>
              <div className="mat-add-grid">
                <label className="mat-add-f">
                  <span>인쇄 마감일 <span className="mat-add-opt">언제까지</span></span>
                  <DateField value={newPrintBy} onChange={setNewPrintBy} placeholder="인쇄 마감일" />
                </label>
                <label className="mat-add-f">
                  <span>배부 예정일 <span className="mat-add-opt">언제 줄지</span></span>
                  <DateField value={newGiveDate} onChange={setNewGiveDate} placeholder="배부 예정일" />
                </label>
              </div>
              <div className="mat-add-row" style={{ marginTop: 6 }}>
                <button className="btn primary sm" onClick={addMaterial} disabled={!newName.trim() || saving}>{saving ? "등록 중…" : "등록"}</button>
              </div>
            </div>
          </div>
        )}

        <MatColumn title="🖨 인쇄 대기" items={waiting} targetPrinted={false} onCardClick={setSel} onRemove={removeMaterial} canEdit={canEdit} onDropMaterial={onDropMaterial} draggedId={draggedId} setDraggedId={setDraggedId} emptyText="대기 중인 자료가 없어요. 카드를 여기로 끌어다 놓으면 대기로 돌아와요." />
        <MatColumn title="✓ 배부완료" items={printed} targetPrinted={true} onCardClick={setSel} onRemove={removeMaterial} canEdit={canEdit} onDropMaterial={onDropMaterial} draggedId={draggedId} setDraggedId={setDraggedId} emptyText="배부완료한 자료가 없어요. 인쇄·배부를 마치면 카드를 여기로 끌어다 놓으세요." hint="카드를 클릭하면 배부 창이 열려요" />
      </div>

      {selMat && (
        <div className="prof-overlay mat-overlay" onClick={() => setSel("")}>
          <div className="mat-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x mat-modal-x" onClick={() => setSel("")} aria-label="닫기">✕</button>
            <MaterialDetail
              material={selMat}
              assigns={assigns}
              roster={roster}
              nameOf={nameOf}
              canEdit={canEdit}
              onChanged={() => { reloadAssigns(selMat.id); void reloadMaterials(); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MatColumn({ title, items, targetPrinted, onCardClick, onRemove, canEdit, onDropMaterial, draggedId, setDraggedId, emptyText, hint }: {
  title: string; items: Material[]; targetPrinted: boolean;
  onCardClick: (id: string) => void; onRemove: (m: Material) => void; canEdit: boolean;
  onDropMaterial: (targetPrinted: boolean) => void; draggedId: string; setDraggedId: (id: string) => void; emptyText: string; hint?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={"mat-col" + (over ? " drop-over" : "")}
      onDragOver={(e) => { if (canEdit && draggedId) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={() => { setOver(false); onDropMaterial(targetPrinted); }}
    >
      <div className="mat-col-h">{title} <span className="mat-group-c">{items.length}</span></div>
      {hint && <div className="mat-col-hint">{hint}</div>}
      {items.length === 0 ? (
        <div className="mat-col-empty">{emptyText}</div>
      ) : items.map((mt) => (
        <div
          key={mt.id}
          className={"mat-card" + (draggedId === mt.id ? " dragging" : "")}
          draggable={canEdit}
          onDragStart={() => setDraggedId(mt.id)}
          onDragEnd={() => setDraggedId("")}
          onClick={() => onCardClick(mt.id)}
        >
          <div className="mat-card-top">
            <div className="mat-card-name">{mt.name}</div>
            {canEdit && <button className="mat-card-x" onClick={(e) => { e.stopPropagation(); onRemove(mt); }} aria-label="삭제">✕</button>}
          </div>
          <div className="mat-item-sub">
            <span className={"mat-subj mat-subj-" + subjCls(mt.subject)}>{subjLabel(mt.subject)}</span>
            {mt.stat.total > 0 && <span className="mat-item-stat">배부 {mt.stat.total}</span>}
          </div>
          {(mt.printBy || mt.giveDate) && (
            <div className="mat-card-dates">
              {mt.printBy && <span className="mat-date-chip print">🖨 ~{fmtMDDow(mt.printBy)} 인쇄</span>}
              {mt.giveDate && <span className="mat-date-chip give">📨 {fmtMDDow(mt.giveDate)} 배부</span>}
            </div>
          )}
          {(mt.copies > 0 || mt.school || mt.assignee) && (
            <div className="mat-item-meta">
              {(mt.school || mt.grade) && <span>{mt.school}{mt.grade ? " " + mt.grade : ""}</span>}
              {mt.copies > 0 && <span>{mt.copies}부</span>}
              {mt.assignee && <span>담당 {mt.assignee}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const KINDS = [{ v: "lesson", l: "수업" }, { v: "hw_check", l: "검사할 숙제" }, { v: "hw_assign", l: "내줄 숙제" }] as const;
// 배부 대상 학생 카테고리 — 전체/수학/초등영어/중고등영어(브릿지 포함).
const CATS = [{ v: "", l: "전체" }, { v: "math", l: "수학" }, { v: "elem", l: "초등영어" }, { v: "mid", l: "중고등영어" }] as const;

function MaterialDetail({ material, assigns, roster, nameOf, canEdit, onChanged }: {
  material: Material; assigns: MaterialAssign[]; roster: RosterStudent[]; nameOf: Record<string, string>;
  canEdit: boolean; onChanged: () => void;
}) {
  const [kind, setKind] = useState<"lesson" | "hw_check" | "hw_assign">("lesson");
  const [date, setDate] = useState(todayStr());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"" | "math" | "elem" | "mid">("");

  // 배부 대상 후보 — 자료 분류(공통/중고등영어/초등영어/수학) + 카테고리(수동 좁히기) + 검색.
  const cand = useMemo(() => {
    let list = roster.filter((s) => (!s.status || s.status === "재원") && matchSubject(s, material.subject));
    if (cat === "math") list = list.filter((s) => s.subjects.includes("math"));
    else if (cat === "elem") list = list.filter((s) => s.subjects.includes("english") && s.englishBand === "elem");
    else if (cat === "mid") list = list.filter((s) => s.subjects.includes("english") && (s.englishBand === "mid" || s.englishBand === "bridge"));
    const qq = q.trim().toLowerCase();
    if (qq) list = list.filter((s) => (s.name + " " + (s.school || "")).toLowerCase().includes(qq));
    return list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [roster, material.subject, cat, q]);

  // 이미 배부된 (학생, 종류) 집합 — 중복 배부 방지 표시.
  const assignedKey = useMemo(() => new Set(assigns.map((a) => a.studentId + "|" + a.kind)), [assigns]);

  function toggle(id: string) {
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  async function doAssign() {
    if (!picked.size) return;
    await materialsApi.assign({ materialId: material.id, studentIds: [...picked], kind, date });
    setPicked(new Set());
    onChanged();
  }
  async function unassign(a: MaterialAssign) { await materialsApi.unassign(a.id); onChanged(); }

  const lessonRows = assigns.filter((a) => a.kind === "lesson");
  const checkRows = assigns.filter((a) => a.kind === "hw_check");
  const assignRows = assigns.filter((a) => a.kind === "hw_assign");

  return (
    <div className="mat-detail">
      <div className="mat-detail-h">
        <h2>{material.name}</h2>
        <span className={"mat-subj mat-subj-" + subjCls(material.subject)}>{subjLabel(material.subject)}</span>
        {!material.printed && <span className="mat-print-warn">인쇄 대기</span>}
      </div>
      {(material.copies > 0 || material.school || material.assignee || material.filePath) && (
        <div className="mat-detail-meta">
          {(material.school || material.grade) && <span className="mat-meta-chip">{material.school}{material.grade ? " " + material.grade : ""}</span>}
          {material.copies > 0 && <span className="mat-meta-chip">인쇄 {material.copies}부</span>}
          {material.assignee && <span className="mat-meta-chip">담당 {material.assignee}</span>}
          {material.filePath && (/^https?:\/\//.test(material.filePath)
            ? <a className="mat-meta-link" href={material.filePath} target="_blank" rel="noreferrer">📄 문서 열기</a>
            : <span className="mat-meta-chip">📄 {material.filePath}</span>)}
        </div>
      )}

      {canEdit && (
        <div className="card mat-assign-box">
          <div className="mat-assign-ctl">
            <div className="sm-subj">
              {KINDS.map((k) => (
                <button key={k.v} className={"sm-subj-chip" + (kind === k.v ? " on" : "")} onClick={() => setKind(k.v)}>{k.l}(으)로 배부</button>
              ))}
            </div>
            <DateField value={date} onChange={setDate} />
            <button className="btn primary sm" onClick={doAssign} disabled={!picked.size}>{picked.size ? `${picked.size}명에게 배부` : "학생 선택"}</button>
          </div>
          <div className="sm-subj" style={{ flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {CATS.map((c) => (
              <button key={c.v} type="button" className={"sm-subj-chip" + (cat === c.v ? " on" : "")} onClick={() => setCat(c.v)}>{c.l}</button>
            ))}
          </div>
          <input className="sm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 검색 (이름·학교)" style={{ margin: "8px 0" }} />
          <div className="mat-cand">
            {cand.map((s) => {
              const already = assignedKey.has(s.id + "|" + kind);
              return (
                <button key={s.id} className={"mat-cand-chip" + (picked.has(s.id) ? " on" : "") + (already ? " already" : "")} onClick={() => toggle(s.id)} title={already ? "이미 이 종류로 배부됨" : ""}>
                  {s.name}{already && <span className="mat-cand-dot">✓</span>}
                </button>
              );
            })}
            {cand.length === 0 && <div className="hub-muted">대상 학생이 없어요.</div>}
          </div>
        </div>
      )}

      <div className="mat-lists">
        <AssignList title="수업으로 배부" rows={lessonRows} nameOf={nameOf} canEdit={canEdit} onRemove={unassign} />
        <AssignList title="검사할 숙제로 배부" rows={checkRows} nameOf={nameOf} canEdit={canEdit} onRemove={unassign} />
        <AssignList title="내줄 숙제로 배부" rows={assignRows} nameOf={nameOf} canEdit={canEdit} onRemove={unassign} />
      </div>
    </div>
  );
}

function AssignList({ title, rows, nameOf, canEdit, onRemove }: {
  title: string; rows: MaterialAssign[]; nameOf: Record<string, string>; canEdit: boolean;
  onRemove: (a: MaterialAssign) => void;
}) {
  return (
    <div className="mat-alist">
      <div className="mat-alist-h">{title} <span className="mat-group-c">{rows.length}</span></div>
      {rows.length === 0 ? (
        <div className="eng-side-empty">아직 없어요.</div>
      ) : rows.map((a) => (
        <div className="mat-arow" key={a.id}>
          <span className="mat-arow-main">
            <span className="mat-arow-name">{nameOf[a.studentId] || "(삭제된 학생)"}</span>
            {a.date && <span className="mat-arow-date">{a.date.slice(5)}</span>}
          </span>
          {canEdit && <button className="btn ghost xs" onClick={() => onRemove(a)} aria-label="배부 취소">✕</button>}
        </div>
      ))}
    </div>
  );
}
