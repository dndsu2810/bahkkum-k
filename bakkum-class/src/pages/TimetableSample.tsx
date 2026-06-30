import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { useAuth } from "../auth";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { parseGrade } from "../lib/grade";
import { TODAY, mondayOf, fmtMD } from "../lib/dates";
import { ProfileModal } from "../screens/StudentMaster";
import {
  Board,
  type SampleStudent,
  type Placement,
  type Special,
  type DragData,
  DOW,
  SLOT_MIN,
  START_MIN,
  END_MIN,
  timeToMin,
  specialStyle,
} from "../components/MathTimetableBoard";

/* ──────────────────────────────────────────────────────────────────────────
 * 수학 시간표 리뉴얼 — 미리보기(샘플) 화면.
 *
 * ⚠️ 이 화면은 "구조"를 눈으로 보기 위한 샘플이에요.
 *   - 학생 명단(실제 시간표)을 불러와 칸을 자동으로 채워요(읽기 전용으로 가져옴).
 *   - 여기서 바꿔도 저장되지 않아요. 새로고침하면 원래 시간표로 돌아가요.
 *   - 기존 출결 / 숙제 / 포인트 / 동기화 로직은 아무것도 건드리지 않아요.
 *
 * 핵심 개념
 *   - 시간표 한 칸 = 특정 요일 + 30분(=1블록).
 *   - 한 칸에 그 시간 학생들의 "이름표"가 여러 개 모여요(이름표마다 몇 번째 블록인지 숫자).
 *   - 이름표를 끌어서(드래그) 다른 칸으로 옮기며 편집해요.
 *   - 학생마다 주간 블록 예산(초등 9 / 중고등 10). 일반 이름표 1개 배치당 1블록 차감.
 *   - 특강은 위에 얹어지는 별도 일정이에요(일반 예산과 따로 계산). 끝나면 사라져요.
 * ────────────────────────────────────────────────────────────────────────── */

// 급(학교급) — 초등 저학년/초등 고학년/중등/고등. 학년으로 자동 분류.
type Level = "elemLow" | "elemHigh" | "mid" | "high";
// 주간 블록 예산 — 급별(과목 공통, 영수 동일). 1블록=30분.
//  초등 저학년 4(120분) / 초등 고학년 9(270분) / 중등 10(300분) / 고등 12(360분).
const BUDGET: Record<Level, number> = { elemLow: 4, elemHigh: 9, mid: 10, high: 12 };
const LEVEL_LABEL: Record<Level, string> = { elemLow: "초등 저학년", elemHigh: "초등 고학년", mid: "중등", high: "고등" };
/** 학년 → 급. 초1~3=저학년, 초4~6(또는 학년미상 초등)=고학년, 중=중등, 고=고등. 못 읽으면 초등 고학년으로. */
function levelOf(grade: string): Level {
  const p = parseGrade(grade);
  if (p?.div === "중") return "mid";
  if (p?.div === "고") return "high";
  if (p?.div === "초") return p.n >= 1 && p.n <= 3 ? "elemLow" : "elemHigh";
  return "elemHigh";
}

// 주간 시간표 — 주마다 다르게 짤 수 있어요(예산 총량은 주마다 같아요).
const WEEKS = [
  { v: -1, l: "지난주" },
  { v: 0, l: "이번주" },
  { v: 1, l: "다음주" },
  { v: 2, l: "2주 후" },
];

// 특강 색 팔레트 — 일반 수업(꿀/인포)과 한눈에 구분되는 색들.
const SPECIAL_PALETTE = ["#7c3aed", "#be3f72", "#0d9488", "#2563eb", "#dc2626", "#db2777"];

// 명단을 못 불러올 때 쓰는 더미 학생(초등 3 / 중등 2 / 고등 1).
const SEED_STUDENTS: SampleStudent[] = [
  { id: "e1", name: "김초롱", band: "elemLow" },
  { id: "e2", name: "박하늘", band: "elemLow" },
  { id: "e3", name: "이서준", band: "elemHigh" },
  { id: "m1", name: "정유나", band: "mid" },
  { id: "m2", name: "최민재", band: "mid" },
  { id: "h1", name: "한지우", band: "high" },
];

/** 오늘 날짜 yyyy-mm-dd (기간제 특강 종료 판단용). */
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function TimetableSample() {
  const { user } = useAuth();
  const canEdit = !!user && user.role !== "student";
  const [students, setStudents] = useState<SampleStudent[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [specials, setSpecials] = useState<Special[]>([]);
  const [mode, setMode] = useState<"teacher" | "student">("teacher");
  const [curWeek, setCurWeek] = useState(0);
  const [subjectFilter, setSubjectFilter] = useState<"all" | "math" | "eng">("math"); // 보이는 과목(기본=수학, 영수 안 섞이게)
  const [mathIds, setMathIds] = useState<Set<string>>(new Set()); // 수학 듣는 학생(선생님 편집·예산 대상)
  const [engIds, setEngIds] = useState<Set<string>>(new Set()); // 영어 듣는 학생
  const [focusStudent, setFocusStudent] = useState<string>("");
  const [pickQ, setPickQ] = useState(""); // 학생 검색(이름)
  const [loading, setLoading] = useState(true);
  const [fromRoster, setFromRoster] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false); // 저장된 초안을 불러왔는지
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  // 학생 이름을 누르면 띄우는 상세 프로필 — 명단 원본을 들고 있어야 해요.
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  // 드래그 중 옮기는 대상(이름표 새로 놓기 / 칸 이동).
  const drag = useRef<DragData | null>(null);
  // id 생성용 카운터.
  const seq = useRef(0);
  const newId = () => `p${++seq.current}`;
  const specSeq = useRef(0);

  // 학생 명단(실제 수학 시간표)을 불러와 칸을 자동으로 채워요.
  useEffect(() => {
    let alive = true;
    getRoster()
      .then((roster) => {
        if (!alive) return;
        const enrolled = roster.filter((r) => r.status === "재원");
        const math = enrolled.filter((r) => r.subjects.includes("math"));
        const eng = enrolled.filter((r) => r.subjects.includes("english"));
        if (math.length === 0 && eng.length === 0) throw new Error("empty");

        // 수학·영어 학생을 합쳐 중복 없이 명단을 만들어요(둘 다 듣는 학생은 1명).
        const stuMap = new Map<string, SampleStudent>();
        const rosMap = new Map<string, RosterStudent>();
        for (const r of [...math, ...eng]) {
          if (!stuMap.has(r.id)) stuMap.set(r.id, { id: r.id, name: r.name, band: levelOf(r.grade) });
          if (!rosMap.has(r.id)) rosMap.set(r.id, r);
        }
        const list = [...stuMap.values()];

        // 정규 시간표를 각 주에 똑같이 깔아 둬요 — 그 다음 주마다 다르게 편집해요.
        const init: Placement[] = [];
        let k = 0;
        const lay = (r: RosterStudent, slots: { day: string; time: string; duration: number }[], subject?: "eng") => {
          for (const sl of slots || []) {
            const day = DOW.indexOf(sl.day);
            if (day < 0) continue;
            const start = timeToMin(sl.time);
            const blocks = Math.max(1, Math.round((sl.duration || 30) / SLOT_MIN));
            for (const wk of WEEKS) {
              for (let b = 0; b < blocks; b++) init.push({ id: `i${++k}`, studentId: r.id, week: wk.v, day, slot: start + b * SLOT_MIN, subject });
            }
          }
        };
        for (const r of math) lay(r, r.mathSlots, undefined);
        for (const r of eng) lay(r, r.engSlots, "eng");

        setStudents(list);
        setMathIds(new Set(math.map((r) => r.id)));
        setEngIds(new Set(eng.map((r) => r.id)));
        setPlacements(init);
        setRoster([...rosMap.values()]);
        setFocusStudent(list[0]?.id || "");
        setFromRoster(true);
        setLoading(false);
        // 저장해 둔 초안이 있으면 그걸로 이어가요(없으면 위 명단 시간표 그대로).
        fetch("/api/timetable-draft", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((j: { data?: { placements?: Placement[]; specials?: Special[] } } | null) => {
            if (!alive || !j?.data) return;
            if (Array.isArray(j.data.placements)) setPlacements(j.data.placements);
            if (Array.isArray(j.data.specials)) setSpecials(j.data.specials);
            setDraftLoaded(true);
          })
          .catch(() => {});
      })
      .catch(() => {
        // 명단을 못 불러오면 더미로 — 그래도 구조는 볼 수 있게.
        if (!alive) return;
        setStudents(SEED_STUDENTS);
        setMathIds(new Set(SEED_STUDENTS.map((s) => s.id)));
        setFocusStudent(SEED_STUDENTS[0].id);
        setFromRoster(false);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const specById = useMemo(() => new Map(specials.map((s) => [s.id, s])), [specials]);
  const today = todayStr();

  // 특강이 끝났는지 — 기간제: 종료일이 지남 / 횟수제: 정한 횟수를 다 채움(모든 주 합산).
  const placedOf = (specialId: string) => placements.filter((p) => p.specialId === specialId).length;
  function isEnded(sp: Special): boolean {
    if (sp.endType === "date") return !!sp.endDate && today > sp.endDate;
    return sp.count > 0 && placedOf(sp.id) >= sp.count;
  }

  // 지금 보고 있는 주의 배치만(끝난 특강은 숨김 — 데이터는 남겨 둬 횟수 안정).
  const weekVisible = useMemo(
    () => placements.filter((p) => p.week === curWeek && (!p.specialId || !isEnded(specById.get(p.specialId)!))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placements, specials, today, curWeek],
  );

  // 이름표마다 "그 학생의 몇 번째 블록"인지 — 그 주 안에서 요일·시간 순서로 번호. 일반/특강 따로 셈.
  const blockNo = useMemo(() => {
    const m = new Map<string, number>();
    const counters = new Map<string, number>();
    [...weekVisible]
      .sort((a, b) => a.day - b.day || a.slot - b.slot)
      .forEach((p) => {
        const key = p.studentId + "|" + (p.specialId || p.subject || "reg");
        const n = (counters.get(key) || 0) + 1;
        counters.set(key, n);
        m.set(p.id, n);
      });
    return m;
  }, [weekVisible]);

  // 그릴 요일 — 월~금 기본 + 데이터에 토/일 있으면 추가(모든 주 기준으로 모양 고정).
  const days = useMemo(() => {
    const set = new Set<number>([0, 1, 2, 3, 4]);
    for (const p of placements) set.add(p.day);
    return [...set].sort((a, b) => a - b);
  }, [placements]);

  // 그릴 시간 범위 — 기본 14:00~22:00, 데이터가 더 이르거나 늦으면 늘려요(주 전환에도 모양 유지).
  const slots = useMemo(() => {
    let lo = START_MIN, hi = END_MIN;
    for (const p of placements) {
      lo = Math.min(lo, p.slot);
      hi = Math.max(hi, p.slot + SLOT_MIN);
    }
    const out: number[] = [];
    for (let m = lo; m < hi; m += SLOT_MIN) out.push(m);
    return out;
  }, [placements]);

  // 주간 예산은 급별·과목별로 따로 차감(특강 제외). 영어 보기면 영어 배치, 그 외엔 수학 배치를 셈.
  //  → 한 학생이 영수 둘 다면 영어 9 + 수학 9 식으로 과목별 예산이 각각.
  const usedOf = (sid: string) =>
    placements.filter((p) => p.studentId === sid && !p.specialId && p.week === curWeek && (subjectFilter === "eng" ? p.subject === "eng" : !p.subject)).length;
  const remainingOf = (s: SampleStudent) => BUDGET[s.band as Level] - usedOf(s.id);

  // 보이는 과목으로 거른 배치(격자 표시용). 영어=명단에서 가져온 보기 전용.
  const shown = useMemo(
    () => (subjectFilter === "all" ? weekVisible : subjectFilter === "eng" ? weekVisible.filter((p) => p.subject === "eng") : weekVisible.filter((p) => !p.subject)),
    [weekVisible, subjectFilter],
  );

  function addPlacement(studentId: string, day: number, slot: number, specialId?: string, subject?: "eng") {
    if (specialId) {
      const sp = specById.get(specialId);
      if (!sp || isEnded(sp)) return;
    }
    setPlacements((cur) => {
      // 같은 학생·요일·시간·주에 같은 과목이 이미 있으면 중복 안 만듦(과목이 다르면 따로 둠).
      if (cur.some((p) => p.studentId === studentId && p.day === day && p.slot === slot && p.week === curWeek && (p.subject || "") === (subject || ""))) return cur;
      return [...cur, { id: newId(), studentId, week: curWeek, day, slot, specialId, subject }];
    });
  }
  function movePlacement(placementId: string, day: number, slot: number) {
    setPlacements((cur) => {
      const p = cur.find((x) => x.id === placementId);
      if (!p) return cur;
      if (p.day === day && p.slot === slot) return cur;
      // 같은 과목끼리만 자리 충돌 검사(영어는 수학 칸 위로 옮겨도 됨).
      if (cur.some((x) => x.id !== placementId && x.studentId === p.studentId && x.day === day && x.slot === slot && x.week === p.week && (x.subject || "") === (p.subject || ""))) return cur;
      return cur.map((x) => (x.id === placementId ? { ...x, day, slot } : x));
    });
  }
  function removePlacement(placementId: string) {
    setPlacements((cur) => cur.filter((p) => p.id !== placementId));
  }

  function onCellDrop(day: number, slot: number) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "new") {
      if (d.specialId) {
        addPlacement(d.studentId, day, slot, d.specialId);
      } else if (subjectFilter === "eng") {
        // 영어 보기 — 영어 블록. 영어 예산(급별)도 차감.
        const s = byId.get(d.studentId);
        if (s && remainingOf(s) > 0) addPlacement(s.id, day, slot, undefined, "eng");
      } else if (subjectFilter === "all") {
        // 전체 보기 — 학생 소속으로 과목 결정(영어전용=영어, 그 외 수학). 예산 게이트 없이 배치.
        const s = byId.get(d.studentId);
        if (s) addPlacement(s.id, day, slot, undefined, engIds.has(s.id) && !mathIds.has(s.id) ? "eng" : undefined);
      } else {
        const s = byId.get(d.studentId);
        if (s && remainingOf(s) > 0) addPlacement(s.id, day, slot);
      }
    } else {
      movePlacement(d.placementId, day, slot);
    }
  }
  function onUnplaceDrop() {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "move") removePlacement(d.placementId);
  }

  // ── 특강 만들기·고치기·지우기 ──────────────────────────────
  function addSpecial() {
    const n = ++specSeq.current;
    setSpecials((cur) => [
      ...cur,
      {
        id: `s${n}`,
        name: `특강${n}`,
        color: SPECIAL_PALETTE[(n - 1) % SPECIAL_PALETTE.length],
        endType: "count",
        endDate: "",
        count: 4,
        studentIds: [],
      },
    ]);
  }
  function patchSpecial(id: string, patch: Partial<Special>) {
    setSpecials((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeSpecial(id: string) {
    setSpecials((cur) => cur.filter((s) => s.id !== id));
    setPlacements((cur) => cur.filter((p) => p.specialId !== id));
  }

  // 학생 이름 클릭 → 상세 프로필. 명단에서 불러온 학생만(더미는 제외).
  const rosterById = useMemo(() => new Map(roster.map((r) => [r.id, r])), [roster]);
  const openStudent = openId ? rosterById.get(openId) || null : null;
  function openProfile(studentId: string) {
    if (rosterById.has(studentId)) setOpenId(studentId);
  }
  function applyLocalRoster(next: RosterStudent) {
    setRoster((cur) => cur.map((r) => (r.id === next.id ? next : r)));
    setStudents((cur) => cur.map((s) => (s.id === next.id ? { ...s, name: next.name, band: levelOf(next.grade) } : s)));
  }

  // 배치 초안 저장 — 실제 시간표는 안 건드리고 설계만 보관(새로고침해도 이어가기).
  async function saveDraft() {
    if (saving) return;
    setSaving(true);
    setSavedAt(false);
    try {
      const r = await fetch("/api/timetable-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ placements, specials }),
      });
      if (r.ok) { setSavedAt(true); setDraftLoaded(true); setTimeout(() => setSavedAt(false), 2500); }
    } catch {
      /* 저장 실패는 무시 — 다시 시도 가능 */
    } finally {
      setSaving(false);
    }
  }
  // 초안 자동 저장 — 배치/특강이 바뀌면 1.2초 뒤 자동 저장(실제 시간표는 안 건드림). 명단 로드 후에만.
  useEffect(() => {
    if (!canEdit || loading || !fromRoster) return;
    const t = window.setTimeout(() => { void saveDraft(); }, 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placements, specials, canEdit, loading, fromRoster]);

  // 학생 기본 시간표 이미지 저장(영수 포함) — 그 학생 보기 화면을 PNG로 내려받아요.
  const [imgBusy, setImgBusy] = useState(false);
  async function saveStudentImage() {
    const el = document.getElementById("tts-sv-capture");
    if (!el || imgBusy) return;
    setImgBusy(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${byId.get(focusStudent)?.name || "학생"}_기본시간표.png`;
      a.click();
    } catch {
      /* 캡처 실패는 무시 */
    } finally {
      setImgBusy(false);
    }
  }

  // 지금 보는 주의 날짜 범위(월~일).
  const mon = mondayOf(TODAY, curWeek);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const weekRange = `${fmtMD(mon)} ~ ${fmtMD(sun)}`;

  return (
    <div className="tts">
      <div className="page-head">
        <div>
          <h1 className="page-title">통합 시간표(샘플)</h1>
          <p className="page-sub">
            수학·영어를 한 시간표에서 같이 봐요. 명단의 실제 시간표를 각 주에 깔아 뒀어요. 위에서 <b>과목</b>을 고르면, 그 과목 학생을 끌어다 칸에 놓아 편집할 수 있어요(영어는 보라색).
          </p>
        </div>
        <div className="page-head-actions">
          {canEdit && mode === "teacher" && (
            <span className="tts-autosave" title="배치는 자동으로 초안 저장돼요(실제 시간표는 안 바뀌어요)">
              <Icon name="check" /> {saving ? "저장 중…" : savedAt ? "저장됨 ✓" : "자동 저장돼요"}
            </span>
          )}
          <div className="tts-viewtoggle" role="tablist" aria-label="보기 전환">
            <button
              className={"tts-seg" + (mode === "teacher" ? " on" : "")}
              onClick={() => setMode("teacher")}
              role="tab"
              aria-selected={mode === "teacher"}
            >
              <Icon name="edit" /> 선생님 보기
            </button>
            <button
              className={"tts-seg" + (mode === "student" ? " on" : "")}
              onClick={() => setMode("student")}
              role="tab"
              aria-selected={mode === "student"}
            >
              <Icon name="students" /> 학생 보기
            </button>
          </div>
        </div>
      </div>

      {/* 주간 선택 — 선생님·학생 보기 공통. 주마다 시간표가 달라요. */}
      <div className="tts-weekbar">
        <div className="tts-weeks">
          {WEEKS.map((w) => (
            <button
              key={w.v}
              className={"tts-seg" + (curWeek === w.v ? " on" : "")}
              onClick={() => setCurWeek(w.v)}
            >
              {w.l}
            </button>
          ))}
        </div>
        <span className="tts-weekrange">
          <Icon name="cal" /> {weekRange}
        </span>
        <div className="tts-subjseg">
          {([["all", "전체"], ["math", "수학"], ["eng", "영어"]] as const).map(([v, l]) => (
            <button key={v} className={"tts-seg" + (subjectFilter === v ? " on" : "")} onClick={() => setSubjectFilter(v)}>{l}</button>
          ))}
        </div>
      </div>

      {/* 특강 — 선생님 보기에서만 관리해요. */}
      {mode === "teacher" && (
        <div className="tts-specials">
          <div className="tts-specials-head">
            <span>특강</span>
            <button className="btn sm primary" onClick={addSpecial}>
              <Icon name="plus" /> 특강 추가
            </button>
          </div>
          {specials.length === 0 ? (
            <p className="tts-hint tts-specials-empty">
              특강을 추가하면 듣는 학생을 넣고, 그 학생 이름표를 칸에 끌어다 놓을 수 있어요. 특강은 일반 예산과 따로 계산돼요.
            </p>
          ) : (
            <div className="tts-spcards">
              {specials.map((sp) => (
                <SpecialCard
                  key={sp.id}
                  sp={sp}
                  students={students}
                  byId={byId}
                  placed={placedOf(sp.id)}
                  ended={isEnded(sp)}
                  today={today}
                  drag={drag}
                  onPatch={(patch) => patchSpecial(sp.id, patch)}
                  onRemove={() => removeSpecial(sp.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="tts-layout">
        {/* 학생 목록 패널 — 칸 밖으로 끌면 배치가 취소되는 영역이기도 해요. */}
        <aside
          className="tts-students"
          onDragOver={(e) => {
            if (drag.current?.kind === "move") {
              e.preventDefault();
              e.currentTarget.classList.add("tts-drop-cancel");
            }
          }}
          onDragLeave={(e) => e.currentTarget.classList.remove("tts-drop-cancel")}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("tts-drop-cancel");
            onUnplaceDrop();
          }}
        >
          <div className="tts-students-head">학생 목록 {students.length > 0 && <span>{students.length}</span>}</div>
          {mode === "teacher" && !loading && (
            <input className="input" value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder="학생 이름 검색" style={{ width: "100%", marginBottom: 8 }} />
          )}
          {loading ? (
            <p className="tts-hint">불러오는 중…</p>
          ) : mode === "teacher" ? (
            // 교사 — 과목 보기에 따라 학생 목록. '전체'면 모든 학생(영수 통합) + 이름 검색.
            students
              .filter((s) => (subjectFilter === "all" ? true : subjectFilter === "eng" ? engIds.has(s.id) : mathIds.has(s.id)))
              .filter((s) => !pickQ.trim() || s.name.includes(pickQ.trim()))
              .map((s) => {
                const sj: "math" | "eng" = subjectFilter === "eng" ? "eng" : subjectFilter === "math" ? "math" : engIds.has(s.id) && !mathIds.has(s.id) ? "eng" : "math";
                const showBudget = subjectFilter !== "all"; // '전체'는 과목 예산이 모호해 표시 안 함
                const rem = remainingOf(s);
                const full = showBudget && rem <= 0;
                return (
                  <div
                    key={s.id}
                    className={"tts-scard " + (sj === "eng" ? "tts-eng" : "tts-math") + (full ? " full" : "")}
                    draggable={!full}
                    onDragStart={() => { if (!full) drag.current = { kind: "new", studentId: s.id }; }}
                    onDragEnd={() => { drag.current = null; }}
                    title={full ? "남은 블록을 다 채웠어요" : "끌어서 시간표 칸에 놓아요"}
                  >
                    <div className="tts-scard-main">
                      <b>{s.name}</b>
                      <span className="tts-level">{LEVEL_LABEL[s.band as Level]}</span>
                      {subjectFilter === "all" && <span className="tts-level">{sj === "eng" ? "영어" : "수학"}</span>}
                    </div>
                    {showBudget && (full ? <span className="tts-rem done">다 채웠어요</span> : <span className="tts-rem">남은 블록 <b>{rem}</b></span>)}
                  </div>
                );
              })
          ) : (
            // 학생 보기 — 한 명을 골라요.
            <div className="tts-pickwrap">
              <div className="tts-pick-label">볼 학생</div>
              <input className="input tts-pick-search" value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder="학생 이름 검색" style={{ minWidth: 130, maxWidth: 180 }} />
              {students.filter((s) => (subjectFilter === "eng" ? engIds.has(s.id) : subjectFilter === "math" ? mathIds.has(s.id) : true)).filter((s) => !pickQ.trim() || s.name.includes(pickQ.trim())).map((s) => {
                const picked = focusStudent === s.id;
                const drabble = canEdit && picked && (subjectFilter === "eng" ? engIds.has(s.id) : mathIds.has(s.id));
                return (
                  <button
                    key={s.id}
                    className={"tts-pick" + (picked ? " on" : "")}
                    onClick={() => setFocusStudent(s.id)}
                    draggable={drabble}
                    onDragStart={drabble ? () => { drag.current = { kind: "new", studentId: s.id }; } : undefined}
                    onDragEnd={() => { drag.current = null; }}
                    title={drabble ? "끌어서 시간표 칸에 놓으면 수업이 추가돼요" : undefined}
                  >
                    <b>{s.name}</b>
                    <span className="tts-level">{LEVEL_LABEL[s.band as Level]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* 시간표 영역 */}
        <section className="tts-gridwrap">
          {mode === "teacher" ? (
            <Board
              days={days}
              slots={slots}
              placements={shown}
              byId={byId}
              specById={specById}
              blockNo={blockNo}
              onPick={openProfile}
              editable
              drag={drag}
              onCellDrop={onCellDrop}
              onRemove={removePlacement}
            />
          ) : focusStudent && byId.get(focusStudent) ? (
            <div className="tts-studentview">
              <div className="tts-sv-head tts-sv-head-row">
                <span>
                  <b>{byId.get(focusStudent)!.name}</b>{" "}
                  <span className="tts-level">{LEVEL_LABEL[byId.get(focusStudent)!.band as Level]}</span> 학생의 <b>기본 시간표</b>예요(수학·영어 함께, 매주 반복되는 고정 시간표).
                  {canEdit && " 왼쪽에서 이 학생을 끌어다 칸에 놓으면 추가, 이름표 옆 ×로 빼요."}
                </span>
                <button className="btn ghost sm" onClick={saveStudentImage} disabled={imgBusy} title="이 학생 기본 시간표를 이미지로 저장(영수 포함)">
                  <Icon name="copy" /> {imgBusy ? "저장 중…" : "이미지 저장"}
                </button>
              </div>
              <div id="tts-sv-capture" className="tts-sv-capture">
                <div className="tts-sv-cap-title">{byId.get(focusStudent)!.name} · 기본 시간표</div>
                <Board
                  days={days}
                  slots={slots}
                  placements={weekVisible.filter((p) => p.studentId === focusStudent)}
                  byId={byId}
                  specById={specById}
                  blockNo={blockNo}
                  onPick={openProfile}
                  editable={canEdit}
                  drag={drag}
                  onCellDrop={onCellDrop}
                  onRemove={removePlacement}
                />
              </div>
            </div>
          ) : (
            <div className="empty">학생을 골라 주세요.</div>
          )}
        </section>
      </div>

      <p className="tts-note">
        <Icon name="info" />
        {fromRoster
          ? (draftLoaded
              ? " 저장해 둔 초안을 불러왔어요. 끌어 배치한 뒤 우상단 ‘초안 저장’을 누르면 보관돼요. 이건 설계용 초안이라 실제 시간표(오늘·내일)는 바뀌지 않아요."
              : " 학생 명단의 실제 시간표를 불러왔어요. 끌어 배치한 뒤 우상단 ‘초안 저장’을 누르면 보관돼요(설계용 초안 — 실제 시간표는 안 바뀜).")
          : " 명단을 불러오지 못해 예시 학생으로 보여드려요."}
      </p>

      {openStudent && (
        <ProfileModal
          key={openStudent.id}
          student={openStudent}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onSaved={applyLocalRoster}
        />
      )}
    </div>
  );
}

/* 특강 카드 — 이름·색·끝나는 기준 설정 + 듣는 학생(끌어다 놓는 출발점). */
function SpecialCard({
  sp,
  students,
  byId,
  placed,
  ended,
  today,
  drag,
  onPatch,
  onRemove,
}: {
  sp: Special;
  students: SampleStudent[];
  byId: Map<string, SampleStudent>;
  placed: number;
  ended: boolean;
  today: string;
  drag: React.MutableRefObject<DragData | null>;
  onPatch: (patch: Partial<Special>) => void;
  onRemove: () => void;
}) {
  const notEnrolled = students.filter((s) => !sp.studentIds.includes(s.id));
  const countFull = sp.endType === "count" && sp.count > 0 && placed >= sp.count;
  return (
    <div className={"tts-spcard" + (ended ? " ended" : "")} style={{ borderLeftColor: sp.color }}>
      <div className="tts-spcard-top">
        <span className="tts-spdot" style={{ background: sp.color }} />
        <input
          className="tts-spname"
          value={sp.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          aria-label="특강 이름"
        />
        <button className="tts-spx" onClick={onRemove} aria-label="특강 삭제" title="특강 삭제">
          <Icon name="trash" />
        </button>
      </div>

      <div className="tts-spcolors">
        {SPECIAL_PALETTE.map((c) => (
          <button
            key={c}
            className={"tts-spswatch" + (sp.color === c ? " on" : "")}
            style={{ background: c }}
            onClick={() => onPatch({ color: c })}
            aria-label={"색 " + c}
          />
        ))}
      </div>

      <div className="tts-spend">
        <label className="tts-spradio">
          <input type="radio" checked={sp.endType === "count"} onChange={() => onPatch({ endType: "count" })} />
          횟수제
        </label>
        <label className="tts-spradio">
          <input type="radio" checked={sp.endType === "date"} onChange={() => onPatch({ endType: "date" })} />
          기간제
        </label>
      </div>

      {sp.endType === "count" ? (
        <div className="tts-spfield">
          총
          <input
            type="number"
            min={1}
            max={30}
            value={sp.count}
            onChange={(e) => onPatch({ count: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
          />
          블록 · 배치 <b>{placed}</b>/{sp.count}
        </div>
      ) : (
        <div className="tts-spfield">
          종료일
          <input type="date" value={sp.endDate} onChange={(e) => onPatch({ endDate: e.target.value })} />
          {!sp.endDate && <span className="tts-hint">비우면 진행 중</span>}
          {sp.endDate && today > sp.endDate && <span className="tts-hint">지난 날짜예요</span>}
        </div>
      )}

      <div className="tts-spstudents">
        {sp.studentIds.length === 0 && <span className="tts-hint">듣는 학생을 넣어요</span>}
        {sp.studentIds.map((sid) => {
          const s = byId.get(sid);
          if (!s) return null;
          const drabble = !ended && !countFull;
          return (
            <span
              key={sid}
              className="tts-spchip"
              style={specialStyle(sp.color)}
              draggable={drabble}
              onDragStart={() => {
                if (drabble) drag.current = { kind: "new", studentId: sid, specialId: sp.id };
              }}
              onDragEnd={() => {
                drag.current = null;
              }}
              title={drabble ? "끌어서 시간표 칸에 놓아요" : "특강이 끝나 더 넣을 수 없어요"}
            >
              {s.name} {sp.name}
              <button
                className="tts-spchip-x"
                onClick={() => onPatch({ studentIds: sp.studentIds.filter((x) => x !== sid) })}
                aria-label="학생 빼기"
              >
                ×
              </button>
            </span>
          );
        })}
        {notEnrolled.length > 0 && (
          <select
            className="tts-spadd"
            value=""
            onChange={(e) => {
              if (e.target.value) onPatch({ studentIds: [...sp.studentIds, e.target.value] });
            }}
            aria-label="학생 추가"
          >
            <option value="">+ 학생 추가</option>
            {notEnrolled.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({LEVEL_LABEL[s.band as Level]})
              </option>
            ))}
          </select>
        )}
      </div>

      {ended && <div className="tts-spended">끝났어요 · 시간표에서 사라졌어요</div>}
    </div>
  );
}
