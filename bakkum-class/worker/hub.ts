/// <reference types="@cloudflare/workers-types" />
// 통합 허브 공유 영역 백엔드 — 강사 특이사항 · 매뉴얼 위키 · SNS 관리 · 공유 업무 보드.
// 모두 추가전용 class_* 테이블(자가 생성). 기존 수학/모각공 데이터 무영향.

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

// 스키마 보장은 워커 isolate당 1회만 — 매 요청마다 수십 개의 CREATE/ALTER 왕복을 돌면 전반적으로 느려진다.
// 새 배포 시 새 isolate라 다시 1회 실행되므로 컬럼 추가가 반영된다.
let hubReady = false;
export async function ensureHubTables(env: Env): Promise<void> {
  if (hubReady) return;
  const stmts = [
    // 강사 특이사항(학생별 시간순 누적, 공용)
    "CREATE TABLE IF NOT EXISTS class_notes (id TEXT PRIMARY KEY, student_id TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0)",
    // 바꿈 매뉴얼 위키
    "CREATE TABLE IF NOT EXISTS class_wiki (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', importance INTEGER NOT NULL DEFAULT 2, status TEXT NOT NULL DEFAULT 'draft', updated_by TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0)",
    // SNS 관리
    "CREATE TABLE IF NOT EXISTS class_sns (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'wait', link TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)",
    // 공유 업무 보드(칸반) — class_tasks 는 수학 앱과 공유.
    "CREATE TABLE IF NOT EXISTS class_tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo', tag TEXT NOT NULL DEFAULT '', due TEXT NOT NULL DEFAULT '', student_id TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, done_at INTEGER, archived INTEGER NOT NULL DEFAULT 0)",
    // 학원 일정(공용) — 전 스태프가 보고 추가·수정. 앱이 주인(노션 X).
    "CREATE TABLE IF NOT EXISTS class_events (id TEXT PRIMARY KEY, date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '학원', memo TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)",
    // 시간표 변경 요청 — 한 학생의 수업시간 임시 변경을 담당/지정 강사에게 요청 → 승인.
    "CREATE TABLE IF NOT EXISTS class_change_reqs (id TEXT PRIMARY KEY, student_id TEXT NOT NULL DEFAULT '', student_name TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', change_date TEXT NOT NULL DEFAULT '', from_time TEXT NOT NULL DEFAULT '', to_time TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', requester_id TEXT NOT NULL DEFAULT '', requester_name TEXT NOT NULL DEFAULT '', target_id TEXT NOT NULL DEFAULT '', target_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', response TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)",
    // 자료/프린트 배부(공용: 수학·영어) — 인쇄할 프린트 목록. printed: 0 인쇄대기·1 인쇄완료.
    "CREATE TABLE IF NOT EXISTS class_materials (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', printed INTEGER NOT NULL DEFAULT 0, author_id TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0)",
    // 자료 배부 내역 — 학생에게 수업(lesson)/숙제(hw)로 배부. done: 완료 여부.
    "CREATE TABLE IF NOT EXISTS class_material_assign (id TEXT PRIMARY KEY, material_id TEXT NOT NULL DEFAULT '', student_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'lesson', date TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0)",
  ];
  for (const s of stmts) {
    try {
      await env.DB.prepare(s).run();
    } catch {
      /* ignore */
    }
  }
  // 노션 가져오기용 출처 id 컬럼(있으면 무시). 재가져오기 시 중복 방지·교체 기준.
  for (const a of [
    "ALTER TABLE class_wiki ADD COLUMN src TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_sns ADD COLUMN src TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_wiki ADD COLUMN images TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE class_sns ADD COLUMN images TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE class_events ADD COLUMN src TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_tasks ADD COLUMN assignee TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'",
    // 원장 전용(강사 비공개) — 노션 '미나' 상태처럼 배정 전 단계. 원장만 보임.
    "ALTER TABLE class_tasks ADD COLUMN admin_only INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE class_tasks ADD COLUMN assign_date TEXT NOT NULL DEFAULT ''",
    // 시간표 변경요청 — 1회성 수업 이동(원래 날짜 → 변경 날짜). 기존 change_date=변경 날짜.
    "ALTER TABLE class_change_reqs ADD COLUMN from_date TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_change_reqs ADD COLUMN to_date TEXT NOT NULL DEFAULT ''",
    // 자료/프린트 — 인쇄 문서 경로·부수·담당자·대상 학교/학년(학교+학년 선택 시 인원수만큼 자동 부수).
    "ALTER TABLE class_materials ADD COLUMN file_path TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_materials ADD COLUMN copies INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE class_materials ADD COLUMN assignee TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_materials ADD COLUMN school TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_materials ADD COLUMN grade TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      await env.DB.prepare(a).run();
    } catch {
      /* 이미 있으면 무시 */
    }
  }
  hubReady = true;
}

/** 허브 공유 영역 라우팅. 처리하면 Response, 아니면 null. */
export async function handleHub(
  env: Env,
  request: Request,
  p: string,
  me: SessionUser
): Promise<Response | null> {
  const m = request.method;
  await ensureHubTables(env);

  /* ---------------- 특이사항 ---------------- */
  if (p === "/api/notes" && m === "GET") {
    const url = new URL(request.url);
    const sid = url.searchParams.get("student_id") || "";
    const q = sid
      ? env.DB.prepare("SELECT * FROM class_notes WHERE student_id=? ORDER BY created_at DESC").bind(sid)
      : env.DB.prepare("SELECT * FROM class_notes ORDER BY created_at DESC LIMIT 500");
    const r = await q.all<Record<string, unknown>>();
    return json({ notes: (r.results || []).map(noteRow) });
  }
  if (p === "/api/notes" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { studentId?: string; body?: string };
    const body = (b.body || "").trim();
    if (!b.studentId || !body) return json({ error: "bad_input" }, 400);
    const id = newId("note");
    await env.DB
      .prepare("INSERT INTO class_notes(id,student_id,author_id,author_name,body,created_at) VALUES(?,?,?,?,?,?)")
      .bind(id, String(b.studentId), me.sub, me.name, body.slice(0, 4000), Date.now())
      .run();
    return json({ ok: true, id });
  }
  if (p === "/api/notes/delete" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    // 작성자 본인 또는 원장만 삭제
    const row = await env.DB.prepare("SELECT author_id FROM class_notes WHERE id=?").bind(b.id).first<{ author_id: string }>();
    if (row && row.author_id !== me.sub && me.role !== "admin") return json({ error: "forbidden" }, 403);
    await env.DB.prepare("DELETE FROM class_notes WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }

  /* ---------------- 학원 일정 (공용: 전원 열람·수정) ---------------- */
  if (p === "/api/events" && m === "GET") {
    const url = new URL(request.url);
    const since = url.searchParams.get("since") || "";
    const q = since
      ? env.DB.prepare("SELECT * FROM class_events WHERE date>=? ORDER BY date, created_at").bind(since)
      : env.DB.prepare("SELECT * FROM class_events ORDER BY date, created_at");
    const r = await q.all<Record<string, unknown>>();
    return json({ events: (r.results || []).map(eventRow) });
  }
  if (p === "/api/events" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as {
      id?: string; date?: string; endDate?: string; title?: string; category?: string; memo?: string;
    };
    const date = (b.date || "").trim();
    const title = (b.title || "").trim();
    if (!date || !title) return json({ error: "bad_input" }, 400);
    const endDate = (b.endDate || "").trim();
    const category = (b.category || "학원").trim().slice(0, 20);
    const memo = (b.memo || "").slice(0, 2000);
    const now = Date.now();
    if (b.id) {
      await env.DB
        .prepare("UPDATE class_events SET date=?,end_date=?,title=?,category=?,memo=?,updated_at=? WHERE id=?")
        .bind(date, endDate, title.slice(0, 200), category, memo, now, b.id)
        .run();
      return json({ ok: true, id: b.id });
    }
    const id = newId("ev");
    await env.DB
      .prepare("INSERT INTO class_events(id,date,end_date,title,category,memo,author_id,author_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(id, date, endDate, title.slice(0, 200), category, memo, me.sub, me.name, now, now)
      .run();
    return json({ ok: true, id });
  }
  if (p === "/api/events/delete" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB.prepare("DELETE FROM class_events WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }

  /* ---------------- 자료/프린트 배부 (공용: 수학·영어) ---------------- */
  // 자료 목록 + 자료별 배부 건수(수업/숙제/완료) 요약.
  if (p === "/api/materials" && m === "GET") {
    const url = new URL(request.url);
    const subject = url.searchParams.get("subject") || "";
    const q = subject
      ? env.DB.prepare("SELECT * FROM class_materials WHERE archived=0 AND (subject=? OR subject='') ORDER BY printed, created_at DESC").bind(subject)
      : env.DB.prepare("SELECT * FROM class_materials WHERE archived=0 ORDER BY printed, created_at DESC");
    const r = await q.all<Record<string, unknown>>();
    const aRes = await env.DB.prepare("SELECT material_id, kind, done FROM class_material_assign").all<Record<string, unknown>>();
    const stat: Record<string, { lesson: number; hw: number; done: number; total: number }> = {};
    for (const a of aRes.results || []) {
      const mid = String(a.material_id);
      const s = (stat[mid] ||= { lesson: 0, hw: 0, done: 0, total: 0 });
      s.total++;
      if (String(a.kind) === "hw") s.hw++; else s.lesson++;
      if (Number(a.done) === 1) s.done++;
    }
    return json({ materials: (r.results || []).map((x) => ({ ...materialRow(x), stat: stat[String(x.id)] || { lesson: 0, hw: 0, done: 0, total: 0 } })) });
  }
  // 자료 등록/수정.
  if (p === "/api/materials" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string; name?: string; subject?: string; memo?: string; filePath?: string; copies?: unknown; assignee?: string; school?: string; grade?: string };
    const name = (b.name || "").trim();
    if (!name) return json({ error: "name_required" }, 400);
    const subject = b.subject === "math" || b.subject === "english" ? b.subject : "";
    const memo = (b.memo || "").slice(0, 1000);
    const filePath = (b.filePath || "").slice(0, 500);
    const copies = Math.max(0, Math.min(9999, Math.round(Number(b.copies) || 0)));
    const assignee = (b.assignee || "").slice(0, 100);
    const school = (b.school || "").slice(0, 100);
    const grade = (b.grade || "").slice(0, 50);
    if (b.id) {
      await env.DB.prepare("UPDATE class_materials SET name=?,subject=?,memo=?,file_path=?,copies=?,assignee=?,school=?,grade=? WHERE id=?").bind(name.slice(0, 200), subject, memo, filePath, copies, assignee, school, grade, b.id).run();
      return json({ ok: true, id: b.id });
    }
    const id = newId("mat");
    await env.DB.prepare("INSERT INTO class_materials(id,name,subject,memo,printed,author_id,author_name,file_path,copies,assignee,school,grade,created_at) VALUES(?,?,?,?,0,?,?,?,?,?,?,?,?)").bind(id, name.slice(0, 200), subject, memo, me.sub, me.name, filePath, copies, assignee, school, grade, Date.now()).run();
    return json({ ok: true, id });
  }
  // 인쇄 완료/대기 토글.
  if (p === "/api/materials/print" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string; printed?: boolean };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB.prepare("UPDATE class_materials SET printed=? WHERE id=?").bind(b.printed ? 1 : 0, b.id).run();
    return json({ ok: true });
  }
  // 자료 삭제(배부 내역도 함께).
  if (p === "/api/materials/delete" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB.prepare("DELETE FROM class_material_assign WHERE material_id=?").bind(b.id).run();
    await env.DB.prepare("DELETE FROM class_materials WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }
  // 배부 내역 조회 — 자료별(material_id) 또는 학생별(student_id).
  if (p === "/api/materials/assign" && m === "GET") {
    const url = new URL(request.url);
    const mid = url.searchParams.get("material_id") || "";
    const sid = url.searchParams.get("student_id") || "";
    let q;
    if (mid) q = env.DB.prepare("SELECT * FROM class_material_assign WHERE material_id=? ORDER BY created_at DESC").bind(mid);
    else if (sid) q = env.DB.prepare("SELECT * FROM class_material_assign WHERE student_id=? ORDER BY created_at DESC").bind(sid);
    else q = env.DB.prepare("SELECT * FROM class_material_assign ORDER BY created_at DESC LIMIT 1000");
    const r = await q.all<Record<string, unknown>>();
    return json({ assigns: (r.results || []).map(assignRow) });
  }
  // 자료 배부 — 학생들에게 수업(lesson)/숙제(hw)로. 같은 자료·학생·종류 중복 방지.
  if (p === "/api/materials/assign" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { materialId?: string; studentIds?: unknown; kind?: string; date?: string };
    const mid = String(b.materialId || "");
    const ids = Array.isArray(b.studentIds) ? b.studentIds.map((x) => String(x)).filter(Boolean) : [];
    if (!mid || !ids.length) return json({ error: "bad_input" }, 400);
    const kind = b.kind === "hw" ? "hw" : "lesson";
    const date = String(b.date || "");
    const now = Date.now();
    let added = 0;
    for (const sid of ids) {
      const ex = await env.DB.prepare("SELECT id FROM class_material_assign WHERE material_id=? AND student_id=? AND kind=?").bind(mid, sid, kind).first();
      if (ex) continue;
      await env.DB.prepare("INSERT INTO class_material_assign(id,material_id,student_id,kind,date,done,created_by,created_at) VALUES(?,?,?,?,?,0,?,?)").bind(newId("ma"), mid, sid, kind, date, me.sub, now).run();
      added++;
    }
    return json({ ok: true, added });
  }
  // 배부 완료/미완료 토글.
  if (p === "/api/materials/assign/done" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string; done?: boolean };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB.prepare("UPDATE class_material_assign SET done=? WHERE id=?").bind(b.done ? 1 : 0, b.id).run();
    return json({ ok: true });
  }
  // 배부 취소(개별).
  if (p === "/api/materials/assign/delete" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB.prepare("DELETE FROM class_material_assign WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }

  /* ---------------- 시간표 변경 요청 ---------------- */
  if (p === "/api/reqs" && m === "GET") {
    const r = await env.DB.prepare("SELECT * FROM class_change_reqs ORDER BY created_at DESC LIMIT 300").all<Record<string, unknown>>();
    return json({ reqs: (r.results || []).map(reqRow) });
  }
  if (p === "/api/reqs" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = String(b.studentId || "");
    const subject = String(b.subject) === "english" ? "english" : "math";
    // 변경 날짜(=수업이 새로 잡히는 날). 호환: changeDate 또는 toDate.
    const toDate = String(b.toDate || b.changeDate || "");
    const fromDate = String(b.fromDate || toDate);
    if (!sid || !toDate || !b.toTime) return json({ error: "bad_input" }, 400);
    const id = newId("req");
    const now = Date.now();
    // kind=log → 승인 불필요 1회성 변경 '기록'(즉시 반영). 기본은 'pending'(승인 요청).
    const status = String(b.kind) === "log" ? "logged" : "pending";
    await env.DB
      .prepare("INSERT INTO class_change_reqs(id,student_id,student_name,subject,change_date,from_date,to_date,from_time,to_time,reason,requester_id,requester_name,target_id,target_name,status,response,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, sid, String(b.studentName || ""), subject, toDate, fromDate, toDate, String(b.fromTime || ""), String(b.toTime), String(b.reason || "").slice(0, 1000), me.sub, me.name, String(b.targetId || ""), String(b.targetName || ""), status, "", now, now)
      .run();
    return json({ ok: true, id });
  }
  if (p === "/api/reqs/respond" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string; status?: string; response?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    const status = b.status === "approved" || b.status === "rejected" ? b.status : "pending";
    await env.DB
      .prepare("UPDATE class_change_reqs SET status=?, response=?, updated_at=? WHERE id=?")
      .bind(status, String(b.response || "").slice(0, 1000), Date.now(), b.id)
      .run();
    return json({ ok: true });
  }
  // 철회 — 요청한 사람만 자기 요청을 취소(철회) 가능.
  if (p === "/api/reqs/withdraw" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB
      .prepare("UPDATE class_change_reqs SET status='withdrawn', updated_at=? WHERE id=? AND requester_id=?")
      .bind(Date.now(), b.id, me.sub)
      .run();
    return json({ ok: true });
  }

  /* ---------------- 매뉴얼 위키 ---------------- */
  if (p === "/api/wiki" && m === "GET") {
    const r = await env.DB.prepare("SELECT * FROM class_wiki ORDER BY updated_at DESC").all<Record<string, unknown>>();
    return json({ pages: (r.results || []).map(wikiRow) });
  }
  if (p === "/api/wiki" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as {
      id?: string;
      title?: string;
      body?: string;
      importance?: number;
      status?: string;
      images?: string[];
    };
    const title = (b.title || "").trim();
    if (!title) return json({ error: "title_required" }, 400);
    const importance = Math.min(4, Math.max(1, Number(b.importance) || 2));
    const status = ["draft", "writing", "review", "current", "outdated"].includes(String(b.status)) ? String(b.status) : "draft";
    const imgs = JSON.stringify(Array.isArray(b.images) ? b.images.map(String) : []);
    const now = Date.now();
    if (b.id) {
      await env.DB
        .prepare("UPDATE class_wiki SET title=?,body=?,importance=?,status=?,images=?,updated_by=?,updated_at=? WHERE id=?")
        .bind(title, b.body || "", importance, status, imgs, me.name, now, b.id)
        .run();
      return json({ ok: true, id: b.id });
    }
    const id = newId("wiki");
    await env.DB
      .prepare("INSERT INTO class_wiki(id,title,body,importance,status,images,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(id, title, b.body || "", importance, status, imgs, me.name, now)
      .run();
    return json({ ok: true, id });
  }
  if (p === "/api/wiki/delete" && m === "POST") {
    if (me.role !== "admin") return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB.prepare("DELETE FROM class_wiki WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }

  /* ---------------- SNS 관리 ---------------- */
  if (p === "/api/sns" && m === "GET") {
    const r = await env.DB.prepare("SELECT * FROM class_sns ORDER BY created_at DESC").all<Record<string, unknown>>();
    return json({ posts: (r.results || []).map(snsRow) });
  }
  if (p === "/api/sns" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as {
      id?: string;
      title?: string;
      body?: string;
      channel?: string;
      status?: string;
      link?: string;
      images?: string[];
    };
    const title = (b.title || "").trim();
    if (!title && !b.id) return json({ error: "title_required" }, 400);
    const status = ["wait", "edit", "stop", "done"].includes(String(b.status)) ? String(b.status) : "wait";
    const imgs = JSON.stringify(Array.isArray(b.images) ? b.images.map(String) : []);
    const now = Date.now();
    if (b.id) {
      await env.DB
        .prepare("UPDATE class_sns SET title=?,body=?,channel=?,status=?,link=?,images=?,updated_at=? WHERE id=?")
        .bind(title, b.body || "", b.channel || "", status, b.link || "", imgs, now, b.id)
        .run();
      return json({ ok: true, id: b.id });
    }
    const id = newId("sns");
    await env.DB
      .prepare(
        "INSERT INTO class_sns(id,title,body,channel,author_id,author_name,status,link,images,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
      )
      .bind(id, title, b.body || "", b.channel || "", me.sub, me.name, status, b.link || "", imgs, now, now)
      .run();
    return json({ ok: true, id });
  }
  if (p === "/api/sns/delete" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    const row = await env.DB.prepare("SELECT author_id FROM class_sns WHERE id=?").bind(b.id).first<{ author_id: string }>();
    if (row && row.author_id !== me.sub && me.role !== "admin") return json({ error: "forbidden" }, 403);
    await env.DB.prepare("DELETE FROM class_sns WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }

  /* ---------------- 공유 업무 보드 (class_tasks 라이브) ---------------- */
  if (p === "/api/tasks" && m === "GET") {
    const r = await env.DB.prepare("SELECT * FROM class_tasks ORDER BY created_at DESC").all<Record<string, unknown>>();
    return json({ tasks: (r.results || []).map(taskRow) });
  }
  if (p === "/api/tasks" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(b.id || "") || newId("task");
    const status = ["todo", "doing", "done"].includes(String(b.status)) ? String(b.status) : "todo";
    const exists = await env.DB.prepare("SELECT id FROM class_tasks WHERE id=?").bind(id).first<{ id: string }>();
    const doneAt = status === "done" ? (b.doneAt ? Number(b.doneAt) : Date.now()) : null;
    const priority = String(b.priority) === "urgent" ? "urgent" : "normal";
    const assignee = String(b.assignee || "");
    const adminOnly = b.adminOnly ? 1 : 0;
    const assignDate = String(b.assignDate || "");
    if (exists) {
      await env.DB
        .prepare("UPDATE class_tasks SET title=?,status=?,tag=?,due=?,student_id=?,memo=?,assignee=?,priority=?,admin_only=?,assign_date=?,done_at=?,archived=? WHERE id=?")
        .bind(
          String(b.title || ""),
          status,
          String(b.tag || ""),
          String(b.due || ""),
          String(b.studentId || ""),
          String(b.memo || ""),
          assignee,
          priority,
          adminOnly,
          assignDate,
          doneAt,
          b.archived ? 1 : 0,
          id
        )
        .run();
    } else {
      await env.DB
        .prepare(
          "INSERT INTO class_tasks(id,title,status,tag,due,student_id,memo,assignee,priority,admin_only,assign_date,source,created_at,done_at,archived) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        )
        .bind(
          id,
          String(b.title || ""),
          status,
          String(b.tag || ""),
          String(b.due || ""),
          String(b.studentId || ""),
          String(b.memo || ""),
          assignee,
          priority,
          adminOnly,
          assignDate,
          String(b.source || ""),
          Date.now(),
          doneAt,
          b.archived ? 1 : 0
        )
        .run();
    }
    return json({ ok: true, id });
  }
  if (p === "/api/tasks/delete" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB.prepare("DELETE FROM class_tasks WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }

  return null;
}

/* ---------------- row mappers ---------------- */
function noteRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    studentId: String(r.student_id ?? ""),
    authorId: String(r.author_id ?? ""),
    authorName: String(r.author_name ?? ""),
    body: String(r.body ?? ""),
    createdAt: Number(r.created_at ?? 0),
  };
}
function reqRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    studentId: String(r.student_id ?? ""),
    studentName: String(r.student_name ?? ""),
    subject: String(r.subject ?? "math"),
    changeDate: String(r.change_date ?? ""),
    fromDate: String(r.from_date ?? r.change_date ?? ""),
    toDate: String(r.to_date ?? r.change_date ?? ""),
    fromTime: String(r.from_time ?? ""),
    toTime: String(r.to_time ?? ""),
    reason: String(r.reason ?? ""),
    requesterId: String(r.requester_id ?? ""),
    requesterName: String(r.requester_name ?? ""),
    targetId: String(r.target_id ?? ""),
    targetName: String(r.target_name ?? ""),
    status: String(r.status ?? "pending"),
    response: String(r.response ?? ""),
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  };
}
function eventRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    date: String(r.date ?? ""),
    endDate: String(r.end_date ?? ""),
    title: String(r.title ?? ""),
    category: String(r.category ?? "학원"),
    memo: String(r.memo ?? ""),
    authorId: String(r.author_id ?? ""),
    authorName: String(r.author_name ?? ""),
    updatedAt: Number(r.updated_at ?? 0),
  };
}
function materialRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    subject: String(r.subject ?? ""),
    memo: String(r.memo ?? ""),
    printed: Number(r.printed ?? 0) === 1,
    authorName: String(r.author_name ?? ""),
    filePath: String(r.file_path ?? ""),
    copies: Number(r.copies ?? 0),
    assignee: String(r.assignee ?? ""),
    school: String(r.school ?? ""),
    grade: String(r.grade ?? ""),
    createdAt: Number(r.created_at ?? 0),
  };
}
function assignRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    materialId: String(r.material_id ?? ""),
    studentId: String(r.student_id ?? ""),
    kind: String(r.kind ?? "lesson"),
    date: String(r.date ?? ""),
    done: Number(r.done ?? 0) === 1,
    createdAt: Number(r.created_at ?? 0),
  };
}
function parseImgs(v: unknown): string[] {
  try {
    const a = JSON.parse(String(v ?? "[]"));
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}
function wikiRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    importance: Number(r.importance ?? 2),
    status: String(r.status ?? "draft"),
    images: parseImgs(r.images),
    updatedBy: String(r.updated_by ?? ""),
    updatedAt: Number(r.updated_at ?? 0),
  };
}
function snsRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    channel: String(r.channel ?? ""),
    authorName: String(r.author_name ?? ""),
    status: String(r.status ?? "wait"),
    link: String(r.link ?? ""),
    images: parseImgs(r.images),
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  };
}
function taskRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    status: r.status === "doing" ? "doing" : r.status === "done" ? "done" : "todo",
    tag: String(r.tag ?? ""),
    due: String(r.due ?? ""),
    studentId: String(r.student_id ?? ""),
    memo: String(r.memo ?? ""),
    assignee: String(r.assignee ?? ""),
    priority: r.priority === "urgent" ? "urgent" : "normal",
    source: String(r.source ?? ""),
    createdAt: Number(r.created_at ?? 0),
    doneAt: r.done_at == null ? null : Number(r.done_at),
    archived: Number(r.archived ?? 0) === 1,
    adminOnly: Number(r.admin_only ?? 0) === 1,
    assignDate: String(r.assign_date ?? ""),
  };
}
