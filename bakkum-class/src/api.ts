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
  return { students, makeups, attendance };
}

function saveLocal(snap: DataSnapshot): void {
  localStorage.setItem(STORE_S, JSON.stringify(snap.students));
  localStorage.setItem(STORE_M, JSON.stringify(snap.makeups));
  localStorage.setItem(STORE_A, JSON.stringify(snap.attendance));
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

async function flush(): Promise<void> {
  if (!pending) return;
  const snap = pending;
  pending = null;
  saveTimer = null;
  try {
    await fetch("/api/data", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snap),
    });
  } catch {
    /* best-effort; in-memory state remains authoritative for the session */
  }
}
