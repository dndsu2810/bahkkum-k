/// <reference types="@cloudflare/workers-types" />
// 교재·비품 주문 관리 — 강사가 신청 → 원장이 구매 → 배송 → 배부(교재)/비치(비품)까지 한 곳에서.
// 신청 → 구매 → 배송 → 배부/비치 흐름. 구매 전 건수는 사이드바 주황 배지로.

import type { Env } from "./index";
import { readSession } from "./auth";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
let oseq = 0;
function newId(): string {
  return `ord_${Date.now().toString(36)}${(oseq++).toString(36)}`;
}

export async function ensureOrderTable(env: Env): Promise<void> {
  try {
    await env.DB
      .prepare(
        "CREATE TABLE IF NOT EXISTS class_order (id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT '교재', name TEXT NOT NULL DEFAULT '', requester TEXT NOT NULL DEFAULT '', requester_sub TEXT NOT NULL DEFAULT '', need_by TEXT NOT NULL DEFAULT '', student_ids TEXT NOT NULL DEFAULT '[]', qty INTEGER NOT NULL DEFAULT 0, link TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', for_class TEXT NOT NULL DEFAULT '', place TEXT NOT NULL DEFAULT '', purchased INTEGER NOT NULL DEFAULT 0, shipped INTEGER NOT NULL DEFAULT 0, distributed_ids TEXT NOT NULL DEFAULT '[]', placed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)"
      )
      .run();
  } catch {
    /* ignore */
  }
}

function arr(v: unknown): string[] {
  try { const a = JSON.parse(String(v ?? "[]")); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

function rowOut(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    kind: String(r.kind ?? "교재"),
    name: String(r.name ?? ""),
    requester: String(r.requester ?? ""),
    requesterSub: String(r.requester_sub ?? ""),
    needBy: String(r.need_by ?? ""),
    studentIds: arr(r.student_ids),
    qty: Number(r.qty ?? 0),
    link: String(r.link ?? ""),
    reason: String(r.reason ?? ""),
    forClass: String(r.for_class ?? ""),
    place: String(r.place ?? ""),
    purchased: Number(r.purchased ?? 0) === 1,
    shipped: Number(r.shipped ?? 0) === 1,
    distributedIds: arr(r.distributed_ids),
    placed: Number(r.placed ?? 0) === 1,
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  };
}

export async function handleOrders(env: Env, request: Request, p: string): Promise<Response | null> {
  const m = request.method;
  await ensureOrderTable(env);
  const me = await readSession(env, request);
  if (!me || me.role === "student") return json({ error: "forbidden" }, 403);

  // 사이드바 배지용 — 구매 전(아직 구매 안 된) 건수.
  if (p === "/api/orders/count" && m === "GET") {
    const r = await env.DB.prepare("SELECT COUNT(*) n FROM class_order WHERE purchased=0").first<{ n: number }>();
    return json({ pending: Number(r?.n) || 0 });
  }

  if (p === "/api/orders" && m === "GET") {
    const r = await env.DB.prepare("SELECT * FROM class_order ORDER BY created_at DESC LIMIT 500").all<Record<string, unknown>>();
    return json({ orders: (r.results || []).map(rowOut) });
  }

  if (p === "/api/orders" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(b.name || "").trim();
    if (!name) return json({ error: "name_required" }, 400);
    const kind = b.kind === "비품" ? "비품" : "교재";
    const id = newId();
    const now = Date.now();
    const studentIds = Array.isArray(b.studentIds) ? (b.studentIds as unknown[]).map(String).slice(0, 200) : [];
    await env.DB
      .prepare(
        "INSERT INTO class_order(id,kind,name,requester,requester_sub,need_by,student_ids,qty,link,reason,for_class,place,purchased,shipped,distributed_ids,placed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,0,'[]',0,?,?)"
      )
      .bind(
        id, kind, name.slice(0, 200), me.name, me.sub,
        String(b.needBy || "").slice(0, 20),
        JSON.stringify(studentIds),
        Math.max(0, Math.round(Number(b.qty) || 0)),
        String(b.link || "").slice(0, 500),
        String(b.reason || "").slice(0, 500),
        String(b.forClass || "").slice(0, 100),
        String(b.place || "").slice(0, 100),
        now, now
      )
      .run();
    return json({ ok: true, id });
  }

  if (p === "/api/orders/update" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(b.id || "");
    if (!id) return json({ error: "id_required" }, 400);
    const cur = await env.DB.prepare("SELECT * FROM class_order WHERE id=?").bind(id).first<Record<string, unknown>>();
    if (!cur) return json({ error: "not_found" }, 404);
    const o = rowOut(cur);
    // 부분 업데이트 — 보낸 필드만 반영.
    const purchased = b.purchased == null ? (o.purchased ? 1 : 0) : (b.purchased ? 1 : 0);
    const shipped = b.shipped == null ? (o.shipped ? 1 : 0) : (b.shipped ? 1 : 0);
    const placed = b.placed == null ? (o.placed ? 1 : 0) : (b.placed ? 1 : 0);
    const place = b.place == null ? o.place : String(b.place).slice(0, 100);
    const distributedIds = Array.isArray(b.distributedIds) ? (b.distributedIds as unknown[]).map(String) : o.distributedIds;
    const studentIds = Array.isArray(b.studentIds) ? (b.studentIds as unknown[]).map(String).slice(0, 200) : o.studentIds;
    const name = b.name == null ? o.name : String(b.name).slice(0, 200);
    const needBy = b.needBy == null ? o.needBy : String(b.needBy).slice(0, 20);
    const qty = b.qty == null ? o.qty : Math.max(0, Math.round(Number(b.qty) || 0));
    const link = b.link == null ? o.link : String(b.link).slice(0, 500);
    const reason = b.reason == null ? o.reason : String(b.reason).slice(0, 500);
    const forClass = b.forClass == null ? o.forClass : String(b.forClass).slice(0, 100);
    await env.DB
      .prepare(
        "UPDATE class_order SET name=?,need_by=?,qty=?,link=?,reason=?,for_class=?,place=?,purchased=?,shipped=?,distributed_ids=?,student_ids=?,placed=?,updated_at=? WHERE id=?"
      )
      .bind(name, needBy, qty, link, reason, forClass, place, purchased, shipped, JSON.stringify(distributedIds), JSON.stringify(studentIds), placed, Date.now(), id)
      .run();
    return json({ ok: true });
  }

  if (p === "/api/orders/delete" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    // 신청자 본인 또는 원장만 삭제.
    const row = await env.DB.prepare("SELECT requester_sub FROM class_order WHERE id=?").bind(b.id).first<{ requester_sub: string }>();
    if (!row) return json({ ok: true });
    if (me.role !== "admin" && String(row.requester_sub) !== me.sub) return json({ error: "forbidden" }, 403);
    await env.DB.prepare("DELETE FROM class_order WHERE id=?").bind(b.id).run();
    return json({ ok: true });
  }

  return null;
}
