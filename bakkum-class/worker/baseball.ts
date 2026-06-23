/// <reference types="@cloudflare/workers-types" />
// 수학 야구(수학 전광판) 백엔드 — 스트라이크·볼·아웃.
// 출결(class_attendance)·숙제(class_homework)는 읽기만 하고, 수동 이벤트·규칙만 저장한다.
// 계산은 src/lib/baseball.ts(클라·워커 공용)로 일치시킨다.

import type { Env } from "./index";
import type { SessionUser } from "./auth";
import {
  DEFAULT_RULES,
  DEFAULT_BASEBALL_CONFIG,
  deriveAutoStrikes,
  computeBoard,
  type BaseballRule,
  type BaseballConfig,
  type BaseballEvent,
  type AttEntry,
  type HwEntry,
  type MathBoard,
} from "../src/lib/baseball";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
let bseq = 0;
function newId(): string {
  return `bb_${Date.now().toString(36)}${(bseq++).toString(36)}`;
}

let bbReady = false;
async function ensureTables(env: Env): Promise<void> {
  if (bbReady) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS class_math_baseball (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, kind TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 1, label TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL, by_name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_class_math_baseball_student ON class_math_baseball(student_id)"),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS class_math_baseball_rules (id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', points INTEGER NOT NULL DEFAULT 1, trigger_key TEXT NOT NULL DEFAULT 'manual', threshold INTEGER NOT NULL DEFAULT 50, enabled INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)"
    ),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS class_config (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')"),
  ]);
  bbReady = true;
}

async function loadRules(env: Env): Promise<BaseballRule[]> {
  const r = await env.DB.prepare("SELECT * FROM class_math_baseball_rules ORDER BY kind, sort").all<Record<string, unknown>>();
  const rows = r.results || [];
  if (!rows.length) return DEFAULT_RULES;
  return rows.map((x) => ({
    id: String(x.id),
    kind: (String(x.kind) === "ball" ? "ball" : "strike") as BaseballRule["kind"],
    label: String(x.label ?? ""),
    points: Math.max(1, Number(x.points) || 1),
    trigger: String(x.trigger_key ?? "manual") as BaseballRule["trigger"],
    threshold: Number(x.threshold) || 50,
    enabled: Number(x.enabled) !== 0,
    sort: Number(x.sort) || 0,
  }));
}

async function loadConfig(env: Env): Promise<BaseballConfig> {
  const row = await env.DB.prepare("SELECT v FROM class_config WHERE k='math_baseball_cfg'").first<{ v: string }>();
  if (!row?.v) return DEFAULT_BASEBALL_CONFIG;
  try {
    return { ...DEFAULT_BASEBALL_CONFIG, ...(JSON.parse(row.v) as Partial<BaseballConfig>) };
  } catch {
    return DEFAULT_BASEBALL_CONFIG;
  }
}

function eventsFromRows(rows: Record<string, unknown>[]): BaseballEvent[] {
  return rows.map((x) => ({
    id: String(x.id),
    studentId: String(x.student_id),
    kind: String(x.kind) as BaseballEvent["kind"],
    points: Math.max(0, Number(x.points) || 0),
    label: String(x.label ?? ""),
    ref: String(x.ref ?? "") || undefined,
    memo: String(x.memo ?? "") || undefined,
    ts: Number(x.ts) || 0,
    by: String(x.by_name ?? "") || undefined,
    createdAt: Number(x.created_at) || 0,
  }));
}

/** 한 학생의 전광판을 만든다(개별 조회용 — 출결·숙제·이벤트 직접 쿼리). */
async function boardForStudent(env: Env, sid: string, rules: BaseballRule[], cfg: BaseballConfig): Promise<MathBoard> {
  const [aRes, hRes, eRes] = await Promise.all([
    env.DB.prepare("SELECT att_key,status,attitude FROM class_attendance WHERE att_key LIKE ?").bind(`%|${sid}|%`).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id,student_id,date,completion,status FROM class_homework WHERE student_id=?").bind(sid).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM class_math_baseball WHERE student_id=?").bind(sid).all<Record<string, unknown>>(),
  ]);
  const att: AttEntry[] = (aRes.results || [])
    .map((r) => {
      const parts = String(r.att_key).split("|");
      return { attKey: String(r.att_key), studentId: parts[1] || "", date: parts[0] || "", time: parts[2] || "", status: String(r.status ?? ""), attitude: String(r.attitude ?? "") };
    })
    .filter((a) => a.studentId === sid);
  const hw: HwEntry[] = (hRes.results || []).map((r) => ({ id: String(r.id), studentId: String(r.student_id), date: String(r.date ?? ""), completion: Number(r.completion) || 0, status: String(r.status ?? "done") }));
  const autos = deriveAutoStrikes(att, hw, rules, cfg);
  return computeBoard(sid, autos, eventsFromRows(eRes.results || []), cfg);
}

/** 들어온 id를 쏘이지 로스터 id로 정규화. 로스터 id면 그대로, 아니면 online_id/출석번호로 매핑. */
async function resolveStudentId(env: Env, raw: string): Promise<string> {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    const s = await env.DB.prepare("SELECT id FROM students WHERE id=? AND (hidden IS NULL OR hidden=0)").bind(n).first();
    if (s) return String(n);
  }
  try {
    const m = await env.DB.prepare("SELECT student_id FROM class_student_meta WHERE online_id=? OR checkin_no=? LIMIT 1").bind(String(raw), String(raw)).first<{ student_id: string }>();
    if (m?.student_id) return String(m.student_id);
  } catch { /* ignore */ }
  return String(raw);
}

/** 수학 수강 학생 id 집합(class_student_meta.subjects에 'math'). */
async function mathStudentIds(env: Env): Promise<Set<string>> {
  const out = new Set<string>();
  const r = await env.DB.prepare("SELECT student_id, subjects FROM class_student_meta").all<{ student_id: string; subjects: string }>();
  for (const row of r.results || []) {
    let subs: string[] = [];
    try { const v = JSON.parse(String(row.subjects || "[]")); if (Array.isArray(v)) subs = v.map(String); } catch { /* csv fallback */ subs = String(row.subjects || "").split(",").map((x) => x.trim()); }
    if (subs.includes("math")) out.add(String(row.student_id));
  }
  return out;
}

/** 한 학생이 수학 수강인지. subjects에 math가 있거나, 수학 시간표·출결·숙제 기록이 있으면 수학생.
 *  (수학생 대부분은 meta 행이 없어 기록으로 판별 — 영어 meta가 있어도 수학을 따로 들으면 잡힌다.) */
export async function isMathStudent(env: Env, sid: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare("SELECT subjects FROM class_student_meta WHERE student_id=?").bind(sid).first<{ subjects: string }>();
    const raw = String(row?.subjects ?? "");
    if (raw) {
      let subs: string[] = [];
      try { const v = JSON.parse(raw); if (Array.isArray(v)) subs = v.map(String); } catch { subs = raw.split(",").map((x) => x.trim()); }
      if (subs.includes("math")) return true;
    }
  } catch { /* ignore */ }
  // 수학 시간표·출결·숙제 중 하나라도 있으면 수학생.
  try {
    if (await env.DB.prepare("SELECT 1 FROM class_lessons WHERE student_id=? LIMIT 1").bind(sid).first()) return true;
    if (await env.DB.prepare("SELECT 1 FROM class_attendance WHERE att_key LIKE ? LIMIT 1").bind(`%|${sid}|%`).first()) return true;
    if (await env.DB.prepare("SELECT 1 FROM class_homework WHERE student_id=? LIMIT 1").bind(sid).first()) return true;
  } catch { /* ignore */ }
  return false;
}

/** 학생 페이지(eng.ts)에서 호출 — 그 학생의 전광판(수학생 아니면 null). */
export async function baseballBoardFor(env: Env, sid: string): Promise<MathBoard | null> {
  await ensureTables(env);
  if (!(await isMathStudent(env, sid))) return null;
  const [rules, cfg] = await Promise.all([loadRules(env), loadConfig(env)]);
  return boardForStudent(env, sid, rules, cfg);
}

/** /api/baseball/* 라우터. me는 세션(없으면 null). 반환 null이면 매칭 안 됨. */
export async function handleBaseball(env: Env, request: Request, p: string, me: SessionUser | null): Promise<Response | null> {
  if (!p.startsWith("/api/baseball")) return null;
  await ensureTables(env);
  const url = new URL(request.url);
  const m = request.method;
  const isTeacher = !!me && (me.role === "admin" || me.role === "math");
  const isStudent = !!me && me.role === "student";

  // 키오스크 CORS 프리플라이트(읽기 전용).
  if (p === "/api/baseball/board" && m === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "x-read-token, authorization, content-type", "access-control-allow-methods": "GET, OPTIONS" } });
  }

  // 학생 전광판 — (1) 키오스크(띵동) 읽기 토큰 또는 (2) 로그인 세션(학생 본인/선생님).
  if (p === "/api/baseball/board" && m === "GET") {
    const token = env.KIOSK_READ_TOKEN || "";
    const provided = request.headers.get("x-read-token") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    const viaToken = !!token && provided === token;

    let sid = String(url.searchParams.get("student_id") || url.searchParams.get("online_id") || "");
    if (!viaToken) {
      if (!me) return json({ error: "forbidden" }, 403);
      if (isStudent) sid = String(me.sub); // 학생은 본인 강제
      else if (!isTeacher) return json({ error: "forbidden" }, 403);
    }
    if (!sid) return json({ error: "student_required" }, 400);

    sid = await resolveStudentId(env, sid); // 띵동 id가 로스터 id와 다르면 online_id/출석번호로 매핑
    const board = await baseballBoardFor(env, sid);
    let photo = "";
    try { const r = await env.DB.prepare("SELECT photo FROM class_student_meta WHERE student_id=?").bind(sid).first<{ photo: string }>(); photo = String(r?.photo ?? ""); } catch { /* ignore */ }
    // 키오스크가 PULL 확인용으로 쓰는 표식 + CORS(읽기 전용).
    return new Response(JSON.stringify({ source: "soez", studentId: sid, board, photo }), {
      headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" },
    });
  }

  // 이 아래는 선생님(수학·원장) 전용.
  if (!isTeacher) return json({ error: "forbidden" }, 403);

  // 반 전체 현황 + 규칙 + 기준값(선생님 관리 화면).
  if (p === "/api/baseball/class" && m === "GET") {
    const [rules, cfg, mathSet] = await Promise.all([loadRules(env), loadConfig(env), mathStudentIds(env)]);
    // 한 번에 모아서 학생별로 나눠 계산(쿼리 폭주 방지).
    const [aRes, hRes, eRes, sRes] = await Promise.all([
      env.DB.prepare("SELECT att_key,status,attitude FROM class_attendance").all<Record<string, unknown>>(),
      env.DB.prepare("SELECT id,student_id,date,completion,status FROM class_homework").all<Record<string, unknown>>(),
      env.DB.prepare("SELECT * FROM class_math_baseball").all<Record<string, unknown>>(),
      env.DB.prepare("SELECT id,name,grade FROM students WHERE hidden IS NULL OR hidden=0").all<{ id: number; name: string; grade: string }>(),
    ]);
    const attBy: Record<string, AttEntry[]> = {};
    for (const r of aRes.results || []) {
      const parts = String(r.att_key).split("|");
      const sid = parts[1] || "";
      if (!mathSet.has(sid)) continue;
      (attBy[sid] ||= []).push({ attKey: String(r.att_key), studentId: sid, date: parts[0] || "", time: parts[2] || "", status: String(r.status ?? ""), attitude: String(r.attitude ?? "") });
    }
    const hwBy: Record<string, HwEntry[]> = {};
    for (const r of hRes.results || []) {
      const sid = String(r.student_id);
      if (!mathSet.has(sid)) continue;
      (hwBy[sid] ||= []).push({ id: String(r.id), studentId: sid, date: String(r.date ?? ""), completion: Number(r.completion) || 0, status: String(r.status ?? "done") });
    }
    const evBy: Record<string, BaseballEvent[]> = {};
    for (const e of eventsFromRows(eRes.results || [])) (evBy[e.studentId] ||= []).push(e);

    const students = (sRes.results || [])
      .filter((s) => mathSet.has(String(s.id)))
      .map((s) => {
        const sid = String(s.id);
        const autos = deriveAutoStrikes(attBy[sid] || [], hwBy[sid] || [], rules, cfg);
        const ev = evBy[sid] || [];
        const board = computeBoard(sid, autos, ev, cfg);
        // 관리·수정용 로그 — 자동 스트라이크(무효화 가능) + 수동 이벤트(삭제·수정 가능).
        const ignoreBy = new Map<string, string>();
        for (const e of ev) if (e.kind === "ignore_auto" && e.ref) ignoreBy.set(e.ref, e.id);
        const log = [
          ...autos.map((a) => ({ id: a.id, source: "auto" as const, kind: "strike", label: a.label, date: a.date, points: a.points, ignored: ignoreBy.has(a.id), ignoreEventId: ignoreBy.get(a.id) || "", memo: "" })),
          ...ev.filter((e) => e.kind !== "ignore_auto").map((e) => ({ id: e.id, source: "manual" as const, kind: e.kind, label: e.label, date: new Date(e.ts + 9 * 3600 * 1000).toISOString().slice(0, 10), points: e.points, ignored: false, ignoreEventId: "", memo: e.memo || "" })),
        ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        return { id: sid, name: String(s.name ?? ""), grade: String(s.grade ?? ""), board, log };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return json({ rules, cfg, students });
  }

  // 규칙(벌·상 항목) + 기준값 저장(전체 교체).
  if (p === "/api/baseball/rules" && m === "GET") {
    const [rules, cfg] = await Promise.all([loadRules(env), loadConfig(env)]);
    return json({ rules, cfg });
  }
  if (p === "/api/baseball/rules" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { rules?: BaseballRule[]; cfg?: Partial<BaseballConfig> };
    if (Array.isArray(b.rules)) {
      await env.DB.prepare("DELETE FROM class_math_baseball_rules").run();
      const now = Date.now();
      const stmts = b.rules
        .filter((r) => r && r.label && r.label.trim())
        .map((r, i) =>
          env.DB
            .prepare("INSERT INTO class_math_baseball_rules(id,kind,label,points,trigger_key,threshold,enabled,sort,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
            .bind(String(r.id || newId()), r.kind === "ball" ? "ball" : "strike", String(r.label).trim(), Math.max(1, Number(r.points) || 1), String(r.trigger || "manual"), Number(r.threshold) || 50, r.enabled === false ? 0 : 1, Number(r.sort) || i, now)
        );
      if (stmts.length) await env.DB.batch(stmts);
    }
    if (b.cfg && typeof b.cfg === "object") {
      const merged: BaseballConfig = { ...DEFAULT_BASEBALL_CONFIG, ...(await loadConfig(env)), ...b.cfg };
      await env.DB.prepare("INSERT INTO class_config(k,v) VALUES('math_baseball_cfg',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(JSON.stringify(merged)).run();
    }
    return json({ ok: true });
  }

  // 이벤트 추가(볼 주기·취소·면제·보충완료·자동무효화).
  if (p === "/api/baseball/event" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Partial<BaseballEvent> & { studentId?: string };
    const sid = String(b.studentId || "");
    const kind = String(b.kind || "");
    const ok = ["ball", "strike", "cancel_strike", "exempt_out", "makeup_done", "ignore_auto"];
    if (!sid || !ok.includes(kind)) return json({ error: "bad_input" }, 400);
    const id = newId();
    const now = Date.now();
    const ts = Number(b.ts) || now;
    await env.DB
      .prepare("INSERT INTO class_math_baseball(id,student_id,kind,points,label,ref,memo,ts,by_name,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(id, sid, kind, Math.max(0, Number(b.points) || (kind === "makeup_done" || kind === "ignore_auto" ? 0 : 1)), String(b.label || ""), String(b.ref || ""), String(b.memo || ""), ts, me?.name || "", now)
      .run();
    return json({ ok: true, id });
  }

  // 이벤트 수정(메모·사유·가중치) — id로.
  if (p === "/api/baseball/event" && m === "PUT") {
    const b = (await request.json().catch(() => ({}))) as Partial<BaseballEvent> & { id?: string };
    const id = String(b.id || "");
    if (!id) return json({ error: "bad_input" }, 400);
    await env.DB
      .prepare("UPDATE class_math_baseball SET points=?, label=?, memo=? WHERE id=?")
      .bind(Math.max(0, Number(b.points) || 1), String(b.label || ""), String(b.memo || ""), id)
      .run();
    return json({ ok: true });
  }

  // 이벤트 삭제 — 되돌리기/오입력 정정.
  if ((p === "/api/baseball/event" && m === "DELETE")) {
    const id = String(url.searchParams.get("id") || "");
    if (!id) return json({ error: "bad_input" }, 400);
    await env.DB.prepare("DELETE FROM class_math_baseball WHERE id=?").bind(id).run();
    return json({ ok: true });
  }

  return json({ error: "not_found" }, 404);
}
