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

import type { AttRecord, DataSnapshot, Makeup, ScheduleVersion, Student, TestLog } from "../src/types";
import {
  fetchNotionStudents,
  inspectDb,
  upsertHomeworkRecord,
  upsertProgressRecord,
  fetchHomeworkRecords,
  fetchProgressRecords,
  fetchAttendanceRecords,
  fetchTestRecords,
  upsertTestRecord,
  upsertAttendanceRecord,
  fetchScheduleItems,
  fetchClassPageMap,
  classPageIdForGrade,
} from "./notion";
import { NOTION_CFG } from "./notion";
import { isHoliday } from "../src/lib/holidays";

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
        if (p === "/api/schedule" && request.method === "GET") return await getSchedule(env, url);
        if (p === "/api/notion/inspect" && request.method === "GET") {
          try {
            return json(await inspectDb(env, url.searchParams.get("db") || "student"));
          } catch (e) {
            return json({ error: String(e) }, 500);
          }
        }
        if (p === "/api/notion/attendance" && request.method === "POST") return await notionAttendance(env, request);
        if (p === "/api/notion/homework" && request.method === "POST") return await notionHomework(env, request);
        if (p === "/api/notion/progress" && request.method === "POST") return await notionProgress(env, request);
        if (p === "/api/notion/test" && request.method === "POST") return await notionTest(env, request);
        if (p === "/api/sync/records" && request.method === "GET") return await importRecords(env, url);
        return json({ error: "not_found" }, 404);
      } catch (e) {
        return json({ error: "server_error", message: String(e) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

/* class_schedules / class_tests 테이블 자가 생성(마이그레이션 미적용이어도 동작하게).
   추가전용(IF NOT EXISTS) — 기존 데이터 무영향. */
async function ensureSchedulesTable(env: Env): Promise<void> {
  try {
    await env.DB
      .prepare("CREATE TABLE IF NOT EXISTS class_schedules (student_id TEXT PRIMARY KEY, versions TEXT NOT NULL DEFAULT '[]')")
      .run();
  } catch {
    /* ignore */
  }
  try {
    await env.DB
      .prepare(
        "CREATE TABLE IF NOT EXISTS class_tests (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, date TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', round TEXT NOT NULL DEFAULT '', range_ TEXT NOT NULL DEFAULT '', score INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '예정', memo TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"
      )
      .run();
  } catch {
    /* ignore */
  }
  // 사용자가 직접 삭제한 보강(결석)의 att_key — 노션 재가져오기/재체크 때 되살아나지 않게.
  try {
    await env.DB
      .prepare("CREATE TABLE IF NOT EXISTS class_makeup_dismissed (att_key TEXT PRIMARY KEY)")
      .run();
  } catch {
    /* ignore */
  }
  // 앱에서 인라인 수정해 '앱 소유'가 된 학생 필드 — 노션 동기화가 덮어쓰지 않게.
  try {
    await env.DB
      .prepare("CREATE TABLE IF NOT EXISTS class_student_overrides (student_id TEXT PRIMARY KEY, fields TEXT NOT NULL DEFAULT '[]')")
      .run();
  } catch {
    /* ignore */
  }
  // '오늘 숙제 없음'으로 정리한 표식 — 숙제 기록을 만들지 않고 정리완료만 기억. key=studentId|날짜.
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS class_homework_none (mark_key TEXT PRIMARY KEY)").run();
  } catch {
    /* ignore */
  }
}

/** 학생별 '앱 소유 필드' 맵 (student_id → ["name","status",…]). 없으면 빈 맵. */
async function readStudentOverrides(env: Env): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {};
  try {
    const r = await env.DB.prepare("SELECT student_id, fields FROM class_student_overrides").all<{ student_id: string; fields: string }>();
    for (const row of r.results || []) {
      try {
        const f = JSON.parse(String(row.fields));
        if (Array.isArray(f) && f.length) map[String(row.student_id)] = f.map(String);
      } catch {
        /* ignore corrupt row */
      }
    }
  } catch {
    /* table 없으면 빈 맵 */
  }
  return map;
}

/** 사용자가 삭제 표시한 보강 att_key 집합. 테이블이 없으면 빈 집합. */
async function readDismissedMakeups(env: Env): Promise<Set<string>> {
  try {
    const r = await env.DB.prepare("SELECT att_key FROM class_makeup_dismissed").all<{ att_key: string }>();
    return new Set((r.results || []).map((x) => String(x.att_key)));
  } catch {
    return new Set();
  }
}

/** '오늘 숙제 없음' 표식 집합 (studentId|날짜). 테이블이 없으면 빈 집합. */
async function readNoHomework(env: Env): Promise<Set<string>> {
  try {
    const r = await env.DB.prepare("SELECT mark_key FROM class_homework_none").all<{ mark_key: string }>();
    return new Set((r.results || []).map((x) => String(x.mark_key)));
  } catch {
    return new Set();
  }
}

/* ---------------- read (roster ⨝ class_* extras) ---------------- */
async function readSnapshot(env: Env): Promise<DataSnapshot> {
  await ensureSchedulesTable(env);
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

  // 시간표 변경 이력(버전) — 별도 쿼리 + try/catch로 분리.
  // (테이블이 없거나 깨져도 나머지 스냅샷 읽기는 절대 실패하지 않게)
  const scheduleByStudent: Record<string, ScheduleVersion[]> = {};
  try {
    const schRes = await env.DB.prepare("SELECT student_id, versions FROM class_schedules").all();
    for (const r of schRes.results as Record<string, unknown>[]) {
      try {
        const v = JSON.parse(String(r.versions)) as ScheduleVersion[];
        if (Array.isArray(v) && v.length) scheduleByStudent[String(r.student_id)] = v;
      } catch {
        /* ignore corrupt rows */
      }
    }
  } catch {
    /* class_schedules 없으면 시간표 이력 없이 진행 */
  }

  const overridesByStudent = await readStudentOverrides(env);

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
      ...(scheduleByStudent[id] ? { schedule: scheduleByStudent[id] } : {}),
      ...(overridesByStudent[id] ? { appEdited: overridesByStudent[id] } : {}),
    };
  });

  // 사용자가 직접 삭제 표시한 보강(att_key) — 되살아나지 않게 읽기 단계에서도 제외.
  const dismissedSet = await readDismissedMakeups(env);
  const noHomeworkSet = await readNoHomework(env);

  // makeups/attendance: only for students still in the roster (drops orphans)
  const makeups: Makeup[] = (mRes.results as Record<string, unknown>[])
    .filter((r) => rosterIds.has(String(r.student_id)))
    .filter((r) => !dismissedSet.has(String(r.att_key)))
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

  // 테스트 기록 — 별도 쿼리 + try/catch(테이블 없어도 나머지 읽기 안 깨지게)
  const testLog: TestLog[] = [];
  try {
    const tRes = await env.DB.prepare("SELECT * FROM class_tests ORDER BY date DESC").all();
    for (const r of tRes.results as Record<string, unknown>[]) {
      if (!rosterIds.has(String(r.student_id))) continue;
      testLog.push({
        id: String(r.id),
        studentId: String(r.student_id),
        date: String(r.date ?? ""),
        type: String(r.type ?? ""),
        round: String(r.round ?? ""),
        range: String(r.range_ ?? ""),
        score: Number(r.score ?? 0),
        status: r.status === "완료" ? "완료" : "예정",
        memo: String(r.memo ?? ""),
      });
    }
  } catch {
    /* class_tests 없으면 빈 배열 */
  }

  return { students, makeups, attendance, homeworkLog, progressLog, testLog, dismissedMakeups: [...dismissedSet], noHomework: [...noHomeworkSet] };
}

/* ---------------- write (class_* only; roster never bulk-touched) ---------------- */
async function putData(env: Env, request: Request): Promise<Response> {
  const snap = (await request.json()) as DataSnapshot;
  await ensureSchedulesTable(env); // 테이블 없어도 저장이 통째로 실패하지 않게
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM class_attendance"),
    env.DB.prepare("DELETE FROM class_makeups"),
    env.DB.prepare("DELETE FROM class_lessons"),
    env.DB.prepare("DELETE FROM class_schedules"),
    env.DB.prepare("DELETE FROM class_homework"),
    env.DB.prepare("DELETE FROM class_progress"),
    env.DB.prepare("DELETE FROM class_tests"),
    env.DB.prepare("DELETE FROM class_makeup_dismissed"),
    env.DB.prepare("DELETE FROM class_student_overrides"),
    env.DB.prepare("DELETE FROM class_homework_none"),
  ];

  // 삭제 표시(tombstone) — 중복 제거 후 다시 기록.
  for (const key of [...new Set(snap.dismissedMakeups || [])]) {
    if (!key) continue;
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO class_makeup_dismissed(att_key) VALUES(?)").bind(key));
  }
  // '오늘 숙제 없음' 표식 — 숙제 기록 없이 정리완료만 기억.
  for (const key of [...new Set(snap.noHomework || [])]) {
    if (!key) continue;
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO class_homework_none(mark_key) VALUES(?)").bind(key));
  }

  for (const t of snap.testLog || []) {
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_tests(id,student_id,date,type,round,range_,score,status,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
        )
        .bind(
          t.id,
          t.studentId,
          t.date || "",
          t.type || "",
          t.round || "",
          t.range || "",
          t.score || 0,
          t.status || "예정",
          t.memo || "",
          Date.now()
        )
    );
  }

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
    // 시간표 변경 이력(버전)을 JSON으로 보관 — 단일 버전뿐이면 굳이 저장하지 않음
    if (s.schedule && s.schedule.length > 1) {
      stmts.push(
        env.DB
          .prepare("INSERT INTO class_schedules(student_id,versions) VALUES(?,?)")
          .bind(s.id, JSON.stringify(s.schedule))
      );
    }
    // 앱에서 인라인 수정한 '앱 소유' 필드 목록 — 노션 동기화가 덮어쓰지 않게 보관
    if (s.appEdited && s.appEdited.length) {
      stmts.push(
        env.DB
          .prepare("INSERT INTO class_student_overrides(student_id,fields) VALUES(?,?)")
          .bind(s.id, JSON.stringify([...new Set(s.appEdited)]))
      );
    }
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

/* ---------------- Notion: 학원 일정 (읽기 전용 표시) ---------------- */
// GET /api/schedule?since=YYYY-MM-DD  (기본: 31일 전부터)
async function getSchedule(env: Env, url: URL): Promise<Response> {
  let since = url.searchParams.get("since") || "";
  if (!since) {
    const d = new Date(Date.now() - 31 * 86400000);
    since = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  try {
    const items = await fetchScheduleItems(env, since);
    return json({ items });
  } catch (e) {
    return json({ items: [], error: String(e) }, 200);
  }
}

/* ---------------- Notion: 학생 동기화 (노션 → D1) ---------------- */
async function syncStudents(env: Env): Promise<Response> {
  let list;
  try {
    list = await fetchNotionStudents(env);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  const COLS =
    "id,name,status,school,birth_date,parent_phone,student_phone,start_date,notion_page_id";
  // 앱에서 인라인 수정한 '앱 소유' 필드는 노션 값으로 덮어쓰지 않는다.
  const overrides = await readStudentOverrides(env);
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const s of list) {
    try {
      // 중복 판단은 이름이 아니라 노션 페이지 고유 ID로만 한다(동명이인 대비).
      let ex = await env.DB.prepare(`SELECT ${COLS} FROM students WHERE notion_page_id = ? LIMIT 1`)
        .bind(s.notionPageId)
        .first<Record<string, unknown>>();
      // 아직 노션과 연결 안 된 동명 학생이 있으면 1회 연결(앱에서 먼저 만든 경우).
      // 이미 연결된(다른 id를 가진) 동명이인은 건드리지 않고 새로 추가된다.
      if (!ex) {
        ex = await env.DB
          .prepare(`SELECT ${COLS} FROM students WHERE name = ? AND (notion_page_id IS NULL OR notion_page_id = '') LIMIT 1`)
          .bind(s.name)
          .first<Record<string, unknown>>();
      }
      if (ex) {
        // start_date(등록일)는 앱에서 수정한 값을 보존 — 노션 첫수업일이 덮어쓰지
        // 않도록 비어있을 때만 채운다. 나머지 필드는 노션이 마스터.
        const curStart = String(ex.start_date ?? "");
        const newStart = curStart !== "" ? curStart : s.start;
        // 앱 소유 필드는 기존(앱) 값을 유지, 그 외는 노션 값으로.
        const owned = overrides[String(ex.id)] || [];
        const vName = owned.includes("name") ? String(ex.name ?? "") : s.name;
        const vStatus = owned.includes("status") ? String(ex.status ?? "") : s.status;
        const vSchool = owned.includes("school") ? String(ex.school ?? "") : s.school;
        const same =
          String(ex.name ?? "") === vName &&
          String(ex.status ?? "") === vStatus &&
          String(ex.school ?? "") === vSchool &&
          String(ex.birth_date ?? "") === s.birth &&
          String(ex.parent_phone ?? "") === s.parentPhone &&
          String(ex.student_phone ?? "") === s.studentPhone &&
          curStart === newStart &&
          String(ex.notion_page_id ?? "") === s.notionPageId;
        if (same) {
          unchanged++; // 똑같으면 건너뜀
        } else {
          await env.DB
            .prepare(
              "UPDATE students SET name=?,status=?,school=?,birth_date=?,parent_phone=?,student_phone=?,start_date=?,notion_page_id=? WHERE id=?"
            )
            .bind(vName, vStatus, vSchool, s.birth, s.parentPhone, s.studentPhone, newStart, s.notionPageId, Number(ex.id))
            .run();
          updated++;
        }
      } else {
        await env.DB
          .prepare(
            "INSERT INTO students(name,status,school,birth_date,parent_phone,student_phone,start_date,notion_page_id) VALUES(?,?,?,?,?,?,?,?)"
          )
          .bind(s.name, s.status, s.school, s.birth, s.parentPhone, s.studentPhone, s.start, s.notionPageId)
          .run();
        added++;
      }
    } catch (e) {
      console.log("sync upsert failed", s.name, String(e));
    }
  }
  return json({ added, updated, unchanged, total: list.length });
}

/* ---------------- Notion: 기록 저장 (앱 → 노션, best-effort) ---------------- */
// 학생의 노션 페이지 id + 학년(수업 선택 결정용) 조회.
async function studentNotionMeta(
  env: Env,
  studentId: string
): Promise<{ pageId?: string; grade: string; name: string }> {
  const r = await env.DB.prepare("SELECT name, notion_page_id, grade FROM students WHERE id = ?")
    .bind(Number(studentId) || -1)
    .first<{ name: string | null; notion_page_id: string | null; grade: string | null }>();
  return { pageId: r?.notion_page_id || undefined, grade: r?.grade || "", name: r?.name || "" };
}

async function notionAttendance(env: Env, request: Request): Promise<Response> {
  const b = (await request.json()) as {
    studentId?: string;
    date?: string;
    status?: string;
    attitude?: string;
    lateMinutes?: number;
    note?: string;
  };
  const meta = await studentNotionMeta(env, b.studentId || "");
  const classPageId = classPageIdForGrade(await fetchClassPageMap(env), meta.grade);
  const ok = await upsertAttendanceRecord(env, {
    notionPageId: meta.pageId,
    classPageId,
    date: b.date || "",
    status: b.status || "",
    attitude: b.attitude || "",
    lateMinutes: b.lateMinutes || 0,
    note: b.note || "",
  });
  return json({ ok });
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
    checkOnly?: boolean;
    delayCount?: number;
  };
  const meta = await studentNotionMeta(env, b.studentId || "");
  const classPageId = classPageIdForGrade(await fetchClassPageMap(env), meta.grade);
  const ok = await upsertHomeworkRecord(env, {
    notionPageId: meta.pageId,
    classPageId,
    date: b.date || "",
    book: b.book || "",
    tags: b.tags || [],
    completion: b.completion || 0,
    done: !!b.done,
    memo: b.memo || "",
    checkOnly: !!b.checkOnly,
    delayCount: b.delayCount || 0,
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
  const meta = await studentNotionMeta(env, b.studentId || "");
  const classPageId = classPageIdForGrade(await fetchClassPageMap(env), meta.grade);
  const ok = await upsertProgressRecord(env, {
    notionPageId: meta.pageId,
    classPageId,
    unit: b.unit || "",
    area: b.area || "",
    pct: b.pct || 0,
    startDate: b.startDate || "",
    memo: b.memo || "",
  });
  return json({ ok });
}

async function notionTest(env: Env, request: Request): Promise<Response> {
  const b = (await request.json()) as {
    studentId?: string;
    date?: string;
    type?: string;
    round?: string;
    range?: string;
    score?: number;
    status?: string;
    memo?: string;
  };
  const meta = await studentNotionMeta(env, b.studentId || "");
  const classPageId = classPageIdForGrade(await fetchClassPageMap(env), meta.grade);
  const ok = await upsertTestRecord(env, {
    notionPageId: meta.pageId,
    classPageId,
    date: b.date || "",
    type: b.type || "",
    round: b.round || "",
    range: b.range || "",
    score: b.score || 0,
    status: b.status || "예정",
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

/** 학생별 (최신) 수업 슬롯 — 기간 결석을 수업일별로 펼칠 때 사용. */
async function buildLessonsBySid(
  env: Env
): Promise<Record<string, { day: string; time: string; duration: number }[]>> {
  const rows = await env.DB.prepare(
    "SELECT student_id, day, time, duration FROM class_lessons ORDER BY student_id, sort_order"
  ).all<{ student_id: string; day: string; time: string; duration: number }>();
  const map: Record<string, { day: string; time: string; duration: number }[]> = {};
  for (const r of rows.results || [])
    (map[String(r.student_id)] ||= []).push({ day: String(r.day), time: String(r.time), duration: Number(r.duration) });
  return map;
}

const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"];
/** start~end(포함) 사이의 모든 날짜(YYYY-MM-DD). UTC 기준으로 tz 영향 제거. 최대 366일. */
function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  let t = Date.UTC(sy, sm - 1, sd);
  const te = Date.UTC(ey, em - 1, ed);
  let guard = 0;
  while (t <= te && guard++ < 366) {
    const d = new Date(t);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${d.getUTCFullYear()}-${mm}-${dd}`);
    t += 86400000;
  }
  return out;
}
/** 'YYYY-MM-DD' → 요일('월'..'일'). */
function dowOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return DOW_KR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
async function runChunked(env: Env, stmts: D1PreparedStatement[]) {
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

async function importRecords(env: Env, url: URL): Promise<Response> {
  const since = url.searchParams.get("since") || NOTION_CFG.importSince;
  const type = url.searchParams.get("type") || "all";
  const res = { homework: 0, progress: 0, attendance: 0, test: 0 };
  try {
    await ensureSchedulesTable(env); // class_tests 보장
    const idByPage = await buildIdByPage(env);
    const dismissedSet = await readDismissedMakeups(env);
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
      // 노션에서 가져온 출결/보강을 먼저 모두 지우고 다시 넣는다(=교체).
      // 그래야 과목 필터(영어 제외)가 바뀌면 이전에 잘못 들어온 기록이 정리됨.
      // 식별: 가져온 출결 키는 시간자리가 'n…', 보강 id는 'nm_'/'nmr_'.
      const stmts: D1PreparedStatement[] = [
        env.DB.prepare("DELETE FROM class_attendance WHERE att_key LIKE '%|n%'"),
        env.DB.prepare(
          "DELETE FROM class_makeups WHERE id LIKE 'nm\\_%' ESCAPE '\\' OR id LIKE 'nmr\\_%' ESCAPE '\\'"
        ),
      ];
      const lessonsBySid = await buildLessonsBySid(env);
      for (const r of await fetchAttendanceRecords(env, since)) {
        const sid = idByPage[r.studentPageId];
        if (!sid) continue;
        const srcKey = r.srcId.replace(/-/g, "").slice(-8);

        // 기간(범위) 결석 → 학생의 수업일마다 '결석' + 보강 대기로 전개
        let expanded = false;
        if (r.dateEnd && r.dateEnd > r.date && r.status.includes("결석")) {
          const lessons = lessonsBySid[sid] || [];
          for (const dstr of eachDate(r.date, r.dateEnd)) {
            if (dstr < since) continue;
            if (isHoliday(dstr)) continue; // 공휴일은 수업 없음 → 결석/보강 만들지 않음
            const dow = dowOf(dstr);
            for (const l of lessons) {
              if (l.day !== dow) continue;
              // 시간자리를 'n…'로 시작하게 해 '가져온 기록'으로 식별/정리 가능하게.
              const attKey = `${dstr}|${sid}|n${srcKey}x${l.time.replace(":", "")}`;
              // 사용자가 직접 삭제한 보강이면 출결/보강 모두 되살리지 않는다.
              if (dismissedSet.has(attKey)) continue;
              stmts.push(
                env.DB
                  .prepare(
                    "INSERT OR REPLACE INTO class_attendance(att_key,status,late_minutes,attitude,note,points_awarded) VALUES(?,?,NULL,'',?,0)"
                  )
                  .bind(attKey, "결석", r.note || `기간결석(${r.date}~${r.dateEnd})`)
              );
              stmts.push(
                env.DB
                  .prepare(
                    "INSERT OR REPLACE INTO class_makeups(id,student_id,absent_date,absent_time,absent_duration,att_key,status,makeup_date,makeup_time,makeup_duration,parent_contacted,memo,created_at) VALUES(?,?,?,?,?,?,'pending','','',?,0,?,?)"
                  )
                  .bind(
                    `nmr_${srcKey}_${dstr}_${l.time.replace(":", "")}`,
                    sid,
                    dstr,
                    l.time,
                    l.duration,
                    attKey,
                    l.duration,
                    r.note || `기간결석(${r.date}~${r.dateEnd})`,
                    Date.now()
                  )
              );
              res.attendance++;
              expanded = true;
            }
          }
        }
        if (expanded) continue;

        // 단일 날짜 기록 (또는 수업일을 찾지 못한 기간 기록)
        const attKey = `${r.date}|${sid}|n${srcKey}`;
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
    if (type === "test" || type === "all") {
      const stmts: D1PreparedStatement[] = [];
      for (const r of await fetchTestRecords(env, since)) {
        const sid = idByPage[r.studentPageId];
        if (!sid) continue;
        stmts.push(
          env.DB
            .prepare(
              "INSERT OR REPLACE INTO class_tests(id,student_id,date,type,round,range_,score,status,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
            )
            .bind(
              "nt_" + r.srcId,
              sid,
              r.date,
              r.type,
              r.round,
              r.range,
              r.score || 0,
              r.status === "완료" ? "완료" : "예정",
              r.memo,
              Date.now()
            )
        );
        res.test++;
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
