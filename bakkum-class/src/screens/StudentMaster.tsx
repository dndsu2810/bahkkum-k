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
} from "../lib/rosterApi";

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
const subjLabel = (s: RosterStudent) =>
  [s.subjects.includes("math") ? "수학" : "", s.subjects.includes("english") ? "영어" : ""].filter(Boolean).join("·") || "—";

/** 공통 학생 명단 — 수학·영어 공유. 목록은 핵심만, 학생을 누르면 이력서형 프로필에서 깊게 수정.
 *  원장은 편집, 나머지(데스크·영어)는 조회. */
export function StudentMaster() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const [rows, setRows] = useState<RosterStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [syncing, setSyncing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

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
      if (kw && !r.name.includes(kw) && !(r.school || "").includes(kw) && !(r.onlineId || "").includes(kw)) return false;
      if (filter === "math") return r.subjects.includes("math");
      if (filter === "english") return r.subjects.includes("english");
      if (filter === "elem") return r.subjects.includes("english") && r.englishBand === "elem";
      if (filter === "mid") return r.subjects.includes("english") && r.englishBand === "mid";
      return true;
    });
  }, [rows, q, filter]);

  const openStudent = rows.find((r) => r.id === openId) || null;

  // 모달 저장 후 로컬 행을 갱신해 목록·다음 열람에 바로 반영.
  function applyLocal(next: RosterStudent) {
    setRows((cur) => cur.map((r) => (r.id === next.id ? next : r)));
  }

  return (
    <div className="sm-wrap">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">학생 명단</h1>
          <p className="sm-desc">
            수학·영어 공통 명단입니다. 학생을 누르면 {canEdit ? "프로필에서 자세히 보고 수정할 수 있어요." : "프로필을 볼 수 있어요."}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {canEdit && (
            <button className="btn ghost" onClick={syncNotion} disabled={syncing}>
              {syncing ? "동기화 중…" : "노션 동기화"}
            </button>
          )}
          <div className="sm-count">{list.length}명</div>
        </div>
      </div>

      <div className="sm-toolbar">
        <input
          className="input sm-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름·학교·온라인ID 검색"
        />
        <div className="sm-filters">
          {FILTERS.map((f) => (
            <button key={f.key} className={"sm-fchip" + (filter === f.key ? " on" : "")} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

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
                  <td className="sm-dim">{r.attendDays.length ? r.attendDays.join("·") : "—"}</td>
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
      const next = c.attendDays.includes(d) ? c.attendDays.filter((x) => x !== d) : [...c.attendDays, d];
      return { ...c, attendDays: DOW.filter((x) => next.includes(x)) }; // 요일 순서 유지
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
        attendDays: f.attendDays,
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
            <Field label="학년"><Txt ro={ro} value={f.grade} onChange={(v) => set("grade", v)} placeholder="예: 초5 / 중2" /></Field>
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
                  <button key={d} className={"prof-day" + (f.attendDays.includes(d) ? " on" : "")} disabled={ro} onClick={() => toggleDay(d)}>{d}</button>
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
