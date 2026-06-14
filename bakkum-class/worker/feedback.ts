/// <reference types="@cloudflare/workers-types" />
// 공지 배너(원장→강사) + 오류·개선 요청 창구(누구나·학생 포함).
// 오류 요청 등록 시 원장 카카오워크로 알림(웹훅).

import type { Env } from "./index";
import type { SessionUser } from "./auth";
import { sendKakao } from "./kakao";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
let seq = 0;
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`;
}

const ISSUE_STATUS = ["접수", "해결중", "완료"];

export async function ensureFeedbackTables(env: Env): Promise<void> {
  const stmts = [
    // 공지 배너 — 원장이 올리는 상단 띠. 활성·기간으로 노출 제어.
    "CREATE TABLE IF NOT EXISTS class_notice (id TEXT PRIMARY KEY, text TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT 'info', active INTEGER NOT NULL DEFAULT 1, start_date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT '')",
    // 오류·개선 요청 — 누구나 작성, 원장이 상태 변경.
    "CREATE TABLE IF NOT EXISTS class_issue (id TEXT PRIMARY KEY, page TEXT NOT NULL DEFAULT '', author_sub TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '', author_role TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', shot TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '접수', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)",
  ];
  for (const s of stmts) {
    try {
      await env.DB.prepare(s).run();
    } catch {
      /* ignore */
    }
  }
}

async function cfg(env: Env, k: string): Promise<string> {
  try {
    const r = await env.DB.prepare("SELECT v FROM class_config WHERE k=?").bind(k).first<{ v: string }>();
    return String(r?.v ?? "");
  } catch {
    return "";
  }
}

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

export async function handleFeedback(env: Env, request: Request, p: string, me: SessionUser): Promise<Response | null> {
  const m = request.method;
  await ensureFeedbackTables(env);
  const isAdmin = me.role === "admin";

  /* ============ 공지 배너 ============ */
  if (p === "/api/notice" && m === "GET") {
    // 활성 + 오늘이 기간 안인 공지(최신순). 모든 로그인 사용자.
    const today = todayStr();
    const r = await env.DB.prepare("SELECT * FROM class_notice WHERE active=1 ORDER BY created_at DESC").all<Record<string, unknown>>();
    const list = (r.results || [])
      .map(noticeRow)
      .filter((n) => (!n.startDate || n.startDate <= today) && (!n.endDate || n.endDate >= today));
    return json({ notices: list });
  }
  if (p === "/api/notice/all" && m === "GET") {
    if (!isAdmin) return json({ error: "forbidden" }, 403);
    const r = await env.DB.prepare("SELECT * FROM class_notice ORDER BY created_at DESC").all<Record<string, unknown>>();
    return json({ notices: (r.results || []).map(noticeRow) });
  }
  if (p === "/api/notice" && m === "POST") {
    if (!isAdmin) return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(b.id || "") || newId("ntc");
    const level = ["info", "warn"].includes(String(b.level)) ? String(b.level) : "info";
    const active = b.active ? 1 : 0;
    const exists = await env.DB.prepare("SELECT id FROM class_notice WHERE id=?").bind(id).first();
    if (exists) {
      await env.DB.prepare("UPDATE class_notice SET text=?, level=?, active=?, start_date=?, end_date=? WHERE id=?")
        .bind(String(b.text || ""), level, active, String(b.startDate || ""), String(b.endDate || ""), id)
        .run();
    } else {
      await env.DB.prepare("INSERT INTO class_notice(id,text,level,active,start_date,end_date,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)")
        .bind(id, String(b.text || ""), level, active, String(b.startDate || ""), String(b.endDate || ""), Date.now(), me.name)
        .run();
    }
    return json({ ok: true, id });
  }
  if (p === "/api/notice/delete" && m === "POST") {
    if (!isAdmin) return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    await env.DB.prepare("DELETE FROM class_notice WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }

  /* ============ 오류·개선 요청 ============ */
  if (p === "/api/issue" && m === "GET") {
    // 원장은 전체, 그 외는 본인 글만.
    const q = isAdmin
      ? env.DB.prepare("SELECT * FROM class_issue ORDER BY created_at DESC LIMIT 500")
      : env.DB.prepare("SELECT * FROM class_issue WHERE author_sub=? ORDER BY created_at DESC LIMIT 200").bind(me.sub);
    const r = await q.all<Record<string, unknown>>();
    return json({ issues: (r.results || []).map(issueRow), isAdmin });
  }
  if (p === "/api/issue" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const body = String(b.body || "").trim();
    if (!body) return json({ error: "body_required" }, 400);
    const id = newId("iss");
    const page = String(b.page || "").slice(0, 60);
    const shot = String(b.shot || "");
    const now = Date.now();
    await env.DB.prepare("INSERT INTO class_issue(id,page,author_sub,author_name,author_role,body,shot,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(id, page, me.sub, me.name, me.role, body.slice(0, 2000), shot, "접수", now, now)
      .run();
    // 원장 카카오워크 알림(웹훅 설정 시). 실패해도 등록은 성공.
    try {
      const webhook = (await cfg(env, "secret_kakao_webhook")) || env.KAKAO_WEBHOOK_URL || "";
      if (webhook) {
        const when = new Date(now).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
        const text = `🐞 오류·개선 요청\n작성자: ${me.name} (${roleLabel(me.role)})\n화면: ${page || "미지정"}\n내용: ${body}\n시간: ${when}`;
        await sendKakao({ KAKAO_WEBHOOK_URL: webhook }, text);
      }
    } catch {
      /* 알림 실패는 무시 */
    }
    return json({ ok: true, id });
  }
  if (p === "/api/issue/status" && m === "POST") {
    if (!isAdmin) return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as { id?: string; status?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    const status = ISSUE_STATUS.includes(String(b.status)) ? String(b.status) : "접수";
    await env.DB.prepare("UPDATE class_issue SET status=?, updated_at=? WHERE id=?").bind(status, Date.now(), b.id).run();
    return json({ ok: true });
  }
  if (p === "/api/issue/delete" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    // 원장이거나 본인 글만 삭제.
    const row = await env.DB.prepare("SELECT author_sub FROM class_issue WHERE id=?").bind(b.id).first<{ author_sub: string }>();
    if (!row) return json({ ok: true });
    if (!isAdmin && String(row.author_sub) !== me.sub) return json({ error: "forbidden" }, 403);
    await env.DB.prepare("DELETE FROM class_issue WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }

  return null;
}

function roleLabel(role: string): string {
  const m: Record<string, string> = { admin: "원장", math: "수학", english_mid: "영어(중고등)", english_elem: "영어(초등)", desk: "데스크", student: "학생" };
  return m[role] || role;
}

function noticeRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    text: String(r.text ?? ""),
    level: String(r.level ?? "info"),
    active: Number(r.active) === 1,
    startDate: String(r.start_date ?? ""),
    endDate: String(r.end_date ?? ""),
    createdAt: Number(r.created_at ?? 0),
    createdBy: String(r.created_by ?? ""),
  };
}
function issueRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    page: String(r.page ?? ""),
    authorSub: String(r.author_sub ?? ""),
    authorName: String(r.author_name ?? ""),
    authorRole: String(r.author_role ?? ""),
    body: String(r.body ?? ""),
    shot: String(r.shot ?? ""),
    status: String(r.status ?? "접수"),
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  };
}
