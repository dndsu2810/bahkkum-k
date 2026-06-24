/// <reference types="@cloudflare/workers-types" />
// 번호표(대기순번) + 호출 — 영어/수학 과목별. 매일 자정(KST) 기준 1번부터(date 스코프).
// 학생: 뽑기·내 순번·손들기. 강사: 대기열 조회·호출·완료.

import type { Env } from "./index";
import type { SessionUser } from "./auth";
import { kstToday } from "./briefing";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
let qseq = 0;
function newId(): string {
  return `q_${Date.now().toString(36)}${(qseq++).toString(36)}`;
}

let qReady = false;
async function ensure(env: Env): Promise<void> {
  if (qReady) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS class_queue (id TEXT PRIMARY KEY, subject TEXT NOT NULL, student_id TEXT NOT NULL, student_name TEXT NOT NULL DEFAULT '', number INTEGER NOT NULL DEFAULT 0, date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', raised INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, called_at INTEGER NOT NULL DEFAULT 0, done_at INTEGER NOT NULL DEFAULT 0)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_class_queue_sd ON class_queue(subject, date, status)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_class_queue_stu ON class_queue(student_id, date)"),
  ]);
  qReady = true;
}

const SUBJECTS = ["english", "math"];
const okSubject = (s: unknown) => (SUBJECTS.includes(String(s)) ? String(s) : "");

async function enrolledSubjects(env: Env, sid: string): Promise<string[]> {
  let subs: string[] = [];
  try {
    const r = await env.DB.prepare("SELECT subjects FROM class_student_meta WHERE student_id=?").bind(sid).first<{ subjects: string }>();
    const raw = String(r?.subjects ?? "");
    if (raw) {
      try { const v = JSON.parse(raw); if (Array.isArray(v)) subs = v.map(String); } catch { subs = raw.split(",").map((x) => x.trim()); }
    }
  } catch { /* ignore */ }
  const out = subs.filter((s) => s === "math" || s === "english");
  return out.length ? out : ["english"]; // meta 없으면 영어 학생으로 본다(학생 페이지가 영어 기준)
}

/** 한 학생의 과목별 활성 티켓 + 앞에 몇 명. */
async function myTicket(env: Env, sid: string, subject: string, date: string): Promise<{ number: number; status: string; ahead: number; raised: boolean } | null> {
  const t = await env.DB.prepare("SELECT number,status,raised FROM class_queue WHERE subject=? AND student_id=? AND date=? AND status!='done' ORDER BY created_at DESC LIMIT 1").bind(subject, sid, date).first<{ number: number; status: string; raised: number }>();
  if (!t) return null;
  const a = await env.DB.prepare("SELECT COUNT(*) n FROM class_queue WHERE subject=? AND date=? AND status!='done' AND number<?").bind(subject, date, t.number).first<{ n: number }>();
  return { number: Number(t.number), status: String(t.status), ahead: Number(a?.n ?? 0), raised: !!t.raised };
}

export async function handleQueue(env: Env, request: Request, p: string, me: SessionUser | null): Promise<Response | null> {
  if (!p.startsWith("/api/queue")) return null;
  await ensure(env);
  if (!me) return json({ error: "forbidden" }, 403);
  const m = request.method;
  const url = new URL(request.url);
  const date = kstToday().date;
  const isStudent = me.role === "student";

  /* ---------- 학생 ---------- */
  if (p === "/api/queue/mine" && m === "GET") {
    if (!isStudent) return json({ error: "forbidden" }, 403);
    const subjects = await enrolledSubjects(env, me.sub);
    const tickets: Record<string, unknown> = {};
    for (const s of subjects) tickets[s] = await myTicket(env, me.sub, s, date);
    return json({ subjects, tickets });
  }

  if (p === "/api/queue/draw" && m === "POST") {
    if (!isStudent) return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as { subject?: string };
    const subject = okSubject(b.subject);
    if (!subject) return json({ error: "bad_subject" }, 400);
    const existing = await myTicket(env, me.sub, subject, date);
    if (!existing) {
      const mx = await env.DB.prepare("SELECT COALESCE(MAX(number),0)+1 n FROM class_queue WHERE subject=? AND date=?").bind(subject, date).first<{ n: number }>();
      const number = Number(mx?.n ?? 1);
      await env.DB.prepare("INSERT INTO class_queue(id,subject,student_id,student_name,number,date,status,raised,created_at) VALUES(?,?,?,?,?,?,'waiting',0,?)")
        .bind(newId(), subject, me.sub, me.name, number, date, Date.now()).run();
    }
    return json({ ticket: await myTicket(env, me.sub, subject, date) });
  }

  if (p === "/api/queue/raise" && m === "POST") {
    if (!isStudent) return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as { subject?: string };
    const subject = okSubject(b.subject);
    if (!subject) return json({ error: "bad_subject" }, 400);
    await env.DB.prepare("UPDATE class_queue SET raised=1 WHERE subject=? AND student_id=? AND date=? AND status!='done'").bind(subject, me.sub, date).run();
    return json({ ok: true });
  }

  if (p === "/api/queue/cancel" && m === "POST") {
    if (!isStudent) return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as { subject?: string };
    const subject = okSubject(b.subject);
    if (!subject) return json({ error: "bad_subject" }, 400);
    await env.DB.prepare("UPDATE class_queue SET status='done', done_at=? WHERE subject=? AND student_id=? AND date=? AND status!='done'").bind(Date.now(), subject, me.sub, date).run();
    return json({ ok: true });
  }

  /* ---------- 강사(학생 제외) ---------- */
  if (isStudent) return json({ error: "forbidden" }, 403);

  if (p === "/api/queue/list" && m === "GET") {
    const subject = okSubject(url.searchParams.get("subject"));
    if (!subject) return json({ error: "bad_subject" }, 400);
    const r = await env.DB.prepare("SELECT id,number,student_name,status,raised FROM class_queue WHERE subject=? AND date=? AND status!='done' ORDER BY number ASC").bind(subject, date).all<Record<string, unknown>>();
    const list = (r.results || []).map((x) => ({ id: String(x.id), number: Number(x.number), name: String(x.student_name ?? ""), status: String(x.status), raised: !!x.raised }));
    return json({ list });
  }

  if (p === "/api/queue/call" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "bad_input" }, 400);
    await env.DB.prepare("UPDATE class_queue SET status='called', raised=0, called_at=? WHERE id=?").bind(Date.now(), String(b.id)).run();
    return json({ ok: true });
  }

  if (p === "/api/queue/done" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "bad_input" }, 400);
    await env.DB.prepare("UPDATE class_queue SET status='done', raised=0, done_at=? WHERE id=?").bind(Date.now(), String(b.id)).run();
    return json({ ok: true });
  }

  return json({ error: "not_found" }, 404);
}
