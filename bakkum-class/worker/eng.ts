/// <reference types="@cloudflare/workers-types" />
// 영어(신규) 백엔드 — 일일 학습일지 · 진도 · 테스트. 앱(허브) 자체 저장(노션 X).
// 수학과 분리된 class_eng_* 테이블.

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
    // 학생 개별 페이지 커리큘럼 — 학생-1건. 항목 배열 [{label,value}](단어시험·class5·Link교재·원서·기초영문법·필기체 등). 강사 편집.
    "CREATE TABLE IF NOT EXISTS class_eng_curriculum (student_id TEXT PRIMARY KEY, items TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL DEFAULT 0)",
  ];
  for (const s of stmts) {
    try {
      await env.DB.prepare(s).run();
    } catch {
      /* ignore */
    }
  }
  // 출결 상태 확장 — 출석/지각/결석 + 지각 분 + 결석 사유. (기존 attended 0/1과 병행)
  for (const a of [
    "ALTER TABLE class_eng_daily ADD COLUMN att_status TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_eng_daily ADD COLUMN late_min INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE class_eng_daily ADD COLUMN absent_reason TEXT NOT NULL DEFAULT ''",
    // 중고등영어 숙제 3분류(단어·리딩·문법) + 틀단확인. (노션 과제기록과 동일)
    "ALTER TABLE class_eng_daily ADD COLUMN hw_word TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_eng_daily ADD COLUMN hw_reading TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_eng_daily ADD COLUMN hw_grammar TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_eng_daily ADD COLUMN wrong_check INTEGER NOT NULL DEFAULT 0",
    // 포인트 제도(노션 수업기록과 동일): 수업태도·적립차감 사유·합계·특이사항.
    "ALTER TABLE class_eng_daily ADD COLUMN attitude TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_eng_daily ADD COLUMN point_reasons TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE class_eng_daily ADD COLUMN points INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE class_eng_daily ADD COLUMN note TEXT NOT NULL DEFAULT ''",
    // 초등영어 수업일지 — 원서진도번호·단어시험·활동 체크리스트.
    "ALTER TABLE class_eng_daily ADD COLUMN book_no TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_eng_daily ADD COLUMN word_test TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_eng_daily ADD COLUMN done_items TEXT NOT NULL DEFAULT '[]'",
    // 학생이 직접 적는 수업 시작/끝 시간(초등 개별 페이지 일지).
    "ALTER TABLE class_eng_daily ADD COLUMN start_time TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_eng_daily ADD COLUMN end_time TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      await env.DB.prepare(a).run();
    } catch {
      /* 이미 있으면 무시 */
    }
  }
  // 출결 용어 통일(수학에 맞춤): 기존 '등원' 저장값을 '출석'으로 1회 마이그레이션.
  try {
    await env.DB.prepare("UPDATE class_eng_daily SET att_status='출석' WHERE att_status='등원'").run();
  } catch {
    /* ignore */
  }
}

export async function handleEng(env: Env, request: Request, p: string, me: SessionUser): Promise<Response | null> {
  const m = request.method;
  await ensureEngTables(env);
  const url = new URL(request.url);

  /* ---------------- 포인트 랭킹 ---------------- */
  if (p === "/api/eng/ranking" && m === "GET") {
    const r = await env.DB
      .prepare(
        "SELECT d.student_id sid, SUM(d.points) pts, COUNT(*) cnt, s.name name, s.grade grade FROM class_eng_daily d JOIN students s ON s.id = CAST(d.student_id AS INTEGER) WHERE (s.hidden IS NULL OR s.hidden=0) GROUP BY d.student_id ORDER BY pts DESC, s.name"
      )
      .all<Record<string, unknown>>();
    return json({
      ranking: (r.results || []).map((x) => ({ studentId: String(x.sid), name: String(x.name ?? ""), grade: String(x.grade ?? ""), points: Number(x.pts) || 0, days: Number(x.cnt) || 0 })),
    });
  }

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
    // 출결 상태 — '출석/지각/결석'. 구버전 '등원'은 '출석'으로 정규화.
    let status = ["출석", "등원", "지각", "결석"].includes(String(b.attStatus)) ? String(b.attStatus) : "";
    if (status === "등원") status = "출석";
    const lateMin = Number(b.lateMin) || 0;
    const reason = String(b.absentReason || "");
    // 상태가 있으면 그걸로 출석여부 판단(출석·지각=출석). 없으면 기존 attended 불린.
    const attended = status ? (status === "출석" || status === "지각" ? 1 : 0) : b.attended ? 1 : 0;
    const hwSt = (v: unknown) => (["완료", "미흡", "안함", "없음"].includes(String(v)) ? String(v) : "");
    // 포인트: 사유 라벨들의 끝 숫자(±) 합으로 계산(노션 포인트 공식과 동일).
    const reasons = Array.isArray(b.pointReasons) ? (b.pointReasons as unknown[]).map((x) => String(x)) : [];
    const points = reasons.reduce((n, r) => { const m = /(-?\d+)\s*$/.exec(r); return n + (m ? parseInt(m[1], 10) : 0); }, 0);
    const doneItems = Array.isArray(b.doneItems) ? (b.doneItems as unknown[]).map((x) => String(x)) : [];
    await env.DB
      .prepare(
        "INSERT INTO class_eng_daily(student_id,date,attended,att_status,late_min,absent_reason,goals,homework,hw_checked,hw_word,hw_reading,hw_grammar,wrong_check,attitude,point_reasons,points,note,book_no,word_test,done_items,comment,materials,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(student_id,date) DO UPDATE SET attended=excluded.attended, att_status=excluded.att_status, late_min=excluded.late_min, absent_reason=excluded.absent_reason, goals=excluded.goals, homework=excluded.homework, hw_checked=excluded.hw_checked, hw_word=excluded.hw_word, hw_reading=excluded.hw_reading, hw_grammar=excluded.hw_grammar, wrong_check=excluded.wrong_check, attitude=excluded.attitude, point_reasons=excluded.point_reasons, points=excluded.points, note=excluded.note, book_no=excluded.book_no, word_test=excluded.word_test, done_items=excluded.done_items, comment=excluded.comment, materials=excluded.materials, updated_at=excluded.updated_at"
      )
      .bind(sid, date, attended, status, lateMin, reason, goals, String(b.homework || ""), b.hwChecked ? 1 : 0, hwSt(b.hwWord), hwSt(b.hwReading), hwSt(b.hwGrammar), b.wrongCheck ? 1 : 0, String(b.attitude || ""), JSON.stringify(reasons), points, String(b.note || ""), String(b.bookNo || ""), String(b.wordTest || ""), JSON.stringify(doneItems), String(b.comment || ""), String(b.materials || ""), Date.now())
      .run();
    // 결석 → 보강 관리로 연결: 같은 학생·결석일의 보강이 없으면 '예정'으로 자동 생성.
    if (status === "결석") {
      try {
        const ex = await env.DB.prepare("SELECT id FROM class_eng_makeup WHERE student_id=? AND absent_date=?").bind(sid, date).first();
        if (!ex) {
          await env.DB
            .prepare("INSERT INTO class_eng_makeup(id,student_id,absent_date,makeup_date,makeup_time,status,memo,created_at) VALUES(?,?,?,?,?,?,?,?)")
            .bind(newId("em"), sid, date, "", "", "예정", reason, Date.now())
            .run();
        }
      } catch {
        /* 보강 자동생성 실패해도 출결 저장은 유지 */
      }
    }
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

/* ================= 학생 개별 페이지 =================
   학생 본인(role=student, sub=학생id)과 강사·원장이 함께 쓴다.
   - 학생: 본인 페이지만(시간표·커리큘럼 조회 + 본인 일지 입력).
   - 강사/원장: 임의 학생(student_id) 페이지 + 커리큘럼 편집. */

/** 신규 학생 커리큘럼 기본 항목(초등 영어 — 노션 진도표 구성). */
const CURRICULUM_DEFAULTS = ["단어시험", "class5", "Link 교재", "원서 독서기록", "기초영문법", "필기체"];

interface CurriculumItem {
  label: string;
  value: string;
}

function parseCurriculum(s: unknown): CurriculumItem[] {
  try {
    const a = JSON.parse(String(s ?? "[]"));
    if (Array.isArray(a)) return a.map((x) => ({ label: String((x as Record<string, unknown>)?.label ?? ""), value: String((x as Record<string, unknown>)?.value ?? "") })).filter((x) => x.label);
  } catch {
    /* ignore */
  }
  return [];
}

export async function handleStudent(env: Env, request: Request, p: string, me: SessionUser): Promise<Response | null> {
  const m = request.method;
  await ensureEngTables(env);
  const url = new URL(request.url);
  const isStaff = me.role !== "student";

  /** 대상 학생 id 결정 — 학생은 무조건 본인, 강사는 파라미터/바디. */
  function targetId(fromBody?: string): string {
    if (!isStaff) return me.sub;
    return String(fromBody || url.searchParams.get("student_id") || "").trim();
  }

  /* ---- 페이지 데이터(학생 정보 + 시간표 + 커리큘럼 + 일지 이력) ---- */
  if (p === "/api/student/page" && m === "GET") {
    const sid = targetId();
    if (!sid) return json({ error: "student_required" }, 400);

    const sRow = await env.DB
      .prepare("SELECT id,name,grade,school FROM students WHERE id=? AND (hidden IS NULL OR hidden=0)")
      .bind(Number(sid))
      .first<{ id: number; name: string; grade: string; school: string }>();
    if (!sRow) return json({ error: "not_found" }, 404);

    let band = "";
    let photo = "";
    try {
      const meta = await env.DB.prepare("SELECT english_band, photo FROM class_student_meta WHERE student_id=?").bind(sid).first<{ english_band: string; photo: string }>();
      band = String(meta?.english_band ?? "");
      photo = String(meta?.photo ?? "");
    } catch {
      /* meta 없으면 기본값 */
    }

    const slotsRes = await env.DB
      .prepare("SELECT day, time, duration FROM class_eng_lessons WHERE student_id=?")
      .bind(sid)
      .all<{ day: string; time: string; duration: number }>();
    const engSlots = (slotsRes.results || []).map((r) => ({ day: String(r.day), time: String(r.time), duration: Number(r.duration) }));

    const curRow = await env.DB.prepare("SELECT items FROM class_eng_curriculum WHERE student_id=?").bind(sid).first<{ items: string }>();
    const curriculum = parseCurriculum(curRow?.items);

    const dRes = await env.DB.prepare("SELECT * FROM class_eng_daily WHERE student_id=? ORDER BY date DESC LIMIT 120").bind(sid).all<Record<string, unknown>>();
    const daily = (dRes.results || []).map(dailyRow);

    return json({
      role: me.role,
      canEditCurriculum: isStaff,
      student: { id: String(sRow.id), name: String(sRow.name ?? ""), grade: String(sRow.grade ?? ""), school: String(sRow.school ?? ""), band, photo },
      engSlots,
      curriculum,
      daily,
    });
  }

  /* ---- 일지 입력(학생 본인 또는 강사) — 학습 로그 칸만 저장, 출결은 건드리지 않음 ---- */
  if (p === "/api/student/log" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = targetId(b.studentId as string);
    const date = String(b.date || "");
    if (!sid || !date) return json({ error: "bad_input" }, 400);
    const doneItems = Array.isArray(b.doneItems) ? (b.doneItems as unknown[]).map((x) => String(x)) : [];
    // 학생이 일지를 적으면 그 날 '출석'으로 간주(기존 출결값이 없을 때만 채움 — 강사 출결 보존).
    await env.DB
      .prepare(
        "INSERT INTO class_eng_daily(student_id,date,attended,att_status,book_no,word_test,done_items,start_time,end_time,comment,updated_at) VALUES(?,?,1,'출석',?,?,?,?,?,?,?) " +
          "ON CONFLICT(student_id,date) DO UPDATE SET attended=1, att_status=CASE WHEN class_eng_daily.att_status='' THEN '출석' ELSE class_eng_daily.att_status END, " +
          "book_no=excluded.book_no, word_test=excluded.word_test, done_items=excluded.done_items, start_time=excluded.start_time, end_time=excluded.end_time, comment=excluded.comment, updated_at=excluded.updated_at"
      )
      .bind(sid, date, String(b.bookNo || ""), String(b.wordTest || ""), JSON.stringify(doneItems), String(b.startTime || ""), String(b.endTime || ""), String(b.comment || ""), Date.now())
      .run();
    return json({ ok: true });
  }

  /* ---- 커리큘럼 저장(강사·원장 전용) ---- */
  if (p === "/api/student/curriculum" && m === "POST") {
    if (!isStaff) return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = String(b.studentId || "").trim();
    if (!sid) return json({ error: "student_required" }, 400);
    const items = Array.isArray(b.items)
      ? (b.items as unknown[]).map((x) => ({ label: String((x as Record<string, unknown>)?.label ?? "").trim(), value: String((x as Record<string, unknown>)?.value ?? "") })).filter((x) => x.label).slice(0, 40)
      : [];
    await env.DB
      .prepare("INSERT INTO class_eng_curriculum(student_id,items,updated_at) VALUES(?,?,?) ON CONFLICT(student_id) DO UPDATE SET items=excluded.items, updated_at=excluded.updated_at")
      .bind(sid, JSON.stringify(items), Date.now())
      .run();
    return json({ ok: true });
  }

  /* ---- 커리큘럼 기본 항목 시드(강사가 '기본 항목 채우기') ---- */
  if (p === "/api/student/curriculum/defaults" && m === "GET") {
    return json({ defaults: CURRICULUM_DEFAULTS });
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
    attStatus: String(r.att_status ?? ""),
    lateMin: Number(r.late_min ?? 0),
    absentReason: String(r.absent_reason ?? ""),
    goals,
    homework: String(r.homework ?? ""),
    hwChecked: Number(r.hw_checked) === 1,
    hwWord: String(r.hw_word ?? ""),
    hwReading: String(r.hw_reading ?? ""),
    hwGrammar: String(r.hw_grammar ?? ""),
    wrongCheck: Number(r.wrong_check ?? 0) === 1,
    attitude: String(r.attitude ?? ""),
    pointReasons: (() => { try { const a = JSON.parse(String(r.point_reasons ?? "[]")); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } })(),
    points: Number(r.points ?? 0),
    note: String(r.note ?? ""),
    bookNo: String(r.book_no ?? ""),
    wordTest: String(r.word_test ?? ""),
    doneItems: (() => { try { const a = JSON.parse(String(r.done_items ?? "[]")); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } })(),
    startTime: String(r.start_time ?? ""),
    endTime: String(r.end_time ?? ""),
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
