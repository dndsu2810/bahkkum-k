/// <reference types="@cloudflare/workers-types" />
// Cloudflare Worker: serves the built SPA and the /api JSON API backed by D1.
//
// Runs INSIDE the shared `bakuum-production` D1 but only ever touches the
// `class_*` tables — the existing mogakgong tables are never read or written.
// No demo seeding: a fresh install starts empty.
//
// API surface (full-snapshot model, matching src/api.ts):
//   GET  /api/health  -> { ok: true }
//   GET  /api/data    -> DataSnapshot
//   PUT  /api/data    -> replaces all class_* data with the posted DataSnapshot

import type { DataSnapshot, Makeup, Student } from "../src/types";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p.startsWith("/api/")) {
      try {
        if (p === "/api/health") return json({ ok: true });
        if (p === "/api/data" && request.method === "GET") return json(await readSnapshot(env));
        if (p === "/api/data" && request.method === "PUT") return await putData(env, request);
        return json({ error: "not_found" }, 404);
      } catch (e) {
        return json({ error: "server_error", message: String(e) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

/* ---------------- read ---------------- */
async function readSnapshot(env: Env): Promise<DataSnapshot> {
  const [sRes, lRes, mRes, aRes] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM class_students"),
    env.DB.prepare("SELECT * FROM class_lessons ORDER BY student_id, sort_order"),
    env.DB.prepare("SELECT * FROM class_makeups"),
    env.DB.prepare("SELECT * FROM class_attendance"),
  ]);

  const lessonsByStudent: Record<string, { day: string; time: string; duration: number }[]> = {};
  for (const r of lRes.results as Record<string, unknown>[]) {
    const sid = String(r.student_id);
    (lessonsByStudent[sid] ||= []).push({
      day: String(r.day),
      time: String(r.time),
      duration: Number(r.duration),
    });
  }

  const students: Student[] = (sRes.results as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    grade: r.grade === "중등" ? "중등" : "초등",
    startDate: String(r.start_date),
    excluded: Number(r.excluded) === 1,
    lessons: lessonsByStudent[String(r.id)] || [],
  }));

  const makeups: Makeup[] = (mRes.results as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    studentId: String(r.student_id),
    absentDate: String(r.absent_date),
    absentTime: String(r.absent_time),
    absentDuration: Number(r.absent_duration),
    attKey: String(r.att_key),
    status: r.status as Makeup["status"],
    makeupDate: String(r.makeup_date),
    makeupTime: String(r.makeup_time),
    makeupDuration: Number(r.makeup_duration),
    parentContacted: Number(r.parent_contacted) === 1,
    memo: String(r.memo),
    createdAt: Number(r.created_at),
  }));

  const attendance: DataSnapshot["attendance"] = {};
  for (const r of aRes.results as Record<string, unknown>[]) {
    attendance[String(r.att_key)] = r.status === "absent" ? "absent" : "present";
  }

  return { students, makeups, attendance };
}

/* ---------------- write (replace all class_* data) ---------------- */
async function putData(env: Env, request: Request): Promise<Response> {
  const snap = (await request.json()) as DataSnapshot;
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM class_attendance"),
    env.DB.prepare("DELETE FROM class_makeups"),
    env.DB.prepare("DELETE FROM class_lessons"),
    env.DB.prepare("DELETE FROM class_students"),
  ];

  for (const s of snap.students) {
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_students(id,name,grade,start_date,excluded,created_at) VALUES(?,?,?,?,?,?)"
        )
        .bind(s.id, s.name, s.grade, s.startDate, s.excluded ? 1 : 0, Date.now())
    );
    (s.lessons || []).forEach((l, i) => {
      stmts.push(
        env.DB
          .prepare(
            "INSERT INTO class_lessons(id,student_id,day,time,duration,sort_order) VALUES(?,?,?,?,?,?)"
          )
          .bind(`${s.id}-${i}`, s.id, l.day, l.time, l.duration, i)
      );
    });
  }

  for (const k of snap.makeups) {
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_makeups(id,student_id,absent_date,absent_time,absent_duration,att_key,status,makeup_date,makeup_time,makeup_duration,parent_contacted,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
        )
        .bind(
          k.id,
          k.studentId,
          k.absentDate,
          k.absentTime,
          k.absentDuration,
          k.attKey,
          k.status,
          k.makeupDate,
          k.makeupTime,
          k.makeupDuration,
          k.parentContacted ? 1 : 0,
          k.memo,
          k.createdAt
        )
    );
  }

  for (const key of Object.keys(snap.attendance)) {
    stmts.push(
      env.DB.prepare("INSERT INTO class_attendance(att_key,status) VALUES(?,?)").bind(key, snap.attendance[key])
    );
  }

  await env.DB.batch(stmts);
  return json({ ok: true });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
