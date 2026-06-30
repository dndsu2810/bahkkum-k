/// <reference types="@cloudflare/workers-types" />
// 대시보드 '하원' 공유 상태 — 강사가 카드에서 하원 누르면 모든 강사 기기/대시보드가 같은 상태를 본다.
// scope로 과목/화면을 구분(예: "math", "eng-mid", "eng-elem") → 과목 간은 서로 연동되지 않는다.
// date 스코프(그날 하루). item은 대시보드 카드 키(영어=학생id, 수학=복합 key) — 임의 문자열로 저장.

import type { Env } from "./index";
import type { SessionUser } from "./auth";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

let ready = false;
async function ensure(env: Env): Promise<void> {
  if (ready) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS class_checkout (scope TEXT NOT NULL, date TEXT NOT NULL, item TEXT NOT NULL, at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(scope, date, item))"
  ).run();
  ready = true;
}

/** 대시보드 하원 공유 상태. 강사(비학생)만. */
export async function handleCheckout(env: Env, request: Request, p: string, me: SessionUser | null): Promise<Response | null> {
  if (!p.startsWith("/api/checkout")) return null;
  if (!me || me.role === "student") return json({ error: "forbidden" }, 403);
  await ensure(env);
  const url = new URL(request.url);
  const m = request.method;

  // 목록 — ?scope=&date= → 하원 처리된 item 키 배열.
  if (p === "/api/checkout" && m === "GET") {
    const scope = String(url.searchParams.get("scope") || "").trim();
    const date = String(url.searchParams.get("date") || "").trim();
    if (!scope || !date) return json({ items: [] });
    const r = await env.DB.prepare("SELECT item FROM class_checkout WHERE scope=? AND date=?").bind(scope, date).all<{ item: string }>();
    return json({ items: (r.results || []).map((x) => String(x.item)) });
  }

  // 저장 — { scope, date, items:[...] } 전체 교체(권장) 또는 { scope, date, item, out } 단건(구버전 호환).
  if (p === "/api/checkout" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const scope = String(b.scope || "").trim();
    const date = String(b.date || "").trim();
    if (!scope || !date) return json({ error: "bad_input" }, 400);
    // 전체 교체 — 보낸 목록이 그 scope/date의 하원 전부가 된다(현재 화면 = 서버).
    if (Array.isArray(b.items)) {
      const items = (b.items as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 500);
      const stmts = [env.DB.prepare("DELETE FROM class_checkout WHERE scope=? AND date=?").bind(scope, date)];
      for (const it of items) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO class_checkout(scope,date,item,at) VALUES(?,?,?,?)").bind(scope, date, it, Date.now()));
      await env.DB.batch(stmts);
      return json({ ok: true });
    }
    // 단건 토글(구버전 클라이언트 호환).
    const item = String(b.item || "").trim();
    if (!item) return json({ error: "bad_input" }, 400);
    if (b.out) await env.DB.prepare("INSERT OR IGNORE INTO class_checkout(scope,date,item,at) VALUES(?,?,?,?)").bind(scope, date, item, Date.now()).run();
    else await env.DB.prepare("DELETE FROM class_checkout WHERE scope=? AND date=? AND item=?").bind(scope, date, item).run();
    return json({ ok: true });
  }

  return null;
}
