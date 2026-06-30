import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { checkinApi, type CheckinRow } from "../lib/checkinApi";
import {
  type EnglishBand,
  type MathClass,
  type RosterStudent,
  type Slot,
  type Subject,
  inEngBand,
  getRoster,
  invalidateRoster,
  saveStudentCore,
  saveStudentMeta,
  saveStudentSlots,
  fillGrades,
  promoteGrades,
  bulkGrades,
  type PromoteBefore,
} from "../lib/rosterApi";
import { createStudent } from "../api";
import type { StudentStatus } from "../types";
import { todayStr } from "../lib/dates";
import { GRADE_DIVS, DIV_MAX, makeGrade, parseGrade, mathBandOf } from "../lib/grade";
import { uploadImage } from "../lib/configApi";
import { notesApi, type NoteItem } from "../lib/hubApi";
import { meetingApi, type MeetingListItem, type MeetingDetail } from "../lib/meetingApi";
import { StudentPage } from "./StudentPage";
import { SkeletonList } from "../components/Skeleton";
import { HexAvatar } from "../soez";
import { Icon } from "../icons";

/** 신규 등록용 빈 학생 — 모든 필드 기본값. 등록일만 오늘로. */
function blankStudent(): RosterStudent {
  return { id: "", name: "", grade: "", status: "재원", school: "", birthdate: "", parentPhone: "", studentPhone: "", startDate: todayStr(), onlineId: "", subjects: [], englishBand: "", mathClass: "", attendDays: [], memo: "", photo: "", checkinNo: "", mathStart: "", engStart: "", mathSlots: [], engSlots: [] };
}

type FilterKey = "all" | "math" | "english" | "elem" | "mid";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "elem", label: "초등영어" },
  { key: "mid", label: "중고등영어" },
];

const BAND_LABEL: Record<Exclude<EnglishBand, "">, string> = { elem: "초등", mid: "중고등", bridge: "Bridge" };
const MATH_BAND_LABEL: Record<"low" | "high" | "mid", string> = { low: "초등 저학년", high: "초등 고학년", mid: "중고등" };
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const STATUSES = ["재원", "휴원", "퇴원", "상담"];
type StatusKey = "all" | "재원" | "휴원" | "퇴원";
const STATUS_FILTERS: { key: StatusKey; label: string }[] = [
  { key: "all", label: "전체 상태" },
  { key: "재원", label: "재원" },
  { key: "휴원", label: "휴원" },
  { key: "퇴원", label: "퇴원" },
];

// 등원요일 = 수업시간(요일) + 수동으로 추가한 요일의 합집합. 수업을 추가하면 그 요일이 자동으로 포함된다.
const effAttendDays = (r: RosterStudent) =>
  DOW.filter((dd) => r.mathSlots.some((s) => s.day === dd) || r.engSlots.some((s) => s.day === dd) || r.attendDays.includes(dd));
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
  const [statusF, setStatusF] = useState<StatusKey>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false); // 신규 학생 등록 모달
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
  useEffect(() => {
    let alive = true;
    getRoster()
      .then((r) => {
        if (!alive) return;
        setRows(r);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setErr("명단을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
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
        if (!(r.subjects.includes("english") && inEngBand(r.englishBand, bandLock))) return false;
      }
      if (kw && !r.name.includes(kw) && !(r.school || "").includes(kw) && !(r.onlineId || "").includes(kw)) return false;
      if (bandLock) return true;
      // 겹쳐 보기 — 상태 + 과목/구분 + 학교 + 학년 동시 적용.
      if (statusF !== "all" && (r.status || "") !== statusF) return false;
      if (schoolF && (r.school || "") !== schoolF) return false;
      if (gradeF && (r.grade || "") !== gradeF) return false;
      if (filter === "math" && !r.subjects.includes("math")) return false;
      if (filter === "english" && !r.subjects.includes("english")) return false;
      if (filter === "elem" && !(r.subjects.includes("english") && r.englishBand === "elem")) return false;
      if (filter === "mid" && !(r.subjects.includes("english") && inEngBand(r.englishBand, "mid"))) return false;
      return true;
    });
  }, [rows, q, filter, statusF, bandLock, schoolF, gradeF]);

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
          {canEdit && !bandLock && (
            <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" /> 학생 추가</button>
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
            {STATUS_FILTERS.map((f) => (
              <button key={f.key} className={"sm-fchip" + (statusF === f.key ? " on" : "")} onClick={() => setStatusF(f.key)}>
                {f.label}
              </button>
            ))}
            <span className="sm-fdiv" />
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
      {!bandLock && (schoolF || gradeF || filter !== "all" || statusF !== "all") && (
        <div className="hub-muted" style={{ marginBottom: 8 }}>
          {[statusF !== "all" ? statusF : "", schoolF, gradeF, filter !== "all" ? FILTERS.find((f) => f.key === filter)?.label : ""].filter(Boolean).join(" · ")} · <b>{list.length}명</b>
        </div>
      )}

      {err && <div className="auth-err" style={{ marginBottom: 12 }}>{err}</div>}

      {loading ? (
        <SkeletonList rows={8} />
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
                    <HexAvatar name={r.name} photo={r.photo} size={34} className="sm-row-av-hex" />
                    {r.name}
                  </td>
                  <td>{r.grade || "—"}</td>
                  <td><span className={"sm-st sm-st-" + (r.status === "재원" ? "on" : "off")}>{r.status || "—"}</span></td>
                  <td className="sm-dim">{r.school || "—"}</td>
                  <td className="sm-dim">{subjLabel(r)}</td>
                  <td className="sm-dim">{r.subjects.includes("english") && r.englishBand ? BAND_LABEL[r.englishBand] : "—"}</td>
                  <td className="sm-dim">
                    {effAttendDays(r).length ? effAttendDays(r).join("·") : "—"}
                    {(() => { const u = r.mathUpcoming || r.engUpcoming; return u ? <span className="badge b-orange sm-sched-soon" title={`${u}부터 새 시간표로 바뀌어요(지금은 현재 시간표)`}>{Number(u.slice(5, 7))}/{Number(u.slice(8, 10))} 변경 예정</span> : null; })()}
                  </td>
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

      {adding && (
        <ProfileModal
          key="new-student"
          student={blankStudent()}
          canEdit={canEdit}
          isNew
          onClose={() => setAdding(false)}
          onSaved={(s) => setRows((cur) => (cur.some((r) => r.id === s.id) ? cur.map((r) => (r.id === s.id ? s : r)) : [...cur, s]))}
        />
      )}
    </div>
  );
}

/* ---------------- 이력서형 프로필 모달 ---------------- */
export function ProfileModal({
  student,
  canEdit,
  onClose,
  onSaved,
  isNew = false,
}: {
  student: RosterStudent;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (s: RosterStudent) => void;
  isNew?: boolean; // 신규 등록 — 저장할 때 학생을 새로 만들고, 동명이인 검사를 강제
}) {
  const [f, setF] = useState<RosterStudent>(student);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [showPage, setShowPage] = useState(false);
  const [mathEffFrom, setMathEffFrom] = useState(todayStr()); // 수학 시간표 적용 시작일
  const [engEffFrom, setEngEffFrom] = useState(todayStr()); // 영어 시간표 적용 시작일
  const hasEng = f.subjects.includes("english");

  // 동명이인 검사 — 재원생 중 같은 이름(본인 제외). 생년월일까지 같으면 동일인으로 보고 등록을 막는다.
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  useEffect(() => { getRoster().then(setRoster).catch(() => {}); }, []);
  const nameTrim = f.name.trim();
  const sameName = nameTrim
    ? roster.filter((r) => r.id !== f.id && (r.status || "재원") === "재원" && r.name.trim() === nameTrim)
    : [];
  // 생년월일이 둘 다 있고 같은 학생이 있으면 같은 사람 → 등록 불가.
  const sameNameAndBirth = sameName.filter((r) => f.birthdate && r.birthdate && r.birthdate === f.birthdate);

  // 프로필 사진 업로드(선택) — 올리면 즉시 저장.
  async function onPhoto(file?: File | null) {
    if (!file || photoBusy) return;
    setPhotoBusy(true);
    try {
      const url = await uploadImage(file);
      setF((cur) => ({ ...cur, photo: url }));
      await saveStudentMeta({ studentId: f.id, onlineId: f.onlineId, subjects: f.subjects, englishBand: f.englishBand, attendDays: f.attendDays, memo: f.memo, photo: url, checkinNo: f.checkinNo, mathStart: f.mathStart, engStart: f.engStart, mathClass: f.mathClass });
    } catch { setErr("사진 업로드에 실패했어요."); } finally { setPhotoBusy(false); }
  }
  // 등원요일 = 수업시간(요일) + 수동 추가 요일의 합집합. 수업을 추가하면 그 요일이 자동 포함된다.
  const slotDays = DOW.filter((dd) => f.mathSlots.some((s) => s.day === dd) || f.engSlots.some((s) => s.day === dd));
  const effectiveDays = DOW.filter((dd) => slotDays.includes(dd) || f.attendDays.includes(dd));

  // 시간표 변경 안내 — 슬롯을 바꿨을 때만, '예정(미래 적용일)'인지 '바로 적용'인지 + 지금→바뀜 내용을 보여줘요.
  const dowIdx = (d: string) => { const i = DOW.indexOf(d); return i < 0 ? 99 : i; };
  const slotLine = (arr: Slot[]) => (arr && arr.length ? [...arr].sort((a, b) => dowIdx(a.day) - dowIdx(b.day) || a.time.localeCompare(b.time)).map((s) => `${s.day} ${s.time}~${s.duration}분`).join(" · ") : "수업 없음");
  const fmtD = (s: string) => { const p = s.split("-"); return p.length === 3 ? `${Number(p[1])}월 ${Number(p[2])}일` : s; };
  const schedNotice = (orig: Slot[], next: Slot[], effFrom: string) => {
    if (slotLine(orig) === slotLine(next)) return null; // 시간표가 안 바뀌었으면 안내 없음
    const future = effFrom > todayStr();
    return (
      <div className={"sched-notice " + (future ? "is-future" : "is-now")}>
        <div className="sched-notice-h">{future ? `시간표 변경 예정 · ${fmtD(effFrom)}부터 적용` : "저장하면 바로 적용돼요"}</div>
        <div className="sched-notice-diff">
          <span className="snd-row"><em>지금</em>{slotLine(orig)}</span>
          <span className="snd-row snd-new"><em>{future ? `${fmtD(effFrom)}부터` : "변경"}</em>{slotLine(next)}</span>
        </div>
        {future && <div className="sched-notice-hint">그 전까지는 지금 시간표가 그대로 보여요.</div>}
      </div>
    );
  };

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
      // 현재 보이는 등원요일(수업시간 + 수동 추가)에서 토글.
      const slotDaysC = DOW.filter((dd) => c.mathSlots.some((s) => s.day === dd) || c.engSlots.some((s) => s.day === dd));
      const cur = new Set<string>([...slotDaysC, ...c.attendDays]);
      if (cur.has(d)) cur.delete(d); else cur.add(d);
      return { ...c, attendDays: DOW.filter((x) => cur.has(x)) };
    });
  }

  async function save() {
    if (busy) return;
    if (!nameTrim) { setErr("이름을 입력해 주세요."); return; }
    // 신규 등록 시: 동명이인 + 생년월일 동일 → 같은 사람이라 새로 등록할 수 없음(이름을 바꾸거나 생년월일 확인).
    if (isNew && sameNameAndBirth.length) { setErr("같은 이름·생년월일의 재원 학생이 이미 있어요. 이름을 바꾸거나 생년월일을 확인해 주세요."); return; }
    // 중복 등록 방지 — 한 학생이 같은 요일·시간에 수학·영어 둘 다 등록되면 막는다.
    if (f.subjects.includes("math") && f.subjects.includes("english")) {
      const clash = f.mathSlots.find((m) => f.engSlots.some((e) => e.day === m.day && e.time === m.time));
      if (clash) { setErr(`${clash.day} ${clash.time}에 수학·영어 수업이 겹쳐요. 한 학생은 같은 시간에 한 과목만 등록할 수 있어요.`); return; }
    }
    // 데이터 보호: 과목을 끄면 그 과목 시간표가 사라진다. 기존 시간표가 있으면 삭제 전에 한 번 더 확인.
    //  - 확인하면 clearX=true로 보내 백엔드가 삭제, 취소하면 저장 자체를 멈춘다(아무것도 안 바뀜).
    const mathOn = f.subjects.includes("math");
    const engOn = f.subjects.includes("english");
    let clearMath = false;
    let clearEnglish = false;
    if (!isNew) {
      const hadMath = (student.mathSlots?.length || 0) > 0;
      const hadEng = (student.engSlots?.length || 0) > 0;
      if (!mathOn && hadMath) {
        if (!window.confirm(`${nameTrim} 학생의 ‘수학’을 끄면 수학 시간표가 삭제돼요.\n수학 수업관리와 공유되는 데이터라 되돌릴 수 없어요.\n\n그래도 삭제할까요?`)) return;
        clearMath = true;
      }
      if (!engOn && hadEng) {
        if (!window.confirm(`${nameTrim} 학생의 ‘영어’를 끄면 영어 시간표가 삭제돼요.\n되돌릴 수 없어요.\n\n그래도 삭제할까요?`)) return;
        clearEnglish = true;
      }
    }
    setBusy(true);
    setErr("");
    try {
      // 신규: 먼저 학생을 만들어 id를 받아온다(공통 명단 students 테이블이 id 발급).
      let sid = f.id;
      if (isNew || !sid) {
        const { id: newId } = await createStudent({ name: nameTrim, grade: f.grade, status: (f.status || "재원") as StudentStatus, startDate: f.startDate, school: f.school, birthdate: f.birthdate, parentPhone: f.parentPhone, studentPhone: f.studentPhone });
        sid = newId;
        setF((c) => ({ ...c, id: newId }));
        invalidateRoster();
      }
      await saveStudentMeta({
        studentId: sid,
        onlineId: f.onlineId,
        subjects: f.subjects,
        englishBand: f.englishBand,
        attendDays: effectiveDays,
        memo: f.memo,
        photo: f.photo,
        checkinNo: f.checkinNo,
        mathStart: f.mathStart,
        engStart: f.engStart,
        mathClass: f.mathClass,
      });
      await saveStudentCore({
        studentId: sid,
        name: nameTrim,
        grade: f.grade,
        status: f.status,
        school: f.school,
        birthdate: f.birthdate,
        parentPhone: f.parentPhone,
        studentPhone: f.studentPhone,
        startDate: f.startDate,
      });
      await saveStudentSlots({
        studentId: sid,
        math: mathOn ? f.mathSlots : [],
        english: engOn ? f.engSlots : [],
        mathEffFrom: !isNew && mathOn ? mathEffFrom : "",
        engEffFrom: !isNew && engOn ? engEffFrom : "",
        mathOn,
        engOn,
        clearMath,
        clearEnglish,
      });
      invalidateRoster();
      onSaved({ ...f, id: sid });
      setDone(true);
      setTimeout(() => setDone(false), 1400);
      if (isNew) { setTimeout(onClose, 600); } // 신규 등록은 저장 후 닫아 목록으로 돌아가기
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
          <div className="prof-av-wrap">
            <HexAvatar name={f.name} photo={f.photo} size={68} className="prof-av-hex" />
            {!ro && (
              <label className="prof-av-edit" title="사진 변경">
                {photoBusy ? "…" : <Icon name="camera" />}
                <input type="file" accept="image/*" style={{ display: "none" }} disabled={photoBusy} onChange={(e) => onPhoto(e.target.files?.[0])} />
              </label>
            )}
          </div>
          <div className="prof-top-main">
            <div className="prof-name">{f.name}</div>
            <div className="prof-badges">
              {f.grade && <span className="prof-badge">{f.grade}</span>}
              {f.school && <span className="prof-badge">{f.school}</span>}
              <span className={"prof-badge " + (f.status === "재원" ? "ok" : "off")}>{f.status || "—"}</span>
              <span className="prof-badge brand">{subjLabel(f)}</span>
            </div>
            {hasEng && (
              <button className="btn ghost sm prof-pagebtn" onClick={() => setShowPage(true)}><Icon name="book" /> 개별 페이지 (시간표·커리큘럼·일지)</button>
            )}
          </div>
          <button className="modal-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        {showPage && (
          <div className="prof-overlay sp-overlay" onClick={() => setShowPage(false)}>
            <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
              <button className="modal-x sp-modal-x" onClick={() => setShowPage(false)} aria-label="닫기">✕</button>
              <StudentPage studentId={f.id} embedded />
            </div>
          </div>
        )}

        <div className="prof-body">
          <Section title="기본 정보">
            <Field label="이름">
              <Txt ro={ro} value={f.name} onChange={(v) => set("name", v)} placeholder="학생 이름" />
              {sameName.length > 0 && (
                <div className={"prof-dup" + (sameNameAndBirth.length ? " block" : "")}>
                  {sameNameAndBirth.length
                    ? (isNew
                      ? "같은 이름·생년월일의 재원 학생이 있어요. 등록할 수 없어요 — 이름을 바꿔 주세요."
                      : "같은 이름·생년월일의 재원 학생이 있어요. 동일인이 아닌지 확인해 주세요.")
                    : `재원생 중 같은 이름(${nameTrim})이 ${sameName.length}명 있어요.${isNew ? " 생년월일이 같으면 등록할 수 없어요." : ""}`}
                </div>
              )}
            </Field>
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
            <Field label="생년월일"><DateTxt ro={ro} value={f.birthdate} onChange={(v) => set("birthdate", v)} /></Field>
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
                    <option value="bridge">Bridge (초등·중고등 수업)</option>
                  </select>
                )}
              </Field>
            )}
            {f.subjects.includes("math") && (
              <Field label="수학 반">
                {ro ? (
                  <span className="prof-val">
                    {f.mathClass ? MATH_BAND_LABEL[f.mathClass] : `자동 · ${MATH_BAND_LABEL[mathBandOf(f.grade)]}`}
                  </span>
                ) : (
                  <select className="inline-select" value={f.mathClass || ""} onChange={(e) => set("mathClass", e.target.value as MathClass)}>
                    <option value="">자동 (학년 기준: {MATH_BAND_LABEL[mathBandOf(f.grade)]})</option>
                    <option value="low">초등 저학년</option>
                    <option value="high">초등 고학년</option>
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
            <Field label="출석번호"><Txt ro={ro} value={f.checkinNo} onChange={(v) => set("checkinNo", v)} placeholder="등하원 키오스크용 번호" /></Field>
            {f.subjects.includes("math") && (
              <Field label="수학 첫 등원일"><DateTxt ro={ro} value={f.mathStart} onChange={(v) => set("mathStart", v)} /></Field>
            )}
            {hasEng && (
              <Field label="영어 첫 등원일"><DateTxt ro={ro} value={f.engStart} onChange={(v) => set("engStart", v)} /></Field>
            )}
            <Field label="등록일"><DateTxt ro={ro} value={f.startDate} onChange={(v) => set("startDate", v)} /></Field>
            {f.subjects.includes("math") && (
              <div className="prof-slot-block">
                <span className="prof-field-l">수학 수업시간 <span className="prof-slot-tag math">시간표 반영</span></span>
                <SlotEditor ro={ro} slots={f.mathSlots} onChange={(s) => set("mathSlots", s)} />
                {!ro && !isNew && (
                  <div className="prof-efffrom">
                    <span className="prof-efffrom-l">시간표 적용 시작일</span>
                    <input type="date" className="inline-select" value={mathEffFrom} onChange={(e) => setMathEffFrom(e.target.value)} />
                    <span className="prof-efffrom-h">이 날짜부터 새 시간표로 보여요. 시간표를 바꿨을 때만 적용되고, 이전 날짜는 기존 시간표가 유지돼요.</span>
                  </div>
                )}
                {!ro && !isNew && schedNotice(student.mathSlots || [], f.mathSlots, mathEffFrom)}
              </div>
            )}
            {hasEng && (
              <div className="prof-slot-block">
                <span className="prof-field-l">영어 수업시간 <span className="prof-slot-tag eng">시간표 반영</span></span>
                <SlotEditor ro={ro} slots={f.engSlots} onChange={(s) => set("engSlots", s)} />
                {!ro && !isNew && (
                  <div className="prof-efffrom">
                    <span className="prof-efffrom-l">시간표 적용 시작일</span>
                    <input type="date" className="inline-select" value={engEffFrom} onChange={(e) => setEngEffFrom(e.target.value)} />
                    <span className="prof-efffrom-h">이 날짜부터 새 시간표로 보여요. 시간표를 바꿨을 때만 적용되고, 이전 날짜는 기존 시간표가 유지돼요.</span>
                  </div>
                )}
                {!ro && !isNew && schedNotice(student.engSlots || [], f.engSlots, engEffFrom)}
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

          {/* 강사 특이사항(누적) — 과목 공통, 강사들이 시간순으로 남긴 기록(class_notes kind=''). */}
          <section className="prof-sec">
            <h4 className="prof-sec-t">강사 특이사항 (누적)</h4>
            <StudentNotes studentId={f.id} canEdit={canEdit} kind="" />
          </section>

          {/* 학부모 상담 기록(누적) — 상담 내용 시간순(class_notes kind='counsel') + 연계된 회의록. */}
          <section className="prof-sec">
            <h4 className="prof-sec-t">학부모 상담 기록 (누적)</h4>
            <StudentNotes studentId={f.id} canEdit={canEdit} kind="counsel" placeholder="상담 기록 추가 (예: 6/25 어머니 통화 — 진도 상담)" emptyText="아직 상담 기록이 없어요." confirmText="이 상담 기록을 삭제할까요?" />
            <StudentMeetings studentId={f.id} />
          </section>

          {/* 등하원 이력(조회용) — 수정·발송 없음. 상담 시 보여주는 용도. */}
          <section className="prof-sec">
            <h4 className="prof-sec-t">등하원 이력 (조회용)</h4>
            <CheckinHistory studentId={f.id} />
          </section>
        </div>

        {err && <div className="auth-err" style={{ margin: "0 var(--s5)" }}>{err}</div>}
        <div className="prof-foot">
          {canEdit ? (
            <>
              <span className={"prof-saved" + (done ? " on" : "")}>저장됨</span>
              <button className="btn ghost" onClick={onClose}>닫기</button>
              <button className="btn primary" onClick={save} disabled={busy || (isNew && sameNameAndBirth.length > 0)}>{busy ? "저장 중…" : isNew ? "등록" : "저장"}</button>
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

/** 누적 강사 특이사항 — 그 학생의 class_notes(과목 공통)를 시간순으로. 추가/삭제 가능(권한자). */
function fmtWhen(ts: number): string {
  const diff = Date.now() - ts;
  const h = Math.floor(diff / 3600000);
  if (diff < 3600000) return "방금";
  if (h < 24) return h + "시간 전";
  const d = Math.floor(h / 24);
  if (d < 7) return d + "일 전";
  const dt = new Date(ts);
  return dt.getFullYear() + ". " + (dt.getMonth() + 1) + ". " + dt.getDate() + ".";
}
function StudentNotes({ studentId, canEdit, kind = "", placeholder = "특이사항 추가 (예: 단어시험 만점, 레벨업 검토)", emptyText = "아직 누적된 특이사항이 없어요.", confirmText = "이 특이사항을 삭제할까요?" }: { studentId: string; canEdit: boolean; kind?: string; placeholder?: string; emptyText?: string; confirmText?: string }) {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => notesApi.list(studentId, kind).then(setNotes).catch(() => {});
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [studentId, kind]);
  async function add() {
    const b = body.trim();
    if (!b || busy) return;
    setBusy(true);
    try { await notesApi.add(studentId, b, kind); setBody(""); await load(); } catch { /* ignore */ } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!window.confirm(confirmText)) return;
    await notesApi.remove(id).catch(() => {});
    void load();
  }
  return (
    <div className="prof-notes">
      {canEdit && (
        <div className="prof-notes-add">
          <input className="inline-input" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={placeholder} />
          <button className="btn primary sm" onClick={add} disabled={!body.trim() || busy}>{busy ? "추가 중…" : "추가"}</button>
        </div>
      )}
      {notes.length === 0 ? (
        <p className="prof-memo-ro" style={{ marginTop: canEdit ? 4 : 0 }}>{emptyText}</p>
      ) : (
        <div className="prof-notes-tl">
          {notes.map((n) => (
            <div className="prof-note" key={n.id}>
              <div className="prof-note-h">
                <strong>{n.authorName || "강사"}</strong>
                <span className="prof-note-when">{fmtWhen(n.createdAt)}</span>
                {canEdit && <button className="prof-note-x" onClick={() => remove(n.id)} aria-label="삭제">✕</button>}
              </div>
              <p className="prof-note-b">{n.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* 연계된 회의록 — 이 학생에 연결된 회의록(학부모 상담 등)을 보여주고, 펼치면 요약을 읽어요. */
function StudentMeetings({ studentId }: { studentId: string }) {
  const [list, setList] = useState<MeetingListItem[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  useEffect(() => { meetingApi.byStudent(studentId).then(setList).catch(() => {}); }, [studentId]);
  function toggle(mid: number) {
    if (openId === mid) { setOpenId(null); setDetail(null); return; }
    setOpenId(mid); setDetail(null);
    meetingApi.get(mid).then(setDetail).catch(() => {});
  }
  if (list.length === 0) return null;
  return (
    <div className="prof-mtg">
      <div className="prof-mtg-t">연계된 회의록</div>
      {list.map((mt) => (
        <div className="prof-mtg-item" key={mt.id}>
          <button className="prof-mtg-row" onClick={() => toggle(mt.id)}>
            <span className="prof-mtg-date">{mt.meetingDate}</span>
            <span className="prof-mtg-title">{mt.title}</span>
            {mt.category && <span className="prof-mtg-cat">{mt.category}</span>}
          </button>
          {openId === mt.id && (
            <div className="prof-mtg-sum">{detail ? (detail.summary || detail.rawText || "요약이 없어요.") : "불러오는 중…"}</div>
          )}
        </div>
      ))}
    </div>
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
/** 날짜 입력 — 달력(date picker)으로 골라 넣는다(타이핑보다 편함). */
function DateTxt({ ro, value, onChange }: { ro: boolean; value: string; onChange: (v: string) => void }) {
  if (ro) return <span className="prof-val">{value || "—"}</span>;
  return <input className="inline-input" type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
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
  // 표시는 월화수목금 순으로(저장 순서와 무관). 편집·삭제는 원본 인덱스로 동작하게 원본 i를 함께 들고 간다.
  const dowIdx = (d: string) => { const i = DOW.indexOf(d); return i < 0 ? 99 : i; };
  const view = slots.map((s, i) => ({ s, i })).sort((a, b) => dowIdx(a.s.day) - dowIdx(b.s.day));
  if (ro) {
    return (
      <div className="prof-slot-ro">
        {view.length ? view.map(({ s, i }) => <span key={i} className="prof-slot-chip">{s.day} {s.time}~{s.duration}분</span>) : <span className="prof-val">—</span>}
      </div>
    );
  }
  return (
    <div className="prof-slots">
      {view.map(({ s, i }) => (
        <div className="slot" key={i}>
          <select value={s.day} onChange={(e) => update(i, { day: e.target.value })}>
            {DOW.map((d) => <option key={d}>{d}</option>)}
          </select>
          <input type="time" value={s.time} onChange={(e) => update(i, { time: e.target.value })} />
          <input type="number" min={10} step={10} inputMode="numeric" value={s.duration} onChange={(e) => update(i, { duration: Number(e.target.value) || 0 })} onWheel={(e) => e.currentTarget.blur()} title="수업시간(분)" />
          <button type="button" className="slot-x" onClick={() => remove(i)} aria-label="삭제">✕</button>
        </div>
      ))}
      <button type="button" className="add-slot" onClick={add}>+ 수업시간 추가</button>
    </div>
  );
}

/** 학생 상세 — 등하원 이력(조회용, 읽기 전용). 날짜별로 등/하원을 시간순 표시. */
function CheckinHistory({ studentId }: { studentId: string }) {
  const [rows, setRows] = useState<CheckinRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    checkinApi.student(studentId)
      .then((r) => { if (alive) { setRows(r.history); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [studentId]);

  if (loading) return <div className="prof-memo-ro">불러오는 중…</div>;
  if (rows.length === 0) return <p className="prof-memo-ro">등하원 기록이 없어요.</p>;

  const byDate = new Map<string, CheckinRow[]>();
  for (const r of rows) { const a = byDate.get(r.date) || []; a.push(r); byDate.set(r.date, a); }

  return (
    <div className="cih">
      {[...byDate.entries()].map(([date, list]) => (
        <div className="cih-day" key={date}>
          <div className="cih-date">{date}</div>
          <div className="cih-items">
            {list.map((r) => (
              <div className="cih-item" key={r.id}>
                <span className={"ci-st " + (r.kind === "등원" ? "in" : "out")}>{r.subject ? r.subject + " " : ""}{r.kind}</span>
                <span className="cih-time">{r.time}</span>
                {r.sent && <span className="cih-sent">알림 발송됨</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
