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
// 기본(고정) 시간표 = 가상 주 BASE. 기본을 고치면 (그 주만 따로 손대지 않은) 모든 주에 반영,
// 특정 주에서 고치면 그 주 전용본(오버라이드)이 생겨 그 주만 1회성으로 바뀐다.
const BASE = 1000;
const WEEK_SEQ = [BASE, -1, 0, 1, 2]; // ‹ › 이동 순서: 기본 → 지난주 → 이번주 → 다음주 → 2주 후
const weekLabelOf = (w: number) => (w === BASE ? "기본 시간표" : WEEKS.find((x) => x.v === w)?.l || "");
/** 급(band) → 학년 구분(초/중/고). 초등 저학년·고학년은 모두 '초'. */
const divOf = (band?: string): "초" | "중" | "고" => (band === "mid" ? "중" : band === "high" ? "고" : "초");

// 특강 색 팔레트 — 일반 수업(꿀/인포)과 한눈에 구분되는 색들.
const SPECIAL_PALETTE = ["#7c3aed", "#be3f72", "#0d9488", "#2563eb", "#dc2626", "#db2777"];

// 명단을 못 불러올 때 쓰는 더미 학생(초등 3 / 중등 2 / 고등 1).
const SEED_STUDENTS: SampleStudent[] = [
  { id: "e1", name: "김초롱", band: "elemLow", grade: "초2" },
  { id: "e2", name: "박하늘", band: "elemLow", grade: "초3" },
  { id: "e3", name: "이서준", band: "elemHigh", grade: "초5" },
  { id: "m1", name: "정유나", band: "mid", grade: "중1" },
  { id: "m2", name: "최민재", band: "mid", grade: "중2" },
  { id: "h1", name: "한지우", band: "high", grade: "고1" },
];

/** 오늘 날짜 yyyy-mm-dd (기간제 특강 종료 판단용). */
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ── 이미지 저장용 깔끔한 시간표 카드 ──────────────────────────────────────────
 * 화면의 편집 보드(이름표·분할칸)와 별개로, 한 학생의 영어·수학 일정을 '병합 블록'
 * (예: 영어 정규 4:00~6:00)으로 그려요. html2canvas가 정확히 캡처하도록 인라인 hex 색만 써요. */
const ACADEMY_NAME = "바꿈영수학원";
interface ExportBlock { day: number; start: number; end: number; label: string; color: string; bg: string; kind: string }
/** "HH:MM" 짧은 표기(오전/오후 없이) — 4:00, 5:30. */
function fmtShort(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}`;
}
/** 한 학생의 30분 배치들을 같은 요일·같은 수업끼리 이어서 하나의 블록으로 합쳐요. */
function exportBlocks(pls: Placement[], specById: Map<string, Special>): ExportBlock[] {
  const groups = new Map<string, Placement[]>();
  for (const p of pls) {
    const kind = p.specialId ? "sp:" + p.specialId : p.subject === "eng" ? "eng" : "math";
    const key = p.day + "|" + kind;
    const g = groups.get(key) || [];
    g.push(p);
    groups.set(key, g);
  }
  const out: ExportBlock[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.slot - b.slot);
    const p0 = arr[0];
    const sp = p0.specialId ? specById.get(p0.specialId) : undefined;
    const label = sp ? sp.name : p0.subject === "eng" ? "영어 정규" : "수학 정규";
    const color = sp ? sp.color : p0.subject === "eng" ? "#2563eb" : "#c2772a";
    const bg = sp ? sp.color + "22" : p0.subject === "eng" ? "#dbe8fb" : "#fbe6cf";
    const kind = p0.specialId ? "sp:" + p0.specialId : p0.subject === "eng" ? "eng" : "math";
    let runStart = p0.slot, prev = p0.slot;
    const flush = () => out.push({ day: p0.day, start: runStart, end: prev + SLOT_MIN, label, color, bg, kind });
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].slot === prev + SLOT_MIN) prev = arr[i].slot;
      else { flush(); runStart = arr[i].slot; prev = arr[i].slot; }
    }
    flush();
  }
  return out;
}
// 절대위치 레이아웃(ett 방식) — html2canvas가 정확히 그려요. CSS Grid는 캡처 시 어긋날 수 있어 피해요.
const DAY_W = 150, TIME_W = 88, GAP = 8, HEAD_H = 48, PX = 1.18;
function ExportTimetable({ studentName, blocks, days, weekLabel }: { studentName: string; blocks: ExportBlock[]; days: number[]; weekLabel: string }) {
  const has = blocks.length > 0;
  const minStart = has ? Math.min(...blocks.map((b) => b.start)) : START_MIN;
  const maxEnd = has ? Math.max(...blocks.map((b) => b.end)) : START_MIN + 240;
  const bset = new Set<number>([minStart, maxEnd]);
  for (const b of blocks) { bset.add(b.start); bset.add(b.end); }
  const bounds = [...bset].sort((a, b) => a - b);
  const base = bounds[0];
  const bodyH = Math.max(160, (bounds[bounds.length - 1] - base) * PX);
  // 범례 — 등장한 수업 종류(영어 정규 → 수학 정규 → 특강 순).
  const legend: { label: string; color: string; bg: string }[] = [];
  const order = ["eng", "math"];
  for (const b of [...blocks].sort((a, b2) => (order.indexOf(a.kind) + 1 || 9) - (order.indexOf(b2.kind) + 1 || 9))) {
    if (!legend.some((l) => l.label === b.label)) legend.push({ label: b.label, color: b.color, bg: b.bg });
  }
  const gridW = TIME_W + days.length * (DAY_W + GAP);
  return (
    <div style={{ width: gridW + 56, background: "#fff", borderRadius: 22, padding: "26px 28px 22px", fontFamily: "'Pretendard', system-ui, sans-serif", color: "#1f2937", boxSizing: "border-box" }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.01em" }}>영어 · 수학 시간표</div>
          <div style={{ fontSize: 14, color: "#9ca3af", marginTop: 3 }}>{ACADEMY_NAME}{weekLabel ? ` · ${weekLabel}` : ""}</div>
        </div>
        {studentName && <div style={{ background: "#1f2937", color: "#fff", fontSize: 17, fontWeight: 700, borderRadius: 999, padding: "9px 22px" }}>{studentName}</div>}
      </div>
      <div style={{ borderBottom: "3px solid #1f2937", margin: "12px 0 18px" }} />
      {/* 시간표 — 시간 열 + 요일 열(절대위치 블록) */}
      <div style={{ display: "flex", gap: GAP }}>
        {/* 시간 열 */}
        <div style={{ width: TIME_W, flex: "none" }}>
          <div style={{ ...thCell, height: HEAD_H }}>시간</div>
          <div style={{ position: "relative", height: bodyH, marginTop: GAP }}>
            {/* 경계(수업 시작·끝)마다 시간 하나씩 — 요일 칸의 구분선과 같은 위치에 맞춰요(중복·겹침 방지). */}
            {bounds.map((t) => (
              <div key={t} style={{ position: "absolute", right: 6, top: (t - base) * PX - 11, height: 22, display: "flex", alignItems: "center", justifyContent: "flex-end", fontSize: 15, fontWeight: 700, color: "#6b7280", whiteSpace: "nowrap" }}>
                {fmtShort(t)}
              </div>
            ))}
          </div>
        </div>
        {/* 요일 열 */}
        {days.map((d) => {
          const dayBlocks = blocks.filter((b) => b.day === d);
          return (
            <div key={d} style={{ width: DAY_W, flex: "none" }}>
              <div style={{ ...thCell, height: HEAD_H }}>{DOW[d]}</div>
              <div style={{ position: "relative", height: bodyH, marginTop: GAP, background: "#fafafa", borderRadius: 12 }}>
                {/* 경계 줄 */}
                {bounds.slice(1, -1).map((t) => (
                  <div key={t} style={{ position: "absolute", left: 0, right: 0, top: (t - base) * PX, borderTop: "1px solid #eef0f3" }} />
                ))}
                {dayBlocks.length === 0 ? (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#b6bcc6", fontSize: 16, fontWeight: 600 }}>미등원</div>
                ) : dayBlocks.map((b, i) => (
                  <div key={i} style={{ position: "absolute", left: 4, right: 4, top: (b.start - base) * PX + 2, height: (b.end - b.start) * PX - 6, background: b.bg, border: `1.5px solid ${b.color}33`, borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, boxSizing: "border-box", padding: 6 }}>
                    <span style={{ fontSize: 17, fontWeight: 800, color: b.color }}>{b.label}</span>
                    <span style={{ fontSize: 13, color: b.color, opacity: 0.85 }}>{fmtShort(b.start)} ~ {fmtShort(b.end)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {/* 범례 + 워터마크 */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 18, marginTop: 18, paddingTop: 14, borderTop: "1px solid #eef0f3" }}>
        {legend.map((l) => (
          <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, color: "#4b5563" }}>
            <span style={{ width: 16, height: 16, borderRadius: 5, background: l.bg, border: `1.5px solid ${l.color}55` }} />
            {l.label}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#c4c9d1", fontWeight: 600 }}>{ACADEMY_NAME}</span>
      </div>
    </div>
  );
}
const thCell: React.CSSProperties = { background: "#eef0f3", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#374151" };

/* 체크박스 그리드 편집기 — 학생 한 명의 영어/수학 수업을 30분 칸 체크로 켜고 끈다.
 * 드래그 보드와 같은 placements를 고치므로 양방향 연동. 칸 형식: 행=시간, 열=요일×(영어|수학). */
function CheckGridEditor({ student, days, slots, cells, enrolledEng, enrolledMath, remEng, remMath, onToggle }: {
  student: SampleStudent; days: number[]; slots: number[]; cells: Set<string>;
  enrolledEng: boolean; enrolledMath: boolean; remEng: number; remMath: number;
  onToggle: (day: number, slot: number, subj: "math" | "eng", checked: boolean) => void;
}) {
  const subjCols: ("eng" | "math")[] = [];
  if (enrolledEng) subjCols.push("eng");
  if (enrolledMath) subjCols.push("math");
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  if (!subjCols.length) return <div className="tts-hint tts-cg-empty">이 학생의 영어·수학 수강 정보가 없어요. 학생 명단에서 과목을 지정해 주세요.</div>;
  return (
    <div className="tts-cg">
      <div className="tts-cg-budget">
        <span className="tts-cg-name"><b>{student.name}</b> — 칸을 체크해 수업을 켜고 꺼요</span>
        {enrolledEng && <span className={"tts-cg-rem eng" + (remEng < 0 ? " over" : "")}>영어 남은 블록 <b>{remEng}</b></span>}
        {enrolledMath && <span className={"tts-cg-rem math" + (remMath < 0 ? " over" : "")}>수학 남은 블록 <b>{remMath}</b></span>}
      </div>
      <div className="tts-cg-scroll">
        <table className="tts-cg-table">
          <colgroup>
            <col className="tts-cg-col-time" />
            {days.map((d) => subjCols.map((sj) => <col key={"c-" + d + "-" + sj} />))}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} className="tts-cg-th tts-cg-thtime">시간</th>
              {days.map((d) => <th key={d} colSpan={subjCols.length} className="tts-cg-th">{DOW[d]}</th>)}
            </tr>
            <tr>
              {days.map((d) => subjCols.map((sj) => (
                <th key={d + "-" + sj} className={"tts-cg-sub " + sj}>{sj === "eng" ? "영어" : "수학"}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {slots.map((m) => (
              <tr key={m}>
                <td className="tts-cg-time">{fmt(m)}</td>
                {days.map((d) => subjCols.map((sj) => {
                  const checked = cells.has(`${d}|${m}|${sj}`);
                  const rem = sj === "eng" ? remEng : remMath;
                  const disabled = !checked && rem <= 0;
                  return (
                    <td key={d + "-" + sj} className={"tts-cg-cell " + sj + (checked ? " on" : "")}>
                      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(d, m, sj, e.target.checked)} aria-label={`${DOW[d]} ${fmt(m)} ${sj === "eng" ? "영어" : "수학"}`} />
                    </td>
                  );
                }))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TimetableSample() {
  const { user } = useAuth();
  const canEdit = !!user && user.role !== "student";
  const [students, setStudents] = useState<SampleStudent[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [specials, setSpecials] = useState<Special[]>([]);
  const [mode, setMode] = useState<"teacher" | "student">("teacher");
  const [curWeek, setCurWeek] = useState(BASE); // 기본(고정) 시간표가 기본값
  const [subjectFilter, setSubjectFilter] = useState<"all" | "math" | "eng">("math"); // 보이는 과목(기본=수학, 영수 안 섞이게)
  const [dayFilter, setDayFilter] = useState<number | "all">("all"); // 요일별 보기(전체 또는 한 요일만)
  const [gradeFilter, setGradeFilter] = useState<"all" | "초" | "중" | "고">("all"); // 학년별 보기(초/중/고)
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
  const [editCheck, setEditCheck] = useState(false); // 학생 보기 '수정하기' — 체크박스 그리드 편집기 토글

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
          if (!stuMap.has(r.id)) stuMap.set(r.id, { id: r.id, name: r.name, band: levelOf(r.grade), grade: r.grade });
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
            // 명단 시간표는 '기본(BASE)'에만 깔아 둬요 — 각 주는 기본에서 파생되고, 그 주를 직접 고칠 때만 전용본이 생겨요.
            for (let b = 0; b < blocks; b++) init.push({ id: `i${++k}`, studentId: r.id, week: BASE, day, slot: start + b * SLOT_MIN, subject });
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
            if (Array.isArray(j.data.placements)) {
              let pls = j.data.placements;
              // 구버전 초안(주별 복사본, BASE 없음) → 중복 제거하며 기본(BASE)으로 병합.
              if (pls.length && !pls.some((p) => p.week === BASE)) {
                const seen = new Set<string>();
                const merged: Placement[] = [];
                for (const p of pls) {
                  const key = `${p.studentId}|${p.day}|${p.slot}|${p.subject || ""}|${p.specialId || ""}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  merged.push({ ...p, week: BASE });
                }
                pls = merged;
              }
              setPlacements(pls);
            }
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

  // 지금 보는 주의 '실제로 읽을' week — 기본이거나, 그 주 전용본이 있으면 그 주, 없으면 기본에서 파생.
  const curIsCustom = curWeek !== BASE && placements.some((p) => p.week === curWeek);
  const effWeek = curWeek === BASE ? BASE : curIsCustom ? curWeek : BASE;

  // 지금 보고 있는 주의 배치만(끝난 특강은 숨김 — 데이터는 남겨 둬 횟수 안정).
  const weekVisible = useMemo(
    () => placements.filter((p) => p.week === effWeek && (!p.specialId || !isEnded(specById.get(p.specialId)!))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placements, specials, today, effWeek],
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
  // 요일별 보기 — 한 요일만 고르면 그 요일만 그려요.
  const daysShown = dayFilter === "all" ? days : days.filter((d) => d === dayFilter);
  // 학년별 보기 — 초/중/고 고르면 그 학년 학생 블록만 그려요(번호는 전체 기준 유지).
  const gridPlacements = gradeFilter === "all" ? weekVisible : weekVisible.filter((p) => divOf(byId.get(p.studentId)?.band) === gradeFilter);

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
  const usedOf = (sid: string, subj: "math" | "eng") =>
    placements.filter((p) => p.studentId === sid && !p.specialId && p.week === effWeek && (subj === "eng" ? p.subject === "eng" : !p.subject)).length;
  const remainingOf = (s: SampleStudent, subj: "math" | "eng") => BUDGET[s.band as Level] - usedOf(s.id, subj);

  // 체크박스 그리드(학생 보기 '수정하기') — 지금 학생의 배치 칸 집합 "day|slot|subj".
  // 드래그 보드와 같은 placements를 고치므로 두 방식이 양방향으로 연동돼요.
  const focusCells = useMemo(() => {
    const set = new Set<string>();
    for (const p of weekVisible) if (p.studentId === focusStudent && !p.specialId) set.add(`${p.day}|${p.slot}|${p.subject === "eng" ? "eng" : "math"}`);
    return set;
  }, [weekVisible, focusStudent]);
  function toggleCheck(day: number, slot: number, subj: "math" | "eng", checked: boolean) {
    if (checked) {
      const s = byId.get(focusStudent);
      if (s && remainingOf(s, subj) > 0) addPlacement(focusStudent, day, slot, undefined, subj === "eng" ? "eng" : undefined);
    } else {
      const p = weekVisible.find((x) => x.studentId === focusStudent && !x.specialId && x.day === day && x.slot === slot && (subj === "eng" ? x.subject === "eng" : !x.subject));
      if (p) removePlacement(p.id);
    }
  }


  // 편집 대상 week — 기본 보기면 BASE, 특정 주 보기면 그 주.
  const target = curWeek;
  // 특정 주를 처음 고칠 때, 기본을 그 주로 복제(이후 그 주만 1회성 수정). 결정적 id로 복제해 이동/삭제 대응이 쉽게.
  const materialize = (cur: Placement[]): Placement[] =>
    target !== BASE && !cur.some((p) => p.week === target)
      ? [...cur, ...cur.filter((p) => p.week === BASE).map((p) => ({ ...p, id: p.id + "@" + target, week: target }))]
      : cur;

  function addPlacement(studentId: string, day: number, slot: number, specialId?: string, subject?: "eng") {
    if (specialId) {
      const sp = specById.get(specialId);
      if (!sp || isEnded(sp)) return;
    }
    setPlacements((c0) => {
      const cur = materialize(c0);
      // 같은 학생·요일·시간·주에 같은 과목이 이미 있으면 중복 안 만듦(과목이 다르면 따로 둠).
      if (cur.some((p) => p.studentId === studentId && p.day === day && p.slot === slot && p.week === target && (p.subject || "") === (subject || ""))) return cur;
      return [...cur, { id: newId(), studentId, week: target, day, slot, specialId, subject }];
    });
  }
  function movePlacement(placementId: string, day: number, slot: number) {
    setPlacements((c0) => {
      const src = c0.find((x) => x.id === placementId);
      if (!src) return c0;
      const cur = materialize(c0);
      // 비커스텀 주에서 기본 이름표를 옮기면, 방금 복제된 그 주 전용본을 옮긴다.
      const moveId = target !== BASE && src.week === BASE ? placementId + "@" + target : placementId;
      const mp = cur.find((x) => x.id === moveId);
      if (!mp || (mp.day === day && mp.slot === slot)) return cur;
      if (cur.some((x) => x.id !== moveId && x.studentId === mp.studentId && x.day === day && x.slot === slot && x.week === mp.week && (x.subject || "") === (mp.subject || ""))) return cur;
      return cur.map((x) => (x.id === moveId ? { ...x, day, slot } : x));
    });
  }
  function removePlacement(placementId: string) {
    setPlacements((c0) => {
      const src = c0.find((x) => x.id === placementId);
      if (!src) return c0;
      if (target === BASE || src.week === target) return c0.filter((x) => x.id !== placementId);
      // 비커스텀 주에서 빼기 = 그 주만(1회성) — 복제 후 대응본 제거.
      const cur = materialize(c0);
      return cur.filter((x) => x.id !== placementId + "@" + target);
    });
  }

  function onCellDrop(day: number, slot: number, cellSubject?: "math" | "eng") {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "new") {
      if (d.specialId) {
        addPlacement(d.studentId, day, slot, d.specialId);
        return;
      }
      const s = byId.get(d.studentId);
      if (!s) return;
      // 분할 칸이면 그 칸의 과목으로, 아니면 학생 소속(영어전용=영어, 그 외 수학)으로.
      const subj: "math" | "eng" = cellSubject || (engIds.has(s.id) && !mathIds.has(s.id) ? "eng" : "math");
      if (remainingOf(s, subj) > 0) addPlacement(s.id, day, slot, undefined, subj === "eng" ? "eng" : undefined);
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
    setStudents((cur) => cur.map((s) => (s.id === next.id ? { ...s, name: next.name, band: levelOf(next.grade), grade: next.grade } : s)));
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
    const el = document.getElementById("tts-export");
    if (!el || imgBusy) return;
    setImgBusy(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: null });
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

  // 지금 보는 주의 날짜 범위(월~일). 기본(BASE)이면 날짜 없음.
  const mon = mondayOf(TODAY, curWeek === BASE ? 0 : curWeek);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const weekRange = curWeek === BASE ? "매주 반복(고정)" : `${fmtMD(mon)} ~ ${fmtMD(sun)}`;
  // ‹ › 주 이동(기본 ↔ 주차).
  const moveWeek = (dir: number) => {
    const i = WEEK_SEQ.indexOf(curWeek);
    const ni = Math.max(0, Math.min(WEEK_SEQ.length - 1, (i < 0 ? 0 : i) + dir));
    setCurWeek(WEEK_SEQ[ni]);
  };

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

      {/* 기본 시간표(고정) ↔ 주차 네비. 기본을 고치면 모든 주에 반영, 주차에서 고치면 그 주만 1회성. */}
      <div className="tts-weekbar">
        <div className="tts-weeknav">
          <button className={"tts-seg" + (curWeek === BASE ? " on" : "")} onClick={() => setCurWeek(BASE)} title="매주 반복되는 고정 시간표">기본 시간표</button>
          <div className="tts-weekstep">
            <button className="tts-weekstep-arr" onClick={() => moveWeek(-1)} disabled={WEEK_SEQ.indexOf(curWeek) <= 0} aria-label="이전">‹</button>
            <span className="tts-weekstep-lbl">{weekLabelOf(curWeek)}</span>
            <button className="tts-weekstep-arr" onClick={() => moveWeek(1)} disabled={WEEK_SEQ.indexOf(curWeek) >= WEEK_SEQ.length - 1} aria-label="다음">›</button>
          </div>
        </div>
        <span className="tts-weekrange">
          <Icon name="cal" /> {weekRange}{curWeek !== BASE && curIsCustom ? " · 이 주만 수정됨" : ""}
        </span>
        <div className="tts-subjseg">
          {([["all", "전체"], ["math", "수학"], ["eng", "영어"]] as const).map(([v, l]) => (
            <button key={v} className={"tts-seg" + (subjectFilter === v ? " on" : "")} onClick={() => setSubjectFilter(v)}>{l}</button>
          ))}
        </div>
        <div className="tts-subjseg" title="학년별 보기">
          {(["all", "초", "중", "고"] as const).map((g) => (
            <button key={g} className={"tts-seg" + (gradeFilter === g ? " on" : "")} onClick={() => setGradeFilter(g)}>{g === "all" ? "전체" : g}</button>
          ))}
        </div>
        <div className="tts-subjseg" title="요일별 보기">
          <button className={"tts-seg" + (dayFilter === "all" ? " on" : "")} onClick={() => setDayFilter("all")}>전체</button>
          {days.map((d) => (
            <button key={d} className={"tts-seg" + (dayFilter === d ? " on" : "")} onClick={() => setDayFilter(d)}>{DOW[d]}</button>
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

      {/* 선생님 보기 — 학생 목록을 특강 아래 가로 칩으로. 칩을 끌어 칸에 놓고, 칩 영역으로 끌면 배치 취소. */}
      {mode === "teacher" && !loading && (
        <div
          className="tts-chiprow-wrap"
          onDragOver={(e) => { if (drag.current?.kind === "move") { e.preventDefault(); e.currentTarget.classList.add("tts-drop-cancel"); } }}
          onDragLeave={(e) => e.currentTarget.classList.remove("tts-drop-cancel")}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("tts-drop-cancel"); onUnplaceDrop(); }}
        >
          <div className="tts-chiprow-head">
            <span className="tts-chiprow-ttl">학생 목록 {students.length > 0 && <b>{students.length}</b>}</span>
            <input className="input tts-chip-search" value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder="학생 이름 검색" />
            <span className="tts-chiprow-hint">칩을 끌어 칸에 놓아요 · 칩 영역으로 끌면 배치 취소</span>
          </div>
          <div className="tts-chips">
            {students
              .filter((s) => (subjectFilter === "all" ? true : subjectFilter === "eng" ? engIds.has(s.id) : mathIds.has(s.id)))
              .filter((s) => gradeFilter === "all" || divOf(s.band) === gradeFilter)
              .filter((s) => !pickQ.trim() || s.name.includes(pickQ.trim()))
              .map((s) => {
                const sj: "math" | "eng" = subjectFilter === "eng" ? "eng" : subjectFilter === "math" ? "math" : engIds.has(s.id) && !mathIds.has(s.id) ? "eng" : "math";
                const showBudget = subjectFilter !== "all";
                const rem = remainingOf(s, sj);
                const full = showBudget && rem <= 0;
                return (
                  <span
                    key={s.id}
                    className={"tts-chip tts-" + s.band + (full ? " full" : "")}
                    draggable={!full}
                    onDragStart={() => { if (!full) drag.current = { kind: "new", studentId: s.id }; }}
                    onDragEnd={() => { drag.current = null; }}
                    title={full ? "남은 블록을 다 채웠어요" : "끌어서 시간표 칸에 놓아요"}
                  >
                    <button type="button" className="tts-chip-nm" onClick={() => openProfile(s.id)} title="학생 상세 보기">{s.name}</button>
                    <span className="tts-chip-lv">{LEVEL_LABEL[s.band as Level]}{subjectFilter === "all" ? ` · ${sj === "eng" ? "영" : "수"}` : ""}</span>
                    {showBudget && <span className={"tts-chip-rem" + (full ? " done" : "")} title="남은 블록">{full ? "꽉참" : rem}</span>}
                  </span>
                );
              })}
            {students.filter((s) => (subjectFilter === "all" ? true : subjectFilter === "eng" ? engIds.has(s.id) : mathIds.has(s.id))).filter((s) => gradeFilter === "all" || divOf(s.band) === gradeFilter).filter((s) => !pickQ.trim() || s.name.includes(pickQ.trim())).length === 0 && (
              <span className="tts-hint">학생이 없어요.</span>
            )}
          </div>
        </div>
      )}

      {/* 학생 보기 — 시간표 위에서 학생을 검색해 선택. */}
      {mode === "student" && !loading && (
        <div className="tts-studentpick">
          <span className="tts-studentpick-l">볼 학생</span>
          <input className="input tts-studentpick-search" value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder="학생 이름 검색" />
          {pickQ.trim() && (
            <div className="tts-studentpick-results">
              {(() => {
                const res = students
                  .filter((s) => (subjectFilter === "eng" ? engIds.has(s.id) : subjectFilter === "math" ? mathIds.has(s.id) : true))
                  .filter((s) => s.name.includes(pickQ.trim()))
                  .slice(0, 16);
                if (!res.length) return <span className="tts-hint">검색 결과가 없어요.</span>;
                return res.map((s) => (
                  <button key={s.id} className={"tts-pick tts-pick-" + s.band + (focusStudent === s.id ? " on" : "")} onClick={() => { setFocusStudent(s.id); setPickQ(""); }}>
                    <b>{s.name}</b> <span className="tts-level">{LEVEL_LABEL[s.band as Level]}</span>
                  </button>
                ));
              })()}
            </div>
          )}
          {focusStudent && byId.get(focusStudent) && (
            <span className="tts-studentpick-cur">선택됨 · <b>{byId.get(focusStudent)!.name}</b> <span className="tts-level">{LEVEL_LABEL[byId.get(focusStudent)!.band as Level]}</span></span>
          )}
        </div>
      )}

      <div className="tts-layout tts-layout-full">
        {/* 시간표 영역 */}
        <section className="tts-gridwrap">
          {loading ? (
            <p className="tts-hint">불러오는 중…</p>
          ) : mode === "teacher" ? (
            <Board
              days={daysShown}
              slots={slots}
              placements={gridPlacements}
              byId={byId}
              specById={specById}
              blockNo={blockNo}
              onPick={openProfile}
              editable
              drag={drag}
              onCellDrop={onCellDrop}
              onRemove={removePlacement}
              splitSubject
            />
          ) : focusStudent && byId.get(focusStudent) ? (
            <div className="tts-studentview">
              <div className="tts-sv-head tts-sv-head-row">
                <span className="tts-sv-cap">
                  <b>{byId.get(focusStudent)!.name}</b>{" "}
                  <span className="tts-level">{LEVEL_LABEL[byId.get(focusStudent)!.band as Level]}</span> 학생의{" "}
                  {curWeek === BASE
                    ? <><b>기본 시간표</b>예요(수학·영어 함께, 매주 반복되는 고정 시간표). 여기서 고치면 모든 주에 반영돼요.</>
                    : <><b>{weekLabelOf(curWeek)}</b> 시간표예요(기본 + 그 주 변경). 여기서 고치면 <b>그 주만</b> 바뀌어요.</>}
                  {canEdit && " ‘수정하기’로 칸을 체크하거나, 이름표 옆 ×로 빼요."}
                </span>
                <span className="tts-sv-actions">
                  {canEdit && (
                    <button className={"btn ghost sm" + (editCheck ? " on" : "")} onClick={() => setEditCheck((v) => !v)} title="체크박스로 수업을 켜고 끄며 편집">
                      <Icon name="edit" /> {editCheck ? "수정 닫기" : "수정하기"}
                    </button>
                  )}
                  <button className="btn ghost sm" onClick={saveStudentImage} disabled={imgBusy} title="이 학생 기본 시간표를 이미지로 저장(영수 포함)">
                    <Icon name="copy" /> {imgBusy ? "저장 중…" : "이미지 저장"}
                  </button>
                </span>
              </div>
              {canEdit && editCheck && (
                <CheckGridEditor
                  student={byId.get(focusStudent)!}
                  days={daysShown}
                  slots={slots}
                  cells={focusCells}
                  enrolledEng={engIds.has(focusStudent)}
                  enrolledMath={mathIds.has(focusStudent)}
                  remEng={remainingOf(byId.get(focusStudent)!, "eng")}
                  remMath={remainingOf(byId.get(focusStudent)!, "math")}
                  onToggle={toggleCheck}
                />
              )}
              <div id="tts-sv-capture" className="tts-sv-capture">
                <div className="tts-sv-cap-title">{byId.get(focusStudent)!.name} · {curWeek === BASE ? "기본 시간표" : weekLabelOf(curWeek)}</div>
                <Board
                  days={daysShown}
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
                  splitSubject
                />
              </div>
              {/* 이미지 저장 전용(화면 밖) — 깔끔한 병합 블록 카드. '이미지 저장'이 이 요소를 캡처해요. */}
              <div style={{ position: "absolute", left: -99999, top: 0, pointerEvents: "none" }} aria-hidden="true">
                <div id="tts-export" style={{ display: "inline-block", background: "#fbf3e2", padding: 18 }}>
                  <ExportTimetable
                    studentName={byId.get(focusStudent)!.name}
                    blocks={exportBlocks(weekVisible.filter((p) => p.studentId === focusStudent), specById)}
                    days={daysShown}
                    weekLabel={curWeek === BASE ? "기본 시간표" : weekLabelOf(curWeek)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="empty">위에서 학생을 검색해 선택해 주세요.</div>
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
