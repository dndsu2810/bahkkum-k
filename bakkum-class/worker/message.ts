/// <reference types="@cloudflare/workers-types" />
// 학생 메시지(알림) — 선생님(원장·수학) → 학생 단방향. 학생은 메시지당 답장 1회.
// 노션 미사용. 앱 저장소(D1) class_message 에만 쌓인다.

import type { Env } from "./index";
import type { SessionUser } from "./auth";
import { kstToday } from "./briefing";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
let seq = 0;
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`;
}

/** 발송 가능 역할 — 원장(개발자 포함, 실효 admin) + 수학 강사. */
function canSend(me: SessionUser): boolean {
  return me.role === "admin" || me.role === "math";
}

export async function ensureMessageTables(env: Env): Promise<void> {
  const stmts = [
    "CREATE TABLE IF NOT EXISTS class_message (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL DEFAULT '', sender_sub TEXT NOT NULL DEFAULT '', sender_name TEXT NOT NULL DEFAULT '', sender_role TEXT NOT NULL DEFAULT '', recipient_id TEXT NOT NULL DEFAULT '', recipient_name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0, read_at INTEGER NOT NULL DEFAULT 0, reply_body TEXT NOT NULL DEFAULT '', reply_at INTEGER NOT NULL DEFAULT 0, reply_seen INTEGER NOT NULL DEFAULT 0)",
    // 기존 테이블에 reply_seen 추가(이미 있으면 무시) — 강사가 답장을 확인했는지 추적.
    "ALTER TABLE class_message ADD COLUMN reply_seen INTEGER NOT NULL DEFAULT 0",
    // 메시지 종류 — 'msg'(일반) | 'checkout'(하원 알림: 메시지함 대신 상단 배너로만, 다음날 사라짐).
    "ALTER TABLE class_message ADD COLUMN kind TEXT NOT NULL DEFAULT 'msg'",
    "CREATE INDEX IF NOT EXISTS idx_message_recipient ON class_message(recipient_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_message_sender ON class_message(sender_sub, created_at)",
  ];
  for (const s of stmts) {
    try {
      await env.DB.prepare(s).run();
    } catch {
      /* ignore */
    }
  }
}

function msgRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    batchId: String(r.batch_id ?? ""),
    senderSub: String(r.sender_sub ?? ""),
    senderName: String(r.sender_name ?? ""),
    senderRole: String(r.sender_role ?? ""),
    recipientId: String(r.recipient_id ?? ""),
    recipientName: String(r.recipient_name ?? ""),
    body: String(r.body ?? ""),
    createdAt: Number(r.created_at ?? 0),
    readAt: Number(r.read_at ?? 0),
    replyBody: String(r.reply_body ?? ""),
    replyAt: Number(r.reply_at ?? 0),
  };
}

export async function handleMessages(env: Env, request: Request, p: string, me: SessionUser): Promise<Response | null> {
  const m = request.method;
  await ensureMessageTables(env);

  /* ============ 보내는 쪽(원장·수학) ============ */
  if (p === "/api/messages/send" && m === "POST") {
    if (!canSend(me)) return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as { recipients?: { id?: string; name?: string }[]; body?: string };
    const body = String(b.body || "").trim().slice(0, 2000);
    const recipients = (b.recipients || []).filter((r) => r && String(r.id || "").trim());
    if (!body) return json({ error: "body_required" }, 400);
    if (!recipients.length) return json({ error: "recipients_required" }, 400);
    const batchId = newId("bat");
    const now = Date.now();
    // 학생 1명당 1행 개별 생성(같은 batch_id) — 학생별 읽음·답장 추적.
    for (const r of recipients) {
      await env.DB.prepare(
        "INSERT INTO class_message(id,batch_id,sender_sub,sender_name,sender_role,recipient_id,recipient_name,body,created_at,read_at,reply_body,reply_at) VALUES(?,?,?,?,?,?,?,?,?,0,'',0)"
      ).bind(newId("msg"), batchId, me.sub, me.name, me.role, String(r.id), String(r.name || ""), body, now).run();
    }
    return json({ ok: true, count: recipients.length });
  }

  // 하원 알림 — 강사(누구나, 학생 제외)가 대시보드에서 하원 누르면 그 학생 상단 배너에 표시(다음날 사라짐).
  if (p === "/api/messages/checkout-notify" && m === "POST") {
    if (me.role === "student") return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as { studentId?: string; studentName?: string };
    const sid = String(b.studentId || "").trim();
    if (!sid) return json({ error: "student_required" }, 400);
    // 문구는 원장 설정(class_config.checkout_notice)에서 가져오고, 없으면 기본값.
    let text = "하원하세요! Good Bye!";
    try {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS class_config (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')").run();
      const c = await env.DB.prepare("SELECT v FROM class_config WHERE k='checkout_notice'").first<{ v: string }>();
      if (c?.v && c.v.trim()) text = c.v.trim();
    } catch { /* 기본값 사용 */ }
    await env.DB.prepare(
      "INSERT INTO class_message(id,batch_id,sender_sub,sender_name,sender_role,recipient_id,recipient_name,body,created_at,read_at,reply_body,reply_at,kind) VALUES(?,?,?,?,?,?,?,?,?,0,'',0,'checkout')"
    ).bind(newId("msg"), newId("bat"), me.sub, me.name, me.role, sid, String(b.studentName || ""), text, Date.now()).run();
    return json({ ok: true });
  }

  // 하원 배너(학생) — 오늘 받은 하원 알림이 있으면 그 문구를, 없으면 null. 다음날이면 자동으로 안 뜸.
  if (p === "/api/messages/checkout-today" && m === "GET") {
    if (me.role !== "student") return json({ notice: null });
    const startToday = Date.parse(kstToday().date + "T00:00:00+09:00");
    const row = await env.DB.prepare("SELECT body FROM class_message WHERE recipient_id=? AND kind='checkout' AND created_at>=? ORDER BY created_at DESC LIMIT 1").bind(me.sub, startToday).first<{ body: string }>();
    return json({ notice: row?.body ?? null });
  }

  if (p === "/api/messages/sent" && m === "GET") {
    if (!canSend(me)) return json({ error: "forbidden" }, 403);
    const r = await env.DB.prepare("SELECT * FROM class_message WHERE sender_sub=? ORDER BY created_at DESC LIMIT 500").bind(me.sub).all<Record<string, unknown>>();
    return json({ messages: (r.results || []).map(msgRow) });
  }

  // 내가 보낸 메시지 중, 아직 확인 안 한 학생 답장 수(사이드바 빨간 배지).
  if (p === "/api/messages/replies/count" && m === "GET") {
    if (!canSend(me)) return json({ count: 0 });
    const r = await env.DB.prepare("SELECT COUNT(*) n FROM class_message WHERE sender_sub=? AND reply_at>0 AND reply_seen=0").bind(me.sub).first<{ n: number }>();
    return json({ count: Number(r?.n ?? 0) });
  }
  // 답장 확인 처리 — 발송 화면을 열면 내 답장들을 '확인함'으로.
  if (p === "/api/messages/replies/seen" && m === "POST") {
    if (!canSend(me)) return json({ error: "forbidden" }, 403);
    await env.DB.prepare("UPDATE class_message SET reply_seen=1 WHERE sender_sub=? AND reply_at>0 AND reply_seen=0").bind(me.sub).run();
    return json({ ok: true });
  }

  // 발송 대상 후보 — 개별 로그인 가능한 학생 전체(과목 무관). 로그인=이름+생일이라 생일 등록된 학생만.
  if (p === "/api/messages/students" && m === "GET") {
    if (!canSend(me)) return json({ error: "forbidden" }, 403);
    const r = await env.DB.prepare(
      "SELECT id, name, grade FROM students WHERE (hidden IS NULL OR hidden=0) AND birth_date IS NOT NULL AND TRIM(birth_date) <> '' AND (status='재원' OR status IS NULL OR status='') ORDER BY name"
    ).all<{ id: number; name: string; grade: string | null }>();
    return json({ students: (r.results || []).map((x) => ({ id: String(x.id), name: String(x.name ?? ""), grade: String(x.grade ?? "") })) });
  }

  /* ============ 받는 쪽(학생 본인) ============ */
  if (p === "/api/messages/inbox" && m === "GET") {
    if (me.role !== "student") return json({ error: "forbidden" }, 403);
    const r = await env.DB.prepare("SELECT * FROM class_message WHERE recipient_id=? AND kind!='checkout' ORDER BY created_at DESC LIMIT 200").bind(me.sub).all<Record<string, unknown>>();
    return json({ messages: (r.results || []).map(msgRow) });
  }

  if (p === "/api/messages/unread" && m === "GET") {
    if (me.role !== "student") return json({ count: 0 });
    const r = await env.DB.prepare("SELECT COUNT(*) n FROM class_message WHERE recipient_id=? AND read_at=0 AND kind!='checkout'").bind(me.sub).first<{ n: number }>();
    return json({ count: Number(r?.n ?? 0) });
  }

  if (p === "/api/messages/read" && m === "POST") {
    if (me.role !== "student") return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB.prepare("UPDATE class_message SET read_at=? WHERE id=? AND recipient_id=? AND read_at=0").bind(Date.now(), b.id, me.sub).run();
    return json({ ok: true });
  }

  if (p === "/api/messages/reply" && m === "POST") {
    if (me.role !== "student") return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as { id?: string; body?: string };
    const body = String(b.body || "").trim().slice(0, 1000);
    if (!b.id) return json({ error: "id_required" }, 400);
    if (!body) return json({ error: "body_required" }, 400);
    // 답장은 딱 1회 — reply_at=0(아직 답장 없음)일 때만. 읽음 처리도 함께.
    const now = Date.now();
    const res = await env.DB.prepare(
      "UPDATE class_message SET reply_body=?, reply_at=?, read_at=CASE WHEN read_at=0 THEN ? ELSE read_at END WHERE id=? AND recipient_id=? AND reply_at=0"
    ).bind(body, now, now, b.id, me.sub).run();
    if (!res.meta.changes) return json({ error: "already_replied" }, 409);
    return json({ ok: true });
  }

  return null;
}
