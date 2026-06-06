/// <reference types="@cloudflare/workers-types" />
// Cloudflare Worker: serves the built SPA and the /api JSON API backed by D1
// (the shared `bakuum-production` database).
//
// STUDENT ROSTER IS SHARED with the mogakgong `students` table:
//   - read  : the roster (id, name) comes from `students`; academic fields,
//             lessons, attendance, makeups live in `class_*` keyed by that id.
//   - add   : POST /api/students inserts into `students` (additive) + extras.
//   - rename: best-effort single-row UPDATE of students.name.
//   - NEVER deletes or bulk-overwrites `students` (mogakgong data is protected).
// attendance_log_v2 / student_schedules / consultations are NOT touched.
//
// API:
//   GET  /api/health
//   GET  /api/data            -> DataSnapshot (roster merged with class_* extras)
//   PUT  /api/data            -> replaces all class_* data (never students)
//   POST /api/students        -> {name,...} create/link roster student -> {id}
//   POST /api/points          -> {studentId,delta,reason} award/revoke points
//   GET  /api/report          -> monthly attendance aggregation

import type { AttRecord, DataSnapshot, Makeup, Student } from "../src/types";

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
        if (p === "/api/students" && request.method === "POST") return await postStudents(env, request);
        if (p === "/api/points" && request.method === "POST") return await postPoints(env, request);
        if (p === "/api/report" && request.method === "GET") return await getReport(env, url);
        return json({ error: "not_found" }, 404);
      } catch (e) {
        return json({ error: "server_error", message: String(e) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

/* ---------------- read (roster ⨝ class_* extras) ---------------- */
async function readSnapshot(env: Env): Promise<DataSnapshot> {
  const [rosterRes, exRes, lRes, mRes, aRes] = await env.DB.batch([
    env.DB.prepare("SELECT id, name FROM students"),
    env.DB.prepare("SELECT * FROM class_students"),
    env.DB.prepare("SELECT * FROM class_lessons ORDER BY student_id, sort_order"),
    env.DB.prepare("SELECT * FROM class_makeups"),
    env.DB.prepare("SELECT * FROM class_attendance"),
  ]);

  const extrasById: Record<string, Record<string, unknown>> = {};
  for (const r of exRes.results as Record<string, unknown>[]) extrasById[String(r.id)] = r;

  const lessonsByStudent: Record<string, { day: string; time: string; duration: number }[]> = {};
  for (const r of lRes.results as Record<string, unknown>[]) {
    const sid = String(r.student_id);
    (lessonsByStudent[sid] ||= []).push({
      day: String(r.day),
      time: String(r.time),
      duration: Number(r.duration),
    });
  }

  const rosterIds = new Set<string>();
  const students: Student[] = (rosterRes.results as Record<string, unknown>[]).map((r) => {
    const id = String(r.id);
    rosterIds.add(id);
    const ex = extrasById[id];
    return {
      id,
      name: String(r.name),
      grade: ex && ex.grade === "중등" ? "중등" : "초등",
      startDate: ex ? String(ex.start_date ?? "") : "",
      excluded: ex ? Number(ex.excluded) === 1 : false,
      status: ex ? ((ex.status as Student["status"]) || "재원") : "재원",
      school: ex ? String(ex.school ?? "") : "",
      birthdate: ex ? String(ex.birthdate ?? "") : "",
      parentPhone: ex ? String(ex.parent_phone ?? "") : "",
      studentPhone: ex ? String(ex.student_phone ?? "") : "",
      lessons: lessonsByStudent[id] || [],
    };
  });

  // makeups/attendance: only for students still in the roster (drops orphans)
  const makeups: Makeup[] = (mRes.results as Record<string, unknown>[])
    .filter((r) => rosterIds.has(String(r.student_id)))
    .map((r) => ({
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
    const key = String(r.att_key);
    const sid = key.split("|")[1];
    if (!rosterIds.has(sid)) continue;
    let status = String(r.status);
    if (status === "present") status = "출석"; // legacy
    else if (status === "absent") status = "결석"; // legacy
    attendance[key] = {
      status: status as AttRecord["status"],
      lateMinutes: r.late_minutes == null ? undefined : Number(r.late_minutes),
      attitude: (r.attitude as AttRecord["attitude"]) || "",
      note: String(r.note ?? ""),
      pointsAwarded: Number(r.points_awarded) === 1,
    };
  }

  return { students, makeups, attendance };
}

/* ---------------- write (class_* only; roster never bulk-touched) ---------------- */
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
          "INSERT INTO class_students(id,name,grade,start_date,excluded,status,school,birthdate,parent_phone,student_phone,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
        )
        .bind(
          s.id,
          s.name,
          s.grade,
          s.startDate,
          s.excluded ? 1 : 0,
          s.status || "재원",
          s.school || "",
          s.birthdate || "",
          s.parentPhone || "",
          s.studentPhone || "",
          Date.now()
        )
    );
    (s.lessons || []).forEach((l, i) => {
      stmts.push(
        env.DB
          .prepare("INSERT INTO class_lessons(id,student_id,day,time,duration,sort_order) VALUES(?,?,?,?,?,?)")
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
    const a = snap.attendance[key];
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_attendance(att_key,status,late_minutes,attitude,note,points_awarded) VALUES(?,?,?,?,?,?)"
        )
        .bind(key, a.status, a.lateMinutes == null ? null : a.lateMinutes, a.attitude || "", a.note || "", a.pointsAwarded ? 1 : 0)
    );
  }

  await env.DB.batch(stmts);

  // best-effort: sync renamed names back to the shared roster (single-row, additive).
  // Wrapped per-row so a UNIQUE conflict never breaks the class_* persistence above.
  for (const s of snap.students) {
    if (/^\d+$/.test(s.id) && s.name) {
      try {
        await env.DB.prepare("UPDATE students SET name = ? WHERE id = ? AND name <> ?")
          .bind(s.name, Number(s.id), s.name)
          .run();
      } catch {
        /* ignore unique-name conflicts */
      }
    }
  }

  return json({ ok: true });
}

/* ---------------- create / link a roster student ---------------- */
async function postStudents(env: Env, request: Request): Promise<Response> {
  const b = (await request.json()) as Partial<Student> & { name?: string };
  const name = (b.name || "").trim();
  if (!name) return json({ error: "name_required" }, 400);

  // link to an existing roster student with the same name, else insert.
  let id: number;
  const existing = await env.DB.prepare("SELECT id FROM students WHERE name = ?").bind(name).first<{ id: number }>();
  if (existing) {
    id = existing.id;
  } else {
    const ins = await env.DB.prepare("INSERT INTO students(name) VALUES(?) RETURNING id").bind(name).first<{ id: number }>();
    id = ins!.id;
  }

  await env.DB.prepare(
    "INSERT OR REPLACE INTO class_students(id,name,grade,start_date,excluded,status,school,birthdate,parent_phone,student_phone,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      String(id),
      name,
      b.grade || "초등",
      b.startDate || "",
      b.excluded ? 1 : 0,
      b.status || "재원",
      b.school || "",
      b.birthdate || "",
      b.parentPhone || "",
      b.studentPhone || "",
      Date.now()
    )
    .run();

  return json({ id: String(id) });
}

/* ---------------- points (출석 적립/회수, by roster id) ---------------- */
// Logs a point_history row AND keeps the denormalized students.points total in
// sync (mogakgong invariant: students.points == SUM(point_history.delta)).
async function postPoints(env: Env, request: Request): Promise<Response> {
  const body = (await request.json()) as { studentId?: string; delta?: number; reason?: string };
  const sid = Number(body.studentId);
  const delta = Number(body.delta) || 0;
  const reason = (body.reason || "출석").slice(0, 40);
  if (!sid || !delta) return json({ matched: false });

  const row = await env.DB.prepare("SELECT id FROM students WHERE id = ?").bind(sid).first<{ id: number }>();
  if (!row) return json({ matched: false });

  await env.DB.batch([
    env.DB.prepare("INSERT INTO point_history(student_id,delta,reason,category) VALUES(?,?,?,'learn')").bind(sid, delta, reason),
    env.DB.prepare("UPDATE students SET points = points + ? WHERE id = ?").bind(delta, sid),
  ]);
  return json({ matched: true });
}

/* ---------------- monthly report aggregation ---------------- */
// GET /api/report?student_id=XXX&year=2026&month=5&comment=...
async function getReport(env: Env, url: URL): Promise<Response> {
  const studentId = url.searchParams.get("student_id") || "";
  const year = Number(url.searchParams.get("year")) || 0;
  const month = Number(url.searchParams.get("month")) || 0;
  const comment = url.searchParams.get("comment") || "";
  const pad = (n: number) => (n < 10 ? "0" + n : "" + n);

  const nameRow = await env.DB.prepare("SELECT name FROM students WHERE id = ?")
    .bind(Number(studentId) || -1)
    .first<{ name: string }>();

  const like = `${year}-${pad(month)}-%|${studentId}|%`;
  const rows = await env.DB.prepare(
    "SELECT status, COUNT(*) AS n FROM class_attendance WHERE att_key LIKE ? GROUP BY status"
  )
    .bind(like)
    .all<{ status: string; n: number }>();

  let total = 0;
  let present = 0;
  let late = 0;
  let absent = 0;
  let makeup = 0;
  for (const r of rows.results || []) {
    const n = Number(r.n);
    total += n;
    if (r.status === "출석") present += n;
    else if (r.status === "지각") late += n;
    else if (r.status === "결석" || r.status === "무단결석") absent += n;
    else if (r.status === "보강") makeup += n;
  }
  const rate = total ? Math.round(((present + late) / total) * 100) : 0;

  return json({
    studentName: nameRow ? nameRow.name : "",
    year,
    month,
    attendance: { total, present, late, absent, makeup, rate },
    homework: { rate: 0 },
    comment,
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
