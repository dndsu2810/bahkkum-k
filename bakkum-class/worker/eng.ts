/// <reference types="@cloudflare/workers-types" />
// 영어(신규) 백엔드 — 일일 학습일지 · 진도 · 테스트. 앱(허브) 자체 저장(노션 X).
// 수학과 분리된 class_eng_* 테이블. 인센티브/경시 개념 없음.

import type { Env } from "./index";
import type { SessionUser } from "./auth";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
let seq = 0;
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`;
}

export async function ensureEngTables(env: Env): Promise<void> {
  const stmts = [
    // 일일 학습일지(= 등원 + 기록). 학생-날짜 1건.
    "CREATE TABLE IF NOT EXISTS class_eng_daily (student_id TEXT NOT NULL, date TEXT NOT NULL, attended INTEGER NOT NULL DEFAULT 0, goals TEXT NOT NULL DEFAULT '[]', homework TEXT NOT NULL DEFAULT '', hw_checked INTEGER NOT NULL DEFAULT 0, comment TEXT NOT NULL DEFAULT '', materials TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(student_id, date))",
    // 진도/커리 — 교재명+레벨 자유.
    "CREATE TABLE IF NOT EXISTS class_eng_progress (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, book TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '진행', start_date TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0)",
    // 테스트 — 단어시험 등 영어식 평가(점수/만점).
    "CREATE TABLE IF NOT EXISTS class_eng_test (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, date TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', score INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 100, memo TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0)",
    // 월말리포트 — 8개 항목 등급 + 코멘트(학생-평가월 1건). 성적표 일괄 이미지용.
    "CREATE TABLE IF NOT EXISTS class_eng_report (student_id TEXT NOT NULL, month TEXT NOT NULL, teacher TEXT NOT NULL DEFAULT '', scores TEXT NOT NULL DEFAULT '{}', comments TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(student_id, month))",
    // 보강 — 결석/빠진 수업 → 보강 일정. 상태: 예정/완료/취소.
    "CREATE TABLE IF NOT EXISTS class_eng_makeup (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, absent_date TEXT NOT NULL DEFAULT '', makeup_date TEXT NOT NULL DEFAULT '', makeup_time TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '예정', memo TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0)",
  ];
  for (const s of stmts) {
    try {
      await env.DB.prepare(s).run();
    } catch {
      /* ignore */
    }
  }
}

export async function handleEng(env: Env, request: Request, p: string, me: SessionUser): Promise<Response | null> {
  const m = request.method;
  await ensureEngTables(env);
  const url = new URL(request.url);

  /* ---------------- 일일 학습일지 ---------------- */
  if (p === "/api/eng/daily" && m === "GET") {
    const date = url.searchParams.get("date") || "";
    const sid = url.searchParams.get("student_id") || "";
    let q;
    if (sid) q = env.DB.prepare("SELECT * FROM class_eng_daily WHERE student_id=? ORDER BY date DESC").bind(sid);
    else if (date) q = env.DB.prepare("SELECT * FROM class_eng_daily WHERE date=?").bind(date);
    else q = env.DB.prepare("SELECT * FROM class_eng_daily ORDER BY date DESC LIMIT 500");
    const r = await q.all<Record<string, unknown>>();
    return json({ daily: (r.results || []).map(dailyRow) });
  }
  if (p === "/api/eng/daily" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = String(b.studentId || "");
    const date = String(b.date || "");
    if (!sid || !date) return json({ error: "bad_input" }, 400);
    const goals = JSON.stringify(Array.isArray(b.goals) ? b.goals : []);
    await env.DB
      .prepare(
        "INSERT INTO class_eng_daily(student_id,date,attended,goals,homework,hw_checked,comment,materials,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(student_id,date) DO UPDATE SET attended=excluded.attended, goals=excluded.goals, homework=excluded.homework, hw_checked=excluded.hw_checked, comment=excluded.comment, materials=excluded.materials, updated_at=excluded.updated_at"
      )
      .bind(
        sid,
        date,
        b.attended ? 1 : 0,
        goals,
        String(b.homework || ""),
        b.hwChecked ? 1 : 0,
        String(b.comment || ""),
        String(b.materials || ""),
        Date.now()
      )
      .run();
    return json({ ok: true });
  }

  /* ---------------- 진도 ---------------- */
  if (p === "/api/eng/progress" && m === "GET") {
    const sid = url.searchParams.get("student_id") || "";
    const q = sid
      ? env.DB.prepare("SELECT * FROM class_eng_progress WHERE student_id=? ORDER BY updated_at DESC").bind(sid)
      : env.DB.prepare("SELECT * FROM class_eng_progress ORDER BY updated_at DESC LIMIT 1000");
    const r = await q.all<Record<string, unknown>>();
    return json({ progress: (r.results || []).map(progRow) });
  }
  if (p === "/api/eng/progress" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = String(b.studentId || "");
    if (!sid) return json({ error: "studentId_required" }, 400);
    const id = String(b.id || "") || newId("ep");
    const status = ["진행", "완료", "보류"].includes(String(b.status)) ? String(b.status) : "진행";
    const exists = await env.DB.prepare("SELECT id FROM class_eng_progress WHERE id=?").bind(id).first();
    if (exists) {
      await env.DB
        .prepare("UPDATE class_eng_progress SET book=?,level=?,status=?,start_date=?,memo=?,updated_at=? WHERE id=?")
        .bind(String(b.book || ""), String(b.level || ""), status, String(b.startDate || ""), String(b.memo || ""), Date.now(), id)
        .run();
    } else {
      await env.DB
        .prepare("INSERT INTO class_eng_progress(id,student_id,book,level,status,start_date,memo,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(id, sid, String(b.book || ""), String(b.level || ""), status, String(b.startDate || ""), String(b.memo || ""), Date.now())
        .run();
    }
    return json({ ok: true, id });
  }
  if (p === "/api/eng/progress/delete" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB.prepare("DELETE FROM class_eng_progress WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }

  /* ---------------- 테스트 ---------------- */
  if (p === "/api/eng/test" && m === "GET") {
    const sid = url.searchParams.get("student_id") || "";
    const q = sid
      ? env.DB.prepare("SELECT * FROM class_eng_test WHERE student_id=? ORDER BY date DESC").bind(sid)
      : env.DB.prepare("SELECT * FROM class_eng_test ORDER BY date DESC LIMIT 1000");
    const r = await q.all<Record<string, unknown>>();
    return json({ tests: (r.results || []).map(testRow) });
  }
  if (p === "/api/eng/test" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = String(b.studentId || "");
    if (!sid) return json({ error: "studentId_required" }, 400);
    const id = String(b.id || "") || newId("et");
    const exists = await env.DB.prepare("SELECT id FROM class_eng_test WHERE id=?").bind(id).first();
    if (exists) {
      await env.DB
        .prepare("UPDATE class_eng_test SET date=?,name=?,score=?,total=?,memo=? WHERE id=?")
        .bind(String(b.date || ""), String(b.name || ""), Number(b.score) || 0, Number(b.total) || 100, String(b.memo || ""), id)
        .run();
    } else {
      await env.DB
        .prepare("INSERT INTO class_eng_test(id,student_id,date,name,score,total,memo,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(id, sid, String(b.date || ""), String(b.name || ""), Number(b.score) || 0, Number(b.total) || 100, String(b.memo || ""), Date.now())
        .run();
    }
    return json({ ok: true, id });
  }
  if (p === "/api/eng/test/delete" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB.prepare("DELETE FROM class_eng_test WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }

  /* ---------------- 월말리포트(8개 항목) ---------------- */
  if (p === "/api/eng/report" && m === "GET") {
    const month = url.searchParams.get("month") || "";
    const q = month
      ? env.DB.prepare("SELECT * FROM class_eng_report WHERE month=?").bind(month)
      : env.DB.prepare("SELECT * FROM class_eng_report ORDER BY month DESC LIMIT 1000");
    const r = await q.all<Record<string, unknown>>();
    return json({ reports: (r.results || []).map(reportRow) });
  }
  if (p === "/api/eng/report" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = String(b.studentId || "");
    const month = String(b.month || "");
    if (!sid || !month) return json({ error: "bad_input" }, 400);
    const scores = JSON.stringify(b.scores && typeof b.scores === "object" ? b.scores : {});
    await env.DB
      .prepare(
        "INSERT INTO class_eng_report(student_id,month,teacher,scores,comments,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(student_id,month) DO UPDATE SET teacher=excluded.teacher, scores=excluded.scores, comments=excluded.comments, updated_at=excluded.updated_at"
      )
      .bind(sid, month, String(b.teacher || ""), scores, String(b.comments || ""), Date.now())
      .run();
    return json({ ok: true });
  }

  /* ---------------- 보강 ---------------- */
  if (p === "/api/eng/makeup" && m === "GET") {
    const sid = url.searchParams.get("student_id") || "";
    const q = sid
      ? env.DB.prepare("SELECT * FROM class_eng_makeup WHERE student_id=? ORDER BY makeup_date DESC, created_at DESC").bind(sid)
      : env.DB.prepare("SELECT * FROM class_eng_makeup ORDER BY makeup_date DESC, created_at DESC LIMIT 1000");
    const r = await q.all<Record<string, unknown>>();
    return json({ makeups: (r.results || []).map(makeupRow) });
  }
  if (p === "/api/eng/makeup" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = String(b.studentId || "");
    if (!sid) return json({ error: "studentId_required" }, 400);
    const id = String(b.id || "") || newId("em");
    const status = ["예정", "완료", "취소"].includes(String(b.status)) ? String(b.status) : "예정";
    const exists = await env.DB.prepare("SELECT id FROM class_eng_makeup WHERE id=?").bind(id).first();
    if (exists) {
      await env.DB
        .prepare("UPDATE class_eng_makeup SET absent_date=?,makeup_date=?,makeup_time=?,status=?,memo=? WHERE id=?")
        .bind(String(b.absentDate || ""), String(b.makeupDate || ""), String(b.makeupTime || ""), status, String(b.memo || ""), id)
        .run();
    } else {
      await env.DB
        .prepare("INSERT INTO class_eng_makeup(id,student_id,absent_date,makeup_date,makeup_time,status,memo,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(id, sid, String(b.absentDate || ""), String(b.makeupDate || ""), String(b.makeupTime || ""), status, String(b.memo || ""), Date.now())
        .run();
    }
    return json({ ok: true, id });
  }
  if (p === "/api/eng/makeup/delete" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB.prepare("DELETE FROM class_eng_makeup WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }

  return null;
}

function makeupRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    studentId: String(r.student_id),
    absentDate: String(r.absent_date ?? ""),
    makeupDate: String(r.makeup_date ?? ""),
    makeupTime: String(r.makeup_time ?? ""),
    status: String(r.status ?? "예정"),
    memo: String(r.memo ?? ""),
    createdAt: Number(r.created_at ?? 0),
  };
}

function reportRow(r: Record<string, unknown>) {
  let scores: Record<string, string> = {};
  try {
    const s = JSON.parse(String(r.scores ?? "{}"));
    if (s && typeof s === "object") scores = s as Record<string, string>;
  } catch {
    /* ignore */
  }
  return {
    studentId: String(r.student_id),
    month: String(r.month),
    teacher: String(r.teacher ?? ""),
    scores,
    comments: String(r.comments ?? ""),
    updatedAt: Number(r.updated_at ?? 0),
  };
}

interface Goal {
  text: string;
  done: boolean;
}
function dailyRow(r: Record<string, unknown>) {
  let goals: Goal[] = [];
  try {
    const g = JSON.parse(String(r.goals ?? "[]"));
    if (Array.isArray(g)) goals = g.map((x) => ({ text: String(x.text ?? ""), done: !!x.done }));
  } catch {
    /* ignore */
  }
  return {
    studentId: String(r.student_id),
    date: String(r.date),
    attended: Number(r.attended) === 1,
    goals,
    homework: String(r.homework ?? ""),
    hwChecked: Number(r.hw_checked) === 1,
    comment: String(r.comment ?? ""),
    materials: String(r.materials ?? ""),
    updatedAt: Number(r.updated_at ?? 0),
  };
}
function progRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    studentId: String(r.student_id),
    book: String(r.book ?? ""),
    level: String(r.level ?? ""),
    status: String(r.status ?? "진행"),
    startDate: String(r.start_date ?? ""),
    memo: String(r.memo ?? ""),
    updatedAt: Number(r.updated_at ?? 0),
  };
}
function testRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    studentId: String(r.student_id),
    date: String(r.date ?? ""),
    name: String(r.name ?? ""),
    score: Number(r.score ?? 0),
    total: Number(r.total ?? 100),
    memo: String(r.memo ?? ""),
  };
}
