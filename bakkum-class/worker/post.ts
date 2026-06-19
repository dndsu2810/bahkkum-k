/// <reference types="@cloudflare/workers-types" />
// 공지사항 게시판 — 기능 업데이트·강사 할 일·자료 공유. 리치 텍스트 + 파일 첨부.
//  · 권한(audience): staff(강사만) | all(학생 포함 전체)
//  · 배너: banner=1이면 상단 공지 배너(class_notice)에 동기화(체크 해제 시 내림)
//  · 읽음: class_post_read로 개인별 읽음 처리 → 'new N' 배지
// 작성/수정/삭제는 스태프, 조회는 로그인 누구나(audience로 학생 노출 제어).

import type { Env } from "./index";
import type { SessionUser } from "./auth";
import { ensureFeedbackTables } from "./feedback";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
let seq = 0;
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`;
}

let postReady = false;
async function ensurePostTables(env: Env): Promise<void> {
  if (postReady) return;
  for (const s of [
    "CREATE TABLE IF NOT EXISTS class_post (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', files TEXT NOT NULL DEFAULT '[]', audience TEXT NOT NULL DEFAULT 'staff', banner INTEGER NOT NULL DEFAULT 0, author_sub TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '', editor_name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS class_post_read (post_id TEXT NOT NULL, user_sub TEXT NOT NULL, read_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(post_id, user_sub))",
  ]) {
    try { await env.DB.prepare(s).run(); } catch { /* ignore */ }
  }
  postReady = true;
}

interface FileRef { name: string; url: string; size: number }
function parseFiles(s: unknown): FileRef[] {
  try {
    const a = JSON.parse(String(s ?? "[]"));
    return Array.isArray(a) ? a.map((f) => ({ name: String(f?.name ?? ""), url: String(f?.url ?? ""), size: Number(f?.size ?? 0) })).filter((f) => f.url) : [];
  } catch { return []; }
}

function listRow(r: Record<string, unknown>, read: boolean) {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    audience: String(r.audience ?? "staff"),
    banner: Number(r.banner) === 1,
    authorName: String(r.author_name ?? ""),
    editorName: String(r.editor_name ?? ""),
    fileCount: parseFiles(r.files).length,
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
    read,
  };
}

/** 배너 동기화 — banner=1이면 class_notice에 post_<id>로 띄우고, 0이면 내린다. */
async function syncBanner(env: Env, id: string, on: boolean, title: string, audience: string, author: string): Promise<void> {
  await ensureFeedbackTables(env);
  const nid = "post_" + id;
  if (on) {
    const exists = await env.DB.prepare("SELECT id FROM class_notice WHERE id=?").bind(nid).first();
    if (exists) {
      await env.DB.prepare("UPDATE class_notice SET text=?, active=1, audience=? WHERE id=?").bind(title, audience === "all" ? "all" : "staff", nid).run();
    } else {
      await env.DB.prepare("INSERT INTO class_notice(id,text,level,active,start_date,end_date,created_at,created_by,audience) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(nid, title, "info", 1, "", "", Date.now(), author, audience === "all" ? "all" : "staff").run();
    }
  } else {
    await env.DB.prepare("DELETE FROM class_notice WHERE id=?").bind(nid).run();
  }
}

export async function handlePost(env: Env, request: Request, p: string, me: SessionUser): Promise<Response | null> {
  const m = request.method;
  await ensurePostTables(env);
  const isStaff = me.role !== "student";

  // 목록 — 학생은 audience='all'만. 읽음 여부 포함.
  if (p === "/api/posts" && m === "GET") {
    const q = isStaff
      ? env.DB.prepare("SELECT id,title,audience,banner,author_name,editor_name,files,created_at,updated_at FROM class_post ORDER BY created_at DESC LIMIT 300")
      : env.DB.prepare("SELECT id,title,audience,banner,author_name,editor_name,files,created_at,updated_at FROM class_post WHERE audience='all' ORDER BY created_at DESC LIMIT 300");
    const r = await q.all<Record<string, unknown>>();
    const rows = r.results || [];
    const readSet = new Set<string>();
    try {
      const rr = await env.DB.prepare("SELECT post_id FROM class_post_read WHERE user_sub=?").bind(me.sub).all<{ post_id: string }>();
      for (const x of rr.results || []) readSet.add(String(x.post_id));
    } catch { /* ignore */ }
    return json({ posts: rows.map((row) => listRow(row, readSet.has(String(row.id)))) });
  }

  // 미열람 개수(배지) — 학생은 전체공개분만.
  if (p === "/api/posts/unseen" && m === "GET") {
    const q = isStaff
      ? env.DB.prepare("SELECT COUNT(*) n FROM class_post WHERE id NOT IN (SELECT post_id FROM class_post_read WHERE user_sub=?)").bind(me.sub)
      : env.DB.prepare("SELECT COUNT(*) n FROM class_post WHERE audience='all' AND id NOT IN (SELECT post_id FROM class_post_read WHERE user_sub=?)").bind(me.sub);
    const r = await q.first<{ n: number }>();
    return json({ count: Number(r?.n) || 0 });
  }

  // 상세 — 읽음 처리.
  if (/^\/api\/posts\/[A-Za-z0-9_]+$/.test(p) && m === "GET") {
    const id = p.split("/").pop()!;
    const row = await env.DB.prepare("SELECT * FROM class_post WHERE id=?").bind(id).first<Record<string, unknown>>();
    if (!row) return json({ error: "not_found" }, 404);
    if (!isStaff && String(row.audience) !== "all") return json({ error: "forbidden" }, 403);
    try { await env.DB.prepare("INSERT OR IGNORE INTO class_post_read(post_id,user_sub,read_at) VALUES(?,?,?)").bind(id, me.sub, Date.now()).run(); } catch { /* ignore */ }
    return json({ post: {
      ...listRow(row, true),
      body: String(row.body ?? ""),
      files: parseFiles(row.files),
      authorSub: String(row.author_sub ?? ""),
    } });
  }

  // 작성/수정 — 스태프만.
  if (p === "/api/posts" && m === "POST") {
    if (!isStaff) return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const title = String(b.title || "").trim().slice(0, 200);
    if (!title) return json({ error: "title_required" }, 400);
    const body = String(b.body || "").slice(0, 200000);
    const audience = String(b.audience) === "all" ? "all" : "staff";
    const banner = b.banner ? 1 : 0;
    const files = JSON.stringify(parseFiles(b.files).slice(0, 30));
    const now = Date.now();
    const id = String(b.id || "");
    if (id) {
      const cur = await env.DB.prepare("SELECT author_sub FROM class_post WHERE id=?").bind(id).first<{ author_sub: string }>();
      if (!cur) return json({ error: "not_found" }, 404);
      // 다른 사람이 수정하면 editor_name 기록(작성자 본인이 고치면 비움).
      const editor = String(cur.author_sub) === me.sub ? "" : me.name;
      await env.DB.prepare("UPDATE class_post SET title=?, body=?, files=?, audience=?, banner=?, editor_name=?, updated_at=? WHERE id=?")
        .bind(title, body, files, audience, banner, editor, now, id).run();
      // 내용이 바뀌었으니 다시 'new'로(작성자 제외 모두 미열람) — 본인은 읽음 유지.
      try { await env.DB.prepare("DELETE FROM class_post_read WHERE post_id=? AND user_sub<>?").bind(id, me.sub).run(); } catch { /* ignore */ }
      await syncBanner(env, id, banner === 1, title, audience, me.name);
      return json({ ok: true, id });
    }
    const newPostId = newId("post");
    await env.DB.prepare("INSERT INTO class_post(id,title,body,files,audience,banner,author_sub,author_name,editor_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind(newPostId, title, body, files, audience, banner, me.sub, me.name, "", now, now).run();
    // 작성자는 자기 글을 읽은 것으로.
    try { await env.DB.prepare("INSERT OR IGNORE INTO class_post_read(post_id,user_sub,read_at) VALUES(?,?,?)").bind(newPostId, me.sub, now).run(); } catch { /* ignore */ }
    await syncBanner(env, newPostId, banner === 1, title, audience, me.name);
    return json({ ok: true, id: newPostId });
  }

  // 삭제 — 작성자 또는 원장.
  if (p === "/api/posts/delete" && m === "POST") {
    if (!isStaff) return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    const id = String(b.id || "");
    if (!id) return json({ error: "id_required" }, 400);
    const cur = await env.DB.prepare("SELECT author_sub FROM class_post WHERE id=?").bind(id).first<{ author_sub: string }>();
    if (!cur) return json({ ok: true });
    if (me.role !== "admin" && String(cur.author_sub) !== me.sub) return json({ error: "forbidden" }, 403);
    await env.DB.prepare("DELETE FROM class_post WHERE id=?").bind(id).run();
    try { await env.DB.prepare("DELETE FROM class_post_read WHERE post_id=?").bind(id).run(); } catch { /* ignore */ }
    await syncBanner(env, id, false, "", "staff", me.name);
    return json({ ok: true });
  }

  return null;
}
