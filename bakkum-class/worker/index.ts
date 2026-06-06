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
import {
  fetchNotionStudents,
  inspectDb,
  createHomeworkRecord,
  createProgressRecord,
  fetchHomeworkRecords,
  fetchProgressRecords,
  fetchAttendanceRecords,
} from "./notion";
import { NOTION_CFG } from "./notion";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  NOTION_TOKEN?: string;
}

const TEACHER = "이지현";

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
        if (p === "/api/students/hide" && request.method === "POST") {
          const b = (await request.json()) as { id?: string };
          if (b.id && /^\d+$/.test(b.id)) await env.DB.prepare("UPDATE students SET hidden=1 WHERE id=?").bind(Number(b.id)).run();
          return json({ ok: true });
        }
        if (p === "/api/points" && request.method === "POST") return await postPoints(env, request);
        if (p === "/api/report" && request.method === "GET") return await getReport(env, url);
        if (p === "/api/sync/students" && request.method === "GET") return await syncStudents(env);
        if (p === "/api/notion/inspect" && request.method === "GET") {
          try {
            return json(await inspectDb(env, url.searchParams.get("db") || "student"));
          } catch (e) {
            return json({ error: String(e) }, 500);
          }
        }
        if (p === "/api/notion/homework" && request.method === "POST") return await notionHomework(env, request);
        if (p === "/api/notion/progress" && request.method === "POST") return await notionProgress(env, request);
        if (p === "/api/sync/records" && request.method === "GET") return await importRecords(env, url);
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
  const [rosterRes, lRes, mRes, aRes, hRes, pRes] = await env.DB.batch([
    env.DB.prepare(
      "SELECT id,name,grade,status,school,birth_date,parent_phone,student_phone,start_date,excluded FROM students WHERE hidden IS NULL OR hidden = 0"
    ),
    env.DB.prepare("SELECT * FROM class_lessons ORDER BY student_id, sort_order"),
    env.DB.prepare("SELECT * FROM class_makeups"),
    env.DB.prepare("SELECT * FROM class_attendance"),
    env.DB.prepare("SELECT * FROM class_homework ORDER BY date DESC"),
    env.DB.prepare("SELECT * FROM class_progress ORDER BY date DESC"),
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

  const rosterIds = new Set<string>();
  const students: Student[] = (rosterRes.results as Record<string, unknown>[]).map((r) => {
    const id = String(r.id);
    rosterIds.add(id);
    return {
      id,
      name: String(r.name),
      grade: r.grade === "중등" ? "중등" : "초등",
      startDate: String(r.start_date ?? ""),
      excluded: Number(r.excluded) === 1,
      status: (r.status as Student["status"]) || "재원",
      school: String(r.school ?? ""),
      birthdate: String(r.birth_date ?? ""),
      parentPhone: String(r.parent_phone ?? ""),
      studentPhone: String(r.student_phone ?? ""),
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

  const homeworkLog = (hRes.results as Record<string, unknown>[])
    .filter((r) => rosterIds.has(String(r.student_id)))
    .map((r) => ({
      id: String(r.id),
      studentId: String(r.student_id),
      date: String(r.date),
      book: String(r.book ?? ""),
      tags: String(r.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      completion: Number(r.completion),
      status: r.status === "late" ? ("late" as const) : r.status === "pending" ? ("pending" as const) : ("done" as const),
      memo: String(r.memo ?? ""),
    }));

  const progressLog = (pRes.results as Record<string, unknown>[])
    .filter((r) => rosterIds.has(String(r.student_id)))
    .map((r) => ({
      id: String(r.id),
      studentId: String(r.student_id),
      unit: String(r.unit ?? ""),
      area: String(r.area ?? ""),
      pct: Number(r.pct),
      startDate: String(r.start_date ?? ""),
      memo: String(r.memo ?? ""),
    }));

  return { students, makeups, attendance, homeworkLog, progressLog };
}

/* ---------------- write (class_* only; roster never bulk-touched) ---------------- */
async function putData(env: Env, request: Request): Promise<Response> {
  const snap = (await request.json()) as DataSnapshot;
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM class_attendance"),
    env.DB.prepare("DELETE FROM class_makeups"),
    env.DB.prepare("DELETE FROM class_lessons"),
    env.DB.prepare("DELETE FROM class_homework"),
    env.DB.prepare("DELETE FROM class_progress"),
  ];

  for (const h of snap.homeworkLog || []) {
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_homework(id,student_id,date,book,tags,completion,status,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?)"
        )
        .bind(h.id, h.studentId, h.date, h.book || "", (h.tags || []).join(","), h.completion || 0, h.status || "done", h.memo || "", Date.now())
    );
  }
  for (const pr of snap.progressLog || []) {
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_progress(id,student_id,date,unit,area,pct,start_date,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?)"
        )
        .bind(pr.id, pr.studentId, pr.startDate || "", pr.unit || "", pr.area || "", pr.pct || 0, pr.startDate || "", pr.memo || "", Date.now())
    );
  }

  for (const s of snap.students) {
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

  // Persist academic fields to the shared roster — UPDATE only (never DELETE,
  // never touch points/photo_url/notion_page_id). Per-row + try/catch so a
  // UNIQUE-name conflict can't break the class_* persistence above.
  for (const s of snap.students) {
    if (!/^\d+$/.test(s.id)) continue;
    try {
      await env.DB
        .prepare(
          "UPDATE students SET name=?,grade=?,status=?,school=?,birth_date=?,parent_phone=?,student_phone=?,start_date=?,excluded=? WHERE id=?"
        )
        .bind(
          s.name,
          s.grade,
          s.status || "재원",
          s.school || "",
          s.birthdate || "",
          s.parentPhone || "",
          s.studentPhone || "",
          s.startDate || "",
          s.excluded ? 1 : 0,
          Number(s.id)
        )
        .run();
    } catch {
      /* ignore unique-name conflicts */
    }
  }

  return json({ ok: true });
}

/* ---------------- create / link a roster student ---------------- */
async function postStudents(env: Env, request: Request): Promise<Response> {
  const b = (await request.json()) as Partial<Student> & { name?: string };
  const name = (b.name || "").trim();
  if (!name) return json({ error: "name_required" }, 400);

  // link to an existing roster student with the same name, else insert. Then
  // set academic columns. Never touches points/photo_url/notion_page_id.
  const existing = await env.DB.prepare("SELECT id FROM students WHERE name = ?").bind(name).first<{ id: number }>();
  let id: number;
  if (existing) {
    id = existing.id;
    await env.DB
      .prepare(
        "UPDATE students SET grade=?,status=?,school=?,birth_date=?,parent_phone=?,student_phone=?,start_date=?,excluded=? WHERE id=?"
      )
      .bind(b.grade || "초등", b.status || "재원", b.school || "", b.birthdate || "", b.parentPhone || "", b.studentPhone || "", b.startDate || "", b.excluded ? 1 : 0, id)
      .run();
  } else {
    const ins = await env.DB
      .prepare(
        "INSERT INTO students(name,grade,status,school,birth_date,parent_phone,student_phone,start_date,excluded) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id"
      )
      .bind(name, b.grade || "초등", b.status || "재원", b.school || "", b.birthdate || "", b.parentPhone || "", b.studentPhone || "", b.startDate || "", b.excluded ? 1 : 0)
      .first<{ id: number }>();
    id = ins!.id;
  }

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

/* ---------------- Notion: 학생 동기화 (노션 → D1) ---------------- */
async function syncStudents(env: Env): Promise<Response> {
  let list;
  try {
    list = await fetchNotionStudents(env);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  let synced = 0;
  for (const s of list) {
    try {
      // upsert by notion_page_id (fallback: same name). Never deletes. grade is
      // app-managed (not in Notion), so it's left as-is.
      const ex = await env.DB.prepare("SELECT id FROM students WHERE notion_page_id = ? OR name = ? LIMIT 1")
        .bind(s.notionPageId, s.name)
        .first<{ id: number }>();
      if (ex) {
        // start_date(등록일)는 앱에서 수정한 값을 보존 — 노션 첫수업일(영어 공용)이
        // 덮어쓰지 않도록 비어있을 때만 채운다. 나머지 필드는 노션이 마스터.
        await env.DB
          .prepare(
            "UPDATE students SET name=?,status=?,school=?,birth_date=?,parent_phone=?,student_phone=?,start_date=COALESCE(NULLIF(start_date,''),?),notion_page_id=? WHERE id=?"
          )
          .bind(s.name, s.status, s.school, s.birth, s.parentPhone, s.studentPhone, s.start, s.notionPageId, ex.id)
          .run();
      } else {
        await env.DB
          .prepare(
            "INSERT INTO students(name,status,school,birth_date,parent_phone,student_phone,start_date,notion_page_id) VALUES(?,?,?,?,?,?,?,?)"
          )
          .bind(s.name, s.status, s.school, s.birth, s.parentPhone, s.studentPhone, s.start, s.notionPageId)
          .run();
      }
      synced++;
    } catch (e) {
      console.log("sync upsert failed", s.name, String(e));
    }
  }
  return json({ synced, total: list.length });
}

/* ---------------- Notion: 기록 저장 (앱 → 노션, best-effort) ---------------- */
async function notionPageIdOf(env: Env, studentId: string): Promise<string | undefined> {
  const r = await env.DB.prepare("SELECT notion_page_id FROM students WHERE id = ?")
    .bind(Number(studentId) || -1)
    .first<{ notion_page_id: string | null }>();
  return r?.notion_page_id || undefined;
}

async function notionHomework(env: Env, request: Request): Promise<Response> {
  const b = (await request.json()) as {
    studentId?: string;
    date?: string;
    book?: string;
    tags?: string[];
    completion?: number;
    done?: boolean;
    memo?: string;
  };
  const ok = await createHomeworkRecord(env, {
    notionPageId: await notionPageIdOf(env, b.studentId || ""),
    date: b.date || "",
    book: b.book || "",
    tags: b.tags || [],
    completion: b.completion || 0,
    done: !!b.done,
    memo: b.memo || "",
  });
  return json({ ok });
}

async function notionProgress(env: Env, request: Request): Promise<Response> {
  const b = (await request.json()) as {
    studentId?: string;
    unit?: string;
    area?: string;
    pct?: number;
    startDate?: string;
    memo?: string;
  };
  const ok = await createProgressRecord(env, {
    notionPageId: await notionPageIdOf(env, b.studentId || ""),
    unit: b.unit || "",
    area: b.area || "",
    pct: b.pct || 0,
    startDate: b.startDate || "",
    memo: b.memo || "",
  });
  return json({ ok });
}

/* ---------------- Notion → 앱 기록 가져오기 (3월부터; 타입별, 서버 필터) ----------------
   ?type=homework|progress|attendance (분할 호출로 워커 시간/서브요청 한도 회피). */
async function buildIdByPage(env: Env): Promise<Record<string, string>> {
  const rows = await env.DB.prepare(
    "SELECT id, notion_page_id FROM students WHERE notion_page_id IS NOT NULL AND notion_page_id <> ''"
  ).all<{ id: number; notion_page_id: string }>();
  const map: Record<string, string> = {};
  for (const r of rows.results || []) map[r.notion_page_id] = String(r.id);
  return map;
}
async function runChunked(env: Env, stmts: D1PreparedStatement[]) {
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

async function importRecords(env: Env, url: URL): Promise<Response> {
  const since = url.searchParams.get("since") || NOTION_CFG.importSince;
  const type = url.searchParams.get("type") || "all";
  const res = { homework: 0, progress: 0, attendance: 0 };
  try {
    const idByPage = await buildIdByPage(env);
    if (type === "homework" || type === "all") {
      const stmts: D1PreparedStatement[] = [];
      for (const r of await fetchHomeworkRecords(env, since)) {
        const sid = idByPage[r.studentPageId];
        if (!sid) continue;
        stmts.push(
          env.DB
            .prepare(
              "INSERT OR REPLACE INTO class_homework(id,student_id,date,book,tags,completion,status,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?)"
            )
            .bind("nh_" + r.srcId, sid, r.date, r.book, r.tags.join(","), r.completion, r.done ? "done" : "pending", r.memo, Date.now())
        );
        res.homework++;
      }
      await runChunked(env, stmts);
    }
    if (type === "progress" || type === "all") {
      const stmts: D1PreparedStatement[] = [];
      for (const r of await fetchProgressRecords(env, since)) {
        const sid = idByPage[r.studentPageId];
        if (!sid) continue;
        stmts.push(
          env.DB
            .prepare(
              "INSERT OR REPLACE INTO class_progress(id,student_id,date,unit,area,pct,start_date,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?)"
            )
            .bind("np_" + r.srcId, sid, r.date || r.startDate, r.unit, r.area, r.pct, r.startDate, r.memo, Date.now())
        );
        res.progress++;
      }
      await runChunked(env, stmts);
    }
    if (type === "attendance" || type === "all") {
      const stmts: D1PreparedStatement[] = [];
      for (const r of await fetchAttendanceRecords(env, since)) {
        const sid = idByPage[r.studentPageId];
        if (!sid) continue;
        const attKey = `${r.date}|${sid}|n${r.srcId.replace(/-/g, "").slice(-8)}`;
        stmts.push(
          env.DB
            .prepare(
              "INSERT OR REPLACE INTO class_attendance(att_key,status,late_minutes,attitude,note,points_awarded) VALUES(?,?,?,?,?,0)"
            )
            .bind(attKey, r.status, r.lateMinutes || null, r.attitude || "", r.note || "")
        );
        // 출결='보강'은 보강 관리(makeups)에도 등록 (보강 진행/완료로 표시)
        if (r.status === "보강") {
          stmts.push(
            env.DB
              .prepare(
                "INSERT OR REPLACE INTO class_makeups(id,student_id,absent_date,absent_time,absent_duration,att_key,status,makeup_date,makeup_time,makeup_duration,parent_contacted,memo,created_at) VALUES(?,?,'','',0,'','scheduled',?,'',0,0,?,?)"
              )
              .bind("nm_" + r.srcId, sid, r.date, r.note || "", Date.now())
          );
        }
        res.attendance++;
      }
      await runChunked(env, stmts);
    }
  } catch (e) {
    return json({ ...res, error: String(e) }, 500);
  }
  return json(res);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
