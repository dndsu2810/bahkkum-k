import type { DataSnapshot, Student } from "./types";
import { uid } from "./lib/dates";

/* ------------------------------------------------------------------
   Data layer — full-snapshot model.
   - Production (Cloudflare Worker present): GET/PUT /api/data against D1.
   - Dev / static (no worker): localStorage, mirroring the prototype.
   The mode is detected once at startup via /api/health.
------------------------------------------------------------------- */

const STORE_S = "bk_students";
const STORE_M = "bk_makeups";
const STORE_A = "bk_attendance";
const STORE_H = "bk_homework";
const STORE_P = "bk_progress";
const STORE_T = "bk_tests";
const STORE_D = "bk_dismissed_makeups";

function readArr<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]") || [];
  } catch {
    return [];
  }
}

let mode: "local" | "remote" = "local";

async function detectMode(): Promise<void> {
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    if (r.ok) {
      mode = "remote";
      return;
    }
  } catch {
    /* ignore */
  }
  mode = "local";
}

function loadLocal(): DataSnapshot {
  let students = null;
  let makeups = null;
  let attendance: DataSnapshot["attendance"] = {};
  try {
    students = JSON.parse(localStorage.getItem(STORE_S) || "null");
  } catch {
    students = null;
  }
  try {
    makeups = JSON.parse(localStorage.getItem(STORE_M) || "null");
  } catch {
    makeups = null;
  }
  try {
    attendance = JSON.parse(localStorage.getItem(STORE_A) || "{}") || {};
  } catch {
    attendance = {};
  }
  // No demo seeding — a fresh install starts empty.
  if (!students) students = [];
  if (!makeups) makeups = [];
  return {
    students,
    makeups,
    attendance,
    homeworkLog: readArr(STORE_H),
    progressLog: readArr(STORE_P),
    testLog: readArr(STORE_T),
    dismissedMakeups: readArr<string>(STORE_D),
  };
}

function saveLocal(snap: DataSnapshot): void {
  localStorage.setItem(STORE_S, JSON.stringify(snap.students));
  localStorage.setItem(STORE_M, JSON.stringify(snap.makeups));
  localStorage.setItem(STORE_A, JSON.stringify(snap.attendance));
  localStorage.setItem(STORE_H, JSON.stringify(snap.homeworkLog));
  localStorage.setItem(STORE_P, JSON.stringify(snap.progressLog));
  localStorage.setItem(STORE_T, JSON.stringify(snap.testLog));
  localStorage.setItem(STORE_D, JSON.stringify(snap.dismissedMakeups || []));
}

export async function loadData(): Promise<DataSnapshot> {
  await detectMode();
  if (mode === "remote") {
    // 원격 모드에서는 빈 localStorage로 폴백하지 않는다.
    // (폴백하면 화면이 비어 보이고, 이후 저장 시 원격 D1을 덮어쓸 위험)
    let r: Response;
    try {
      r = await fetch("/api/data", { cache: "no-store" });
    } catch (e) {
      throw new Error("데이터를 불러오지 못했어요 (네트워크): " + String(e));
    }
    if (r.ok) return (await r.json()) as DataSnapshot;
    throw new Error("데이터를 불러오지 못했어요 (서버 " + r.status + ")");
  }
  return loadLocal();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pending: DataSnapshot | null = null;

/** Persist the full snapshot. Remote writes are debounced & coalesced. */
export function saveData(snap: DataSnapshot): void {
  if (mode === "local") {
    saveLocal(snap);
    return;
  }
  pending = snap;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

/**
 * Create (or link by name to) a roster student in the shared `students` table
 * and return its id. Remote only allocates the real roster id; in dev/local
 * mode it returns a local uid so the app still works without a backend.
 */
export async function createStudent(fields: Partial<Student> & { name: string }): Promise<{ id: string }> {
  if (mode === "remote") {
    try {
      const r = await fetch("/api/students", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (r.ok) return (await r.json()) as { id: string };
    } catch {
      /* fall through to local id */
    }
  }
  return { id: uid() };
}

/** App-only delete: hide a roster student (remote sets students.hidden=1).
 *  Never touches Notion. No-op in dev/local (client just drops it from state). */
export async function hideStudent(studentId: string): Promise<void> {
  if (mode !== "remote") return;
  try {
    await fetch("/api/students/hide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: studentId }),
    });
  } catch {
    /* ignore */
  }
}

// 출석 적립 점수 — '포인트 항목' 카탈로그의 '출석' 점수(수학·영어 통일). 로드 전 기본 100.
let attPoint = 100;
/** 현재 출석 적립 점수(카탈로그 반영). 키오스크가 읽는 students.points에 이 값으로 적립. */
export function attendancePoints(): number {
  return attPoint;
}
/** 포인트 항목 카탈로그에서 '출석' 점수를 읽어온다(없으면 기본 100 유지). */
export async function loadPointCatalog(): Promise<void> {
  if (mode !== "remote") return;
  try {
    const r = await fetch("/api/points/catalog", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { reasons?: { name: string; value: number }[] };
    const found = (j.reasons || []).find((x) => /^출석\b/.test(String(x.name)) && !/취소/.test(String(x.name)));
    if (found) {
      const m = /(-?\d+)\s*$/.exec(String(found.name));
      attPoint = m ? parseInt(m[1], 10) : Number(found.value) || attPoint;
    }
  } catch {
    /* 실패 시 기본값 유지 */
  }
}

/**
 * Award/revoke points for a roster student (by id) and keep students.points
 * in sync. Remote only — a no-op in dev/local mode. Returns { matched:false }
 * when the id isn't a roster student.
 */
export async function awardPoints(
  studentId: string,
  delta: number,
  reason: string
): Promise<{ matched: boolean }> {
  if (mode !== "remote") return { matched: false };
  try {
    const r = await fetch("/api/points", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentId, delta, reason }),
    });
    if (r.ok) return (await r.json()) as { matched: boolean };
  } catch {
    /* ignore */
  }
  return { matched: false };
}

/* ---------------- 학원 일정 (노션 → 앱, 읽기 전용) ---------------- */
export interface ScheduleItem {
  id: string;
  title: string;
  date: string;
  dateEnd: string;
  isDatetime: boolean;
  category: string;
  status: string;
}
export async function fetchSchedule(since?: string): Promise<{ items: ScheduleItem[]; error?: string }> {
  if (mode !== "remote") return { items: [], error: "백엔드 없음 (배포 환경에서만 동작)" };
  try {
    const r = await fetch("/api/schedule" + (since ? "?since=" + since : ""), { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as { items?: ScheduleItem[]; error?: string };
    if (r.ok) return { items: j.items || [], error: j.error };
    return { items: [], error: j.error || "HTTP " + r.status };
  } catch (e) {
    return { items: [], error: String(e) };
  }
}

/* ---------------- Notion integration ---------------- */
/** 노션 학생 DB → 앱(단방향). 노션 페이지 ID로 비교해 추가/수정/변화없음을 센다. */
export interface SyncStudentsResult {
  added: number;
  updated: number;
  unchanged: number;
  total?: number;
  error?: string;
}
export async function syncStudents(): Promise<SyncStudentsResult> {
  if (mode !== "remote") return { added: 0, updated: 0, unchanged: 0, error: "백엔드 없음 (배포 환경에서만 동작)" };
  try {
    const r = await fetch("/api/sync/students", { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as Partial<SyncStudentsResult>;
    if (r.ok) return { added: j.added ?? 0, updated: j.updated ?? 0, unchanged: j.unchanged ?? 0, total: j.total };
    return { added: 0, updated: 0, unchanged: 0, error: j.error || "HTTP " + r.status };
  } catch (e) {
    return { added: 0, updated: 0, unchanged: 0, error: String(e) };
  }
}

/** Fire-and-forget push of an app record to Notion (best-effort; never throws). */
// 수학 기록(출결·숙제·진도·테스트)을 노션에 더 이상 푸시하지 않음 — 앱 D1이 단일 출처.
// (학생명단 노션→앱 읽기 동기화는 그대로.) 다시 켜려면 아래 주석의 fetch 복원.
function notionPush(_path: string, _body: unknown): void {
  return;
  // if (mode !== "remote") return;
  // fetch(_path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(_body) }).catch(() => {});
}
/** 출결 → 노션(앱→노션 단방향). 같은 학생·같은 날짜의 연속 변경은 모아 마지막 상태만
 *  보낸다(중복 행/과다 호출 방지). 서버는 (학생,날짜) 기준 upsert. */
const attPushTimers: Record<string, ReturnType<typeof setTimeout>> = {};
export function pushAttendanceNotion(
  studentId: string,
  a: { date: string; status: string; attitude: string; lateMinutes: number; note: string }
): void {
  if (mode !== "remote") return;
  const k = studentId + "|" + a.date;
  if (attPushTimers[k]) clearTimeout(attPushTimers[k]);
  attPushTimers[k] = setTimeout(() => {
    delete attPushTimers[k];
    notionPush("/api/notion/attendance", { studentId, ...a });
  }, 1200);
}
/** 숙제 → 노션(앱→노션). 같은 학생·같은 마감일의 연속 변경(내용·완성도·검사)은 모아
 *  마지막 상태만 보낸다(중복 행/과다 호출 방지). 서버는 (학생,마감일) 기준 upsert. */
const hwPushTimers: Record<string, ReturnType<typeof setTimeout>> = {};
export function pushHomeworkNotion(
  studentId: string,
  h: { date: string; book: string; tags: string[]; completion: number; done: boolean; memo: string; checkOnly?: boolean; delayCount?: number }
): void {
  if (mode !== "remote") return;
  const k = studentId + "|" + h.date;
  if (hwPushTimers[k]) clearTimeout(hwPushTimers[k]);
  hwPushTimers[k] = setTimeout(() => {
    delete hwPushTimers[k];
    notionPush("/api/notion/homework", { studentId, ...h });
  }, 1200);
}
export function pushProgressNotion(
  studentId: string,
  p: { unit: string; area: string; pct: number; startDate: string; memo: string }
): void {
  notionPush("/api/notion/progress", { studentId, ...p });
}
/** 테스트 → 노션(앱→노션). 같은 학생·시험일·유형의 연속 인라인 수정은 모아 마지막만
 *  보낸다(중복 행/과다 호출 방지). 서버는 (학생,시험일,유형) 기준 upsert. */
const testPushTimers: Record<string, ReturnType<typeof setTimeout>> = {};
export function pushTestNotion(
  studentId: string,
  t: { date: string; type: string; round: string; range: string; score: number; status: string; memo: string }
): void {
  if (mode !== "remote") return;
  const k = studentId + "|" + t.date + "|" + t.type;
  if (testPushTimers[k]) clearTimeout(testPushTimers[k]);
  testPushTimers[k] = setTimeout(() => {
    delete testPushTimers[k];
    notionPush("/api/notion/test", { studentId, ...t });
  }, 1200);
}

/** Import 3월~ 노션 기록(숙제/진도/출결) into D1. Remote only.
 *  타입별로 순차 호출 — 한 번에 다 하면 워커 타임아웃. */
export async function importRecords(): Promise<{ homework: number; progress: number; attendance: number; test: number; error?: string }> {
  if (mode !== "remote") return { homework: 0, progress: 0, attendance: 0, test: 0, error: "백엔드 없음" };
  const totals = { homework: 0, progress: 0, attendance: 0, test: 0 } as {
    homework: number;
    progress: number;
    attendance: number;
    test: number;
    error?: string;
  };
  for (const type of ["homework", "progress", "attendance", "test"] as const) {
    try {
      const r = await fetch("/api/sync/records?type=" + type, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as any;
      if (!r.ok) return { ...totals, error: (j.error || "HTTP " + r.status) + " (" + type + ")" };
      totals[type] = j[type] ?? 0;
    } catch (e) {
      return { ...totals, error: String(e) + " (" + type + ")" };
    }
  }
  return totals;
}

/** 즉시(디바운스 없이) 저장하고 성공 여부를 반환. 인라인 수정의 저장 피드백용. */
export async function saveDataNow(snap: DataSnapshot): Promise<boolean> {
  if (mode === "local") {
    try {
      saveLocal(snap);
      return true;
    } catch {
      return false;
    }
  }
  // 대기 중이던 디바운스 저장과 겹치지 않게 정리
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pending = null;
  try {
    const r = await fetch("/api/data", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snap),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function flush(): Promise<void> {
  if (!pending) return;
  const snap = pending;
  pending = null;
  saveTimer = null;
  try {
    const r = await fetch("/api/data", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snap),
    });
    if (!r.ok) console.error("저장 실패(PUT /api/data):", r.status, await r.text().catch(() => ""));
  } catch (e) {
    console.error("저장 실패(PUT /api/data):", e);
  }
}
