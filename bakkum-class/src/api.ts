import type { DataSnapshot } from "./types";

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
 * Award/revoke mogakgong points for a student (matched by name).
 * Remote only — in localStorage/dev mode there is no mogakgong DB, so it's a no-op.
 * Returns { matched } — false when no mogakgong student has that exact name.
 */
export async function awardPoints(
  name: string,
  delta: number,
  reason: string
): Promise<{ matched: boolean }> {
  if (mode !== "remote") return { matched: false };
  try {
    const r = await fetch("/api/points", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, delta, reason }),
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
