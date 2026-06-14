import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import {
  type EnglishBand,
  type RosterStudent,
  type Slot,
  type Subject,
  getRoster,
  saveStudentCore,
  saveStudentMeta,
  saveStudentSlots,
  syncRosterFromNotion,
  fillGrades,
  promoteGrades,
  bulkGrades,
  type PromoteBefore,
} from "../lib/rosterApi";
import { GRADE_DIVS, DIV_MAX, makeGrade, parseGrade } from "../lib/grade";

type FilterKey = "all" | "math" | "english" | "elem" | "mid";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "elem", label: "초등영어" },
  { key: "mid", label: "중고등영어" },
];

const BAND_LABEL: Record<Exclude<EnglishBand, "">, string> = { elem: "초등", mid: "중고등" };
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const STATUSES = ["재원", "휴원", "퇴원", "상담"];

const initials = (name: string) => (name || "?").trim().slice(0, 2);
// 등원요일: 지정값이 있으면 그것, 없으면 수업시간(요일)에서 자동 반영.
const effAttendDays = (r: RosterStudent) =>
  r.attendDays.length ? r.attendDays : DOW.filter((dd) => r.mathSlots.some((s) => s.day === dd) || r.engSlots.some((s) => s.day === dd));
const subjLabel = (s: RosterStudent) =>
  [s.subjects.includes("math") ? "수학" : "", s.subjects.includes("english") ? "영어" : ""].filter(Boolean).join("·") || "—";

/** 공통 학생 명단 — 수학·영어 공유. 목록은 핵심만, 학생을 누르면 이력서형 프로필에서 깊게 수정.
 *  원장은 편집, 나머지(데스크·영어)는 조회. */
export function StudentMaster({ bandLock, jumpTo }: { bandLock?: "elem" | "mid"; jumpTo?: { id: string; n: number } | null } = {}) {
  const { user } = useAuth();
  const canEdit = !!user && user.role !== "student"; // 전 스태프 편집 가능
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState<RosterStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [syncing, setSyncing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [schoolF, setSchoolF] = useState("");
  const [gradeF, setGradeF] = useState("");
  const [gradeBusy, setGradeBusy] = useState(false);
  const [gradeMsg, setGradeMsg] = useState("");
  const [lastPromote, setLastPromote] = useState<PromoteBefore[] | null>(null);

  // 생년월일로 세부학년 1회 자동채움.
  async function doFill() {
    if (gradeBusy) return;
    if (!window.confirm("세부학년이 비어 있는 학생을 생년월일 기준 학년으로 1회 채웁니다. 진행할까요?")) return;
    setGradeBusy(true); setGradeMsg("");
    try { const r = await fillGrades(); await reloadRows(); setGradeMsg(`학년 자동채움 완료 · ${r.filled}명`); }
    catch { setErr("학년 자동채움 실패"); } finally { setGradeBusy(false); }
  }
  // 전체 학년 올리기(+1, 고3→졸업). 직후 되돌리기 가능.
  async function doPromote() {
    if (gradeBusy) return;
    if (!window.confirm("재원 학생 전체 학년을 +1 올립니다(초6→중1, 중3→고1, 고3→졸업). 진행할까요?")) return;
    setGradeBusy(true); setGradeMsg("");
    try {
      const r = await promoteGrades(false);
      await reloadRows();
      setLastPromote(r.before);
      setGradeMsg(`${r.promoted}명 승급 · 고3 ${r.graduated}명 졸업 처리. 잘못됐으면 ‘되돌리기’.`);
    } catch { setErr("일괄 승급 실패"); } finally { setGradeBusy(false); }
  }
  async function doUndo() {
    if (!lastPromote || gradeBusy) return;
    setGradeBusy(true);
    try { await bulkGrades(lastPromote); await reloadRows(); setLastPromote(null); setGradeMsg("직전 승급을 되돌렸어요."); }
    catch { setErr("되돌리기 실패"); } finally { setGradeBusy(false); }
  }
  // 전역 검색에서 넘어오면 해당 학생 프로필을 바로 연다. (검색·필터는 초기화)
  useEffect(() => {
    if (jumpTo?.id) {
      setOpenId(jumpTo.id);
      setQ("");
      setFilter("all");
    }
  }, [jumpTo?.id, jumpTo?.n]);

  async function reloadRows() {
    try {
      setRows(await getRoster());
    } catch {
      /* ignore */
    }
  }
  async function syncNotion() {
    if (syncing) return;
    if (!window.confirm("노션의 재원 학생을 가져옵니다. 수업(수업 선택)으로 과목·반을 구분하고, 앱에 없는 학생은 추가합니다. 진행할까요?")) return;
    setSyncing(true);
    setErr("");
    try {
      const r = await syncRosterFromNotion(false);
      await reloadRows();
      window.alert(`동기화 완료 · 추가 ${r.willInsert}명 · 수학+영어 ${r.both} · 영어만 ${r.englishOnly}` + (r.noClassCount ? ` · 미배정 ${r.noClassCount} 건너뜀` : ""));
    } catch (e) {
      setErr("동기화 실패: " + String((e as Error).message));
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    let alive = true;
    getRoster()
      .then((r) => {
        if (!alive) return;
        setRows(r);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(String((e as Error).message) === "no_backend" ? "배포 환경에서만 동작합니다." : "명단을 불러오지 못했어요.");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const list = useMemo(() => {
    const kw = q.trim();
    return rows.filter((r) => {
      if (bandLock) {
        if (!(r.subjects.includes("english") && r.englishBand === bandLock)) return false;
      }
      if (kw && !r.name.includes(kw) && !(r.school || "").includes(kw) && !(r.onlineId || "").includes(kw)) return false;
      if (bandLock) return true;
      // 겹쳐 보기 — 과목/구분 + 학교 + 학년 동시 적용.
      if (schoolF && (r.school || "") !== schoolF) return false;
      if (gradeF && (r.grade || "") !== gradeF) return false;
      if (filter === "math" && !r.subjects.includes("math")) return false;
      if (filter === "english" && !r.subjects.includes("english")) return false;
      if (filter === "elem" && !(r.subjects.includes("english") && r.englishBand === "elem")) return false;
      if (filter === "mid" && !(r.subjects.includes("english") && r.englishBand === "mid")) return false;
      return true;
    });
  }, [rows, q, filter, bandLock, schoolF, gradeF]);

  // 필터 옵션 — 실제 데이터에서 학교 목록, 학년은 초1~고3.
  const schools = useMemo(() => [...new Set(rows.map((r) => r.school).filter(Boolean))].sort(), [rows]);
  const gradeOpts = useMemo(() => GRADE_DIVS.flatMap((d) => Array.from({ length: d.max }, (_, i) => d.key + (i + 1))), []);

  const openStudent = rows.find((r) => r.id === openId) || null;

  // 모달 저장 후 로컬 행을 갱신해 목록·다음 열람에 바로 반영.
  function applyLocal(next: RosterStudent) {
    setRows((cur) => cur.map((r) => (r.id === next.id ? next : r)));
  }

  return (
    <div className="sm-wrap">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">{bandLock ? `${bandLock === "elem" ? "초등" : "중고등"} 영어 학생 관리` : "학생 명단"}</h1>
          <p className="sm-desc">
            {bandLock ? "이 반 영어 학생 명단입니다. " : "수학·영어 공통 명단입니다. "}
            학생을 누르면 {canEdit ? "프로필에서 자세히 보고 수정할 수 있어요." : "프로필을 볼 수 있어요."}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {isAdmin && !bandLock && (
            <>
              <button className="btn ghost" onClick={doFill} disabled={gradeBusy}>학년 채우기</button>
              <button className="btn ghost" onClick={doPromote} disabled={gradeBusy}>전체 학년 올리기</button>
              {lastPromote && <button className="btn ghost" onClick={doUndo} disabled={gradeBusy}>되돌리기</button>}
            </>
          )}
          {isAdmin && (
            <button className="btn ghost" onClick={syncNotion} disabled={syncing}>
              {syncing ? "동기화 중…" : "노션 동기화"}
            </button>
          )}
          <div className="sm-count">{list.length}명</div>
        </div>
      </div>
      {gradeMsg && <div className="hub-muted" style={{ marginBottom: 8 }}>{gradeMsg}</div>}

      <div className="sm-toolbar">
        <input
          className="input sm-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름·학교·온라인ID 검색"
        />
        {!bandLock && (
          <div className="sm-filters">
            {FILTERS.map((f) => (
              <button key={f.key} className={"sm-fchip" + (filter === f.key ? " on" : "")} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
            <select className="sm-input" style={{ maxWidth: 130 }} value={schoolF} onChange={(e) => setSchoolF(e.target.value)}>
              <option value="">학교 전체</option>
              {schools.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="sm-input" style={{ maxWidth: 100 }} value={gradeF} onChange={(e) => setGradeF(e.target.value)}>
              <option value="">학년 전체</option>
              {gradeOpts.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            {(schoolF || gradeF) && <button className="sm-fchip" onClick={() => { setSchoolF(""); setGradeF(""); }}>필터 해제</button>}
          </div>
        )}
      </div>
      {!bandLock && (schoolF || gradeF || filter !== "all") && (
        <div className="hub-muted" style={{ marginBottom: 8 }}>
          {[schoolF, gradeF, filter !== "all" ? FILTERS.find((f) => f.key === filter)?.label : ""].filter(Boolean).join(" · ")} · <b>{list.length}명</b>
        </div>
      )}

      {err && <div className="auth-err" style={{ marginBottom: 12 }}>{err}</div>}

      {loading ? (
        <div className="hub-muted">불러오는 중…</div>
      ) : list.length === 0 ? (
        <div className="hub-muted">조건에 맞는 학생이 없어요.</div>
      ) : (
        <div className="sm-table-wrap">
          <table className="sm-table sm-table-click">
            <thead>
              <tr>
                <th>이름</th>
                <th>학년</th>
                <th>상태</th>
                <th>학교</th>
                <th>수강과목</th>
                <th>영어반</th>
                <th>등원요일</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") setOpenId(r.id); }}>
                  <td className="sm-name">
                    <span className="sm-row-av">{initials(r.name)}</span>
                    {r.name}
                  </td>
                  <td>{r.grade || "—"}</td>
                  <td><span className={"sm-st sm-st-" + (r.status === "재원" ? "on" : "off")}>{r.status || "—"}</span></td>
                  <td className="sm-dim">{r.school || "—"}</td>
                  <td className="sm-dim">{subjLabel(r)}</td>
                  <td className="sm-dim">{r.subjects.includes("english") && r.englishBand ? BAND_LABEL[r.englishBand] : "—"}</td>
                  <td className="sm-dim">{effAttendDays(r).length ? effAttendDays(r).join("·") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openStudent && (
        <ProfileModal
          key={openStudent.id}
          student={openStudent}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onSaved={applyLocal}
        />
      )}
    </div>
  );
}

/* ---------------- 이력서형 프로필 모달 ---------------- */
function ProfileModal({
  student,
  canEdit,
  onClose,
  onSaved,
}: {
  student: RosterStudent;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (s: RosterStudent) => void;
}) {
  const [f, setF] = useState<RosterStudent>(student);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const hasEng = f.subjects.includes("english");
  // 등원요일 = 수동 지정값이 있으면 그것, 없으면 수업시간(요일)에서 자동 반영.
  const slotDays = DOW.filter((dd) => f.mathSlots.some((s) => s.day === dd) || f.engSlots.some((s) => s.day === dd));
  const effectiveDays = f.attendDays.length ? f.attendDays : slotDays;

  const set = <K extends keyof RosterStudent>(k: K, v: RosterStudent[K]) => setF((c) => ({ ...c, [k]: v }));
  function toggleSubject(s: Subject) {
    setF((c) => {
      const has = c.subjects.includes(s);
      const subjects = has ? c.subjects.filter((x) => x !== s) : [...c.subjects, s];
      let englishBand = c.englishBand;
      if (s === "english") englishBand = has ? "" : englishBand || (c.grade === "초등" ? "elem" : "mid");
      return { ...c, subjects, englishBand };
    });
  }
  function toggleDay(d: string) {
    setF((c) => {
      // 처음 토글하면 자동 반영된 요일(수업시간 기준)에서 시작.
      const base = c.attendDays.length ? c.attendDays : DOW.filter((dd) => c.mathSlots.some((s) => s.day === dd) || c.engSlots.some((s) => s.day === dd));
      const next = base.includes(d) ? base.filter((x) => x !== d) : [...base, d];
      return { ...c, attendDays: DOW.filter((x) => next.includes(x)) };
    });
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await saveStudentMeta({
        studentId: f.id,
        onlineId: f.onlineId,
        subjects: f.subjects,
        englishBand: f.englishBand,
        attendDays: effectiveDays,
        memo: f.memo,
      });
      await saveStudentCore({
        studentId: f.id,
        grade: f.grade,
        status: f.status,
        school: f.school,
        birthdate: f.birthdate,
        parentPhone: f.parentPhone,
        studentPhone: f.studentPhone,
        startDate: f.startDate,
      });
      await saveStudentSlots({
        studentId: f.id,
        math: f.subjects.includes("math") ? f.mathSlots : [],
        english: f.subjects.includes("english") ? f.engSlots : [],
      });
      onSaved(f);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch {
      setErr("저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const ro = !canEdit;
  return (
    <div className="prof-overlay" onClick={onClose}>
      <div className="prof" onClick={(e) => e.stopPropagation()}>
        <div className="prof-top">
          <div className="av av-lg prof-av">{initials(f.name)}</div>
          <div className="prof-top-main">
            <div className="prof-name">{f.name}</div>
            <div className="prof-badges">
              {f.grade && <span className="prof-badge">{f.grade}</span>}
              {f.school && <span className="prof-badge">{f.school}</span>}
              <span className={"prof-badge " + (f.status === "재원" ? "ok" : "off")}>{f.status || "—"}</span>
              <span className="prof-badge brand">{subjLabel(f)}</span>
            </div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <div className="prof-body">
          <Section title="기본 정보">
            <Field label="학년">
              {ro ? <span className="prof-val">{f.grade || "—"}</span> : <GradeSelect value={f.grade} onChange={(v) => set("grade", v)} />}
            </Field>
            <Field label="상태">
              {ro ? <span className="prof-val">{f.status || "—"}</span> : (
                <select className="inline-select" value={f.status || "재원"} onChange={(e) => set("status", e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </Field>
            <Field label="생년월일"><Txt ro={ro} value={f.birthdate} onChange={(v) => set("birthdate", v)} placeholder="YYYY-MM-DD" /></Field>
            <Field label="학교"><Txt ro={ro} value={f.school} onChange={(v) => set("school", v)} placeholder="학교명" /></Field>
          </Section>

          <Section title="연락처">
            <Field label="학부모 연락처"><Txt ro={ro} value={f.parentPhone} onChange={(v) => set("parentPhone", v)} placeholder="010-" /></Field>
            <Field label="학생 연락처"><Txt ro={ro} value={f.studentPhone} onChange={(v) => set("studentPhone", v)} placeholder="010-" /></Field>
          </Section>

          <Section title="수강 · 스케줄">
            <Field label="수강과목">
              <div className="sm-subj">
                <button className={"sm-subj-chip" + (f.subjects.includes("math") ? " on" : "")} disabled={ro} onClick={() => toggleSubject("math")}>수학</button>
                <button className={"sm-subj-chip" + (hasEng ? " on eng" : "")} disabled={ro} onClick={() => toggleSubject("english")}>영어</button>
              </div>
            </Field>
            {hasEng && (
              <Field label="영어반">
                {ro ? <span className="prof-val">{f.englishBand ? BAND_LABEL[f.englishBand] : "—"}</span> : (
                  <select className="inline-select" value={f.englishBand || ""} onChange={(e) => set("englishBand", e.target.value as EnglishBand)}>
                    <option value="elem">초등</option>
                    <option value="mid">중고등</option>
                  </select>
                )}
              </Field>
            )}
            <Field label="등원요일">
              <div className="prof-days">
                {DOW.map((d) => (
                  <button key={d} className={"prof-day" + (effectiveDays.includes(d) ? " on" : "")} disabled={ro} onClick={() => toggleDay(d)}>{d}</button>
                ))}
              </div>
            </Field>
            <Field label="온라인ID"><Txt ro={ro} value={f.onlineId} onChange={(v) => set("onlineId", v)} placeholder="—" /></Field>
            <Field label="등록일"><Txt ro={ro} value={f.startDate} onChange={(v) => set("startDate", v)} placeholder="YYYY-MM-DD" /></Field>
            {f.subjects.includes("math") && (
              <div className="prof-slot-block">
                <span className="prof-field-l">수학 수업시간 <span className="prof-slot-tag math">시간표 반영</span></span>
                <SlotEditor ro={ro} slots={f.mathSlots} onChange={(s) => set("mathSlots", s)} />
              </div>
            )}
            {hasEng && (
              <div className="prof-slot-block">
                <span className="prof-field-l">영어 수업시간 <span className="prof-slot-tag eng">시간표 반영</span></span>
                <SlotEditor ro={ro} slots={f.engSlots} onChange={(s) => set("engSlots", s)} />
              </div>
            )}
          </Section>

          <Section title="메모 · 특이사항">
            {ro ? (
              <p className="prof-memo-ro">{f.memo || "—"}</p>
            ) : (
              <textarea className="input prof-memo" rows={4} value={f.memo} onChange={(e) => set("memo", e.target.value)} placeholder="누적 메모(상담·특이사항 등)" />
            )}
          </Section>
        </div>

        {err && <div className="auth-err" style={{ margin: "0 var(--s5)" }}>{err}</div>}
        <div className="prof-foot">
          {canEdit ? (
            <>
              <span className={"prof-saved" + (done ? " on" : "")}>저장됨</span>
              <button className="btn ghost" onClick={onClose}>닫기</button>
              <button className="btn primary" onClick={save} disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
            </>
          ) : (
            <button className="btn ghost" onClick={onClose}>닫기</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="prof-sec">
      <h4 className="prof-sec-t">{title}</h4>
      <div className="prof-grid">{children}</div>
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="prof-field">
      <span className="prof-field-l">{label}</span>
      {children}
    </label>
  );
}
function Txt({ ro, value, onChange, placeholder }: { ro: boolean; value: string; onChange: (v: string) => void; placeholder?: string }) {
  if (ro) return <span className="prof-val">{value || "—"}</span>;
  return <input className="inline-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

/** 학년 = 구분(초/중/고) + 세부학년(N) 선택 → "초6" 형태로 저장. */
function GradeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const p = parseGrade(value);
  const div = p?.div || "";
  const n = p?.n || 0;
  const max = DIV_MAX[div] || 0;
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <select className="inline-select" style={{ maxWidth: 90 }} value={div} onChange={(e) => onChange(makeGrade(e.target.value, 0))}>
        <option value="">구분</option>
        {GRADE_DIVS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
      </select>
      <select className="inline-select" style={{ maxWidth: 90 }} value={n || ""} disabled={!div} onChange={(e) => onChange(makeGrade(div, Number(e.target.value)))}>
        <option value="">학년</option>
        {Array.from({ length: max }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}학년</option>)}
      </select>
    </div>
  );
}

/** 과목별 수업 슬롯 편집 — 요일·시작시간·수업시간(분). 수학 슬롯은 시간표·수학 학생관리와 공유. */
function SlotEditor({ ro, slots, onChange }: { ro: boolean; slots: Slot[]; onChange: (s: Slot[]) => void }) {
  const update = (i: number, patch: Partial<Slot>) => onChange(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = () => onChange([...slots, { day: "월", time: "16:00", duration: 70 }]);
  const remove = (i: number) => onChange(slots.filter((_, j) => j !== i));
  if (ro) {
    return (
      <div className="prof-slot-ro">
        {slots.length ? slots.map((s, i) => <span key={i} className="prof-slot-chip">{s.day} {s.time}~{s.duration}분</span>) : <span className="prof-val">—</span>}
      </div>
    );
  }
  return (
    <div className="prof-slots">
      {slots.map((s, i) => (
        <div className="slot" key={i}>
          <select value={s.day} onChange={(e) => update(i, { day: e.target.value })}>
            {DOW.map((d) => <option key={d}>{d}</option>)}
          </select>
          <input type="time" value={s.time} onChange={(e) => update(i, { time: e.target.value })} />
          <input type="number" min={10} step={10} value={s.duration} onChange={(e) => update(i, { duration: Number(e.target.value) || 0 })} title="수업시간(분)" />
          <button type="button" className="slot-x" onClick={() => remove(i)} aria-label="삭제">✕</button>
        </div>
      ))}
      <button type="button" className="add-slot" onClick={add}>+ 수업시간 추가</button>
    </div>
  );
}
