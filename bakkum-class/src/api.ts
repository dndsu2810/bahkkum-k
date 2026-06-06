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
  };
}

function saveLocal(snap: DataSnapshot): void {
  localStorage.setItem(STORE_S, JSON.stringify(snap.students));
  localStorage.setItem(STORE_M, JSON.stringify(snap.makeups));
  localStorage.setItem(STORE_A, JSON.stringify(snap.attendance));
  localStorage.setItem(STORE_H, JSON.stringify(snap.homeworkLog));
  localStorage.setItem(STORE_P, JSON.stringify(snap.progressLog));
}

export async function loadData(): Promise<DataSnapshot> {
  await detectMode();
  if (mode === "remote") {
    const r = await fetch("/api/data", { cache: "no-store" });
    if (r.ok) return (await r.json()) as DataSnapshot;
    // fall through to local on unexpected error
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

/* ---------------- Notion integration ---------------- */
/** Pull 재원 students from Notion into D1 (remote only). */
export async function syncStudents(): Promise<{ synced: number; total?: number; error?: string }> {
  if (mode !== "remote") return { synced: 0, error: "백엔드 없음 (배포 환경에서만 동작)" };
  try {
    const r = await fetch("/api/sync/students", { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as { synced?: number; total?: number; error?: string };
    if (r.ok) return { synced: j.synced ?? 0, total: j.total };
    return { synced: 0, error: j.error || "HTTP " + r.status };
  } catch (e) {
    return { synced: 0, error: String(e) };
  }
}

/** Fire-and-forget push of an app record to Notion (best-effort; never throws). */
function notionPush(path: string, body: unknown): void {
  if (mode !== "remote") return;
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(
    () => {}
  );
}
export function pushHomeworkNotion(
  studentId: string,
  h: { date: string; book: string; tags: string[]; completion: number; done: boolean; memo: string }
): void {
  notionPush("/api/notion/homework", { studentId, ...h });
}
export function pushProgressNotion(
  studentId: string,
  p: { unit: string; area: string; pct: number; startDate: string; memo: string }
): void {
  notionPush("/api/notion/progress", { studentId, ...p });
}

/** Import 3월~ 노션 기록(숙제/진도/출결) into D1. Remote only.
 *  타입별로 순차 호출 — 한 번에 다 하면 워커 타임아웃. */
export async function importRecords(): Promise<{ homework: number; progress: number; attendance: number; error?: string }> {
  if (mode !== "remote") return { homework: 0, progress: 0, attendance: 0, error: "백엔드 없음" };
  const totals = { homework: 0, progress: 0, attendance: 0 } as {
    homework: number;
    progress: number;
    attendance: number;
    error?: string;
  };
  for (const type of ["homework", "progress", "attendance"] as const) {
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
