import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { materialsApi, type Material, type MaterialAssign } from "../lib/hubApi";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { todayStr } from "../lib/dates";
import { DateField } from "../components/DateControls";

const SUBJECTS = [
  { v: "", l: "공통" },
  { v: "math", l: "수학" },
  { v: "english", l: "영어" },
];
const FILTERS = [{ v: "", l: "전체" }, ...SUBJECTS.slice(1)];
const subjLabel = (v: string) => SUBJECTS.find((s) => s.v === v)?.l || "공통";

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
  const [newSchool, setNewSchool] = useState("");
  const [newGrade, setNewGrade] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // 대상 학교·학년 선택 → 그 학생 인원수만큼 인쇄 부수 자동.
  const activeRoster = useMemo(() => roster.filter((s) => !s.status || s.status === "재원"), [roster]);
  const schools = useMemo(() => [...new Set(activeRoster.map((s) => s.school).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")), [activeRoster]);
  const gradesForSchool = useMemo(() => [...new Set(activeRoster.filter((s) => !newSchool || s.school === newSchool).map((s) => s.grade).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")), [activeRoster, newSchool]);
  const matchCount = useMemo(() => activeRoster.filter((s) => (!newSchool || s.school === newSchool) && (!newGrade || s.grade === newGrade)).length, [activeRoster, newSchool, newGrade]);
  // 학교+학년이 모두 정해지면 부수를 인원수로 자동 채움(이후 수동 수정 가능).
  useEffect(() => { if (newSchool && newGrade) setNewCopies(String(matchCount)); }, [newSchool, newGrade, matchCount]);

  const reloadMaterials = () => materialsApi.list().then(setMaterials).catch(() => setErr("자료를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."));
  useEffect(() => { void reloadMaterials(); getRoster().then(setRoster).catch(() => {}); }, []);
  const reloadAssigns = (mid: string) => { if (mid) materialsApi.assigns({ materialId: mid }).then(setAssigns).catch(() => {}); else setAssigns([]); };
  useEffect(() => { reloadAssigns(sel); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sel]);

  const nameOf = useMemo(() => { const m: Record<string, string> = {}; for (const s of roster) m[s.id] = s.name; return m; }, [roster]);
  const shown = materials.filter((mt) => !filter || mt.subject === filter || mt.subject === "");
  const waiting = shown.filter((mt) => !mt.printed);
  const printed = shown.filter((mt) => mt.printed);
  const selMat = materials.find((mt) => mt.id === sel);

  async function addMaterial() {
    if (!newName.trim() || saving) return; // 중복 제출 방지(느릴 때 여러 번 눌러 여러 개 생기던 문제)
    setSaving(true);
    try {
      await materialsApi.save({ name: newName.trim(), subject: newSubject, filePath: newFile.trim(), copies: Number(newCopies) || 0, assignee: newAssignee.trim(), school: newSchool, grade: newGrade });
      setNewName(""); setNewFile(""); setNewCopies(""); setNewAssignee(""); setNewSchool(""); setNewGrade(""); setErr("");
      await reloadMaterials();
    }
    catch { setErr("저장에 실패했어요."); }
    finally { setSaving(false); }
  }
  async function togglePrint(mt: Material) { await materialsApi.setPrinted(mt.id, !mt.printed); await reloadMaterials(); }
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

      <div className="eng-split">
        {/* 자료 목록 */}
        <div className="eng-side" style={{ minWidth: 280 }}>
          {canEdit && (
            <div className="mat-add">
              <input className="sm-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="자료 이름 (예: 호평중3 3과 워크북)" onKeyDown={(e) => e.key === "Enter" && addMaterial()} />
              <div className="sm-subj" style={{ marginTop: 6 }}>
                {SUBJECTS.map((s) => (
                  <button key={s.v} className={"sm-subj-chip" + (newSubject === s.v ? " on" : "")} onClick={() => setNewSubject(s.v)}>{s.l}</button>
                ))}
              </div>
              <input className="sm-input" style={{ marginTop: 6 }} value={newFile} onChange={(e) => setNewFile(e.target.value)} placeholder="프린트 문서 경로/링크 (예: 드라이브 링크·G:\\프린트\\3과.pdf)" />
              <div className="mat-add-grid">
                <label className="mat-add-f">
                  <span>학교</span>
                  <select className="sm-input" value={newSchool} onChange={(e) => { setNewSchool(e.target.value); setNewGrade(""); }}>
                    <option value="">선택</option>
                    {schools.map((sc) => <option key={sc} value={sc}>{sc}</option>)}
                  </select>
                </label>
                <label className="mat-add-f">
                  <span>학년</span>
                  <select className="sm-input" value={newGrade} onChange={(e) => setNewGrade(e.target.value)} disabled={!newSchool}>
                    <option value="">{newSchool ? "선택" : "학교 먼저"}</option>
                    {gradesForSchool.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <label className="mat-add-f">
                  <span>부수{newSchool && newGrade ? ` · ${matchCount}명` : ""}</span>
                  <input className="sm-input" inputMode="numeric" value={newCopies} onChange={(e) => setNewCopies(e.target.value.replace(/[^0-9]/g, ""))} placeholder="부수" />
                </label>
                <label className="mat-add-f">
                  <span>담당자</span>
                  <input className="sm-input" value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)} placeholder="인쇄 담당" />
                </label>
              </div>
              <div className="mat-add-row" style={{ marginTop: 6 }}>
                <button className="btn primary sm" onClick={addMaterial} disabled={!newName.trim() || saving}>{saving ? "등록 중…" : "등록"}</button>
              </div>
            </div>
          )}

          <MatGroup title="🖨 인쇄 대기" items={waiting} sel={sel} onSel={setSel} onPrint={togglePrint} onRemove={removeMaterial} canEdit={canEdit} emptyText="인쇄 대기 중인 자료가 없어요." />
          <MatGroup title="✓ 인쇄 완료" items={printed} sel={sel} onSel={setSel} onPrint={togglePrint} onRemove={removeMaterial} canEdit={canEdit} emptyText="인쇄 완료한 자료가 없어요." />
        </div>

        {/* 배부 현황 + 새 배부 */}
        <div className="eng-main">
          {!selMat ? (
            <div className="hub-muted" style={{ padding: 20 }}>왼쪽에서 자료를 선택하면 배부 현황을 보고, 학생에게 수업·숙제로 배부할 수 있어요.</div>
          ) : (
            <MaterialDetail
              key={selMat.id}
              material={selMat}
              assigns={assigns}
              roster={roster}
              nameOf={nameOf}
              canEdit={canEdit}
              onChanged={() => { reloadAssigns(selMat.id); void reloadMaterials(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MatGroup({ title, items, sel, onSel, onPrint, onRemove, canEdit, emptyText }: {
  title: string; items: Material[]; sel: string; onSel: (id: string) => void;
  onPrint: (m: Material) => void; onRemove: (m: Material) => void; canEdit: boolean; emptyText: string;
}) {
  return (
    <div className="mat-group">
      <div className="mat-group-h">{title} <span className="mat-group-c">{items.length}</span></div>
      {items.length === 0 ? (
        <div className="eng-side-empty">{emptyText}</div>
      ) : items.map((mt) => (
        <div key={mt.id} className={"mat-item" + (sel === mt.id ? " on" : "")}>
          <button className="mat-item-main" onClick={() => onSel(mt.id)}>
            <div className="mat-item-name">{mt.name}</div>
            <div className="mat-item-sub">
              <span className={"mat-subj mat-subj-" + (mt.subject || "all")}>{subjLabel(mt.subject)}</span>
              {mt.stat.total > 0 && <span className="mat-item-stat">수업 {mt.stat.lesson} · 숙제 {mt.stat.hw} · 완료 {mt.stat.done}/{mt.stat.total}</span>}
            </div>
            {(mt.copies > 0 || mt.school || mt.assignee) && (
              <div className="mat-item-meta">
                {(mt.school || mt.grade) && <span>{mt.school}{mt.grade ? " " + mt.grade : ""}</span>}
                {mt.copies > 0 && <span>{mt.copies}부</span>}
                {mt.assignee && <span>담당 {mt.assignee}</span>}
              </div>
            )}
          </button>
          {canEdit && (
            <div className="mat-item-act">
              <button className={"btn ghost xs" + (mt.printed ? " on" : "")} onClick={() => onPrint(mt)} title={mt.printed ? "인쇄 대기로" : "인쇄 완료로"}>{mt.printed ? "인쇄됨" : "인쇄"}</button>
              <button className="btn ghost xs" onClick={() => onRemove(mt)} aria-label="삭제">✕</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const KINDS = [{ v: "lesson", l: "수업" }, { v: "hw", l: "숙제" }] as const;

function MaterialDetail({ material, assigns, roster, nameOf, canEdit, onChanged }: {
  material: Material; assigns: MaterialAssign[]; roster: RosterStudent[]; nameOf: Record<string, string>;
  canEdit: boolean; onChanged: () => void;
}) {
  const [kind, setKind] = useState<"lesson" | "hw">("lesson");
  const [date, setDate] = useState(todayStr());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  // 배부 대상 후보 — 자료 과목에 맞는 학생(공통이면 전체).
  const cand = useMemo(() => {
    const subj = material.subject;
    let list = roster.filter((s) => !s.status || s.status === "재원");
    if (subj === "math") list = list.filter((s) => s.subjects.includes("math"));
    else if (subj === "english") list = list.filter((s) => s.subjects.includes("english"));
    const qq = q.trim().toLowerCase();
    if (qq) list = list.filter((s) => (s.name + " " + (s.school || "")).toLowerCase().includes(qq));
    return list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [roster, material.subject, q]);

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
  async function toggleDone(a: MaterialAssign) { await materialsApi.setDone(a.id, !a.done); onChanged(); }
  async function unassign(a: MaterialAssign) { await materialsApi.unassign(a.id); onChanged(); }

  const lessonRows = assigns.filter((a) => a.kind === "lesson");
  const hwRows = assigns.filter((a) => a.kind === "hw");

  return (
    <div className="mat-detail">
      <div className="mat-detail-h">
        <h2>{material.name}</h2>
        <span className={"mat-subj mat-subj-" + (material.subject || "all")}>{subjLabel(material.subject)}</span>
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
        <AssignList title="수업으로 배부" rows={lessonRows} nameOf={nameOf} canEdit={canEdit} onDone={toggleDone} onRemove={unassign} />
        <AssignList title="숙제로 배부" rows={hwRows} nameOf={nameOf} canEdit={canEdit} onDone={toggleDone} onRemove={unassign} />
      </div>
    </div>
  );
}

function AssignList({ title, rows, nameOf, canEdit, onDone, onRemove }: {
  title: string; rows: MaterialAssign[]; nameOf: Record<string, string>; canEdit: boolean;
  onDone: (a: MaterialAssign) => void; onRemove: (a: MaterialAssign) => void;
}) {
  const doneN = rows.filter((r) => r.done).length;
  return (
    <div className="mat-alist">
      <div className="mat-alist-h">{title} <span className="mat-group-c">{rows.length}</span>{rows.length > 0 && <span className="mat-alist-done">완료 {doneN}/{rows.length}</span>}</div>
      {rows.length === 0 ? (
        <div className="eng-side-empty">아직 없어요.</div>
      ) : rows.map((a) => (
        <div className={"mat-arow" + (a.done ? " done" : "")} key={a.id}>
          <label className="mat-arow-main">
            <input type="checkbox" checked={a.done} disabled={!canEdit} onChange={() => onDone(a)} />
            <span className="mat-arow-name">{nameOf[a.studentId] || "(삭제된 학생)"}</span>
            {a.date && <span className="mat-arow-date">{a.date.slice(5)}</span>}
          </label>
          {canEdit && <button className="btn ghost xs" onClick={() => onRemove(a)} aria-label="배부 취소">✕</button>}
        </div>
      ))}
    </div>
  );
}
