/// <reference types="@cloudflare/workers-types" />
// 회의록 — 회의안(노션식 리치 텍스트) 미리 작성 + 음성/텍스트 → AI 요약 → 저장.
//  · 음성: OpenAI Whisper로 텍스트 변환
//  · 요약: Claude(메시지 API) — 회의안(안건)이 있으면 함께 반영
//  · 종류(category)로 구분, 참석자(강사)·작성자 기준 본인 회의만 열람(원장은 전체)
// API 키는 Worker Secret(OPENAI_API_KEY·ANTHROPIC_API_KEY) 우선,
// 없으면 class_config의 secret_openai_key·secret_anthropic_key로 폴백.

import type { Env } from "./index";
import type { SessionUser } from "./auth";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

// 기본 회의 종류 — 원장이 나중에 직접 추가 가능(class_config.meeting_categories).
const DEFAULT_CATEGORIES = ["전체 회의", "학부모 상담", "초등영어", "초등수학", "중고등수학", "학생 상담", "강사 상담", "기타"];

let meetingReady = false;
async function ensureMeetingTable(env: Env): Promise<void> {
  if (meetingReady) return; // isolate당 1회
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS meeting_records (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
        "title TEXT NOT NULL DEFAULT '', " +
        "meeting_date TEXT NOT NULL DEFAULT '', " +
        "attendees TEXT NOT NULL DEFAULT '', " +
        "raw_text TEXT NOT NULL DEFAULT '', " +
        "summary TEXT NOT NULL DEFAULT '', " +
        "created_by TEXT NOT NULL DEFAULT '', " +
        "created_at INTEGER NOT NULL DEFAULT 0)"
    ).run();
  } catch {
    /* ignore */
  }
  // 추가 컬럼(이미 있으면 무시) — 종류·회의안·상태·작성자ID·참석자ID.
  for (const col of [
    "ALTER TABLE meeting_records ADD COLUMN category TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE meeting_records ADD COLUMN agenda TEXT NOT NULL DEFAULT ''", // 회의안(리치 HTML)
    "ALTER TABLE meeting_records ADD COLUMN status TEXT NOT NULL DEFAULT '완료'", // 예정 | 완료
    "ALTER TABLE meeting_records ADD COLUMN created_sub TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE meeting_records ADD COLUMN attendee_subs TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE meeting_records ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
  ]) {
    try { await env.DB.prepare(col).run(); } catch { /* 이미 있으면 무시 */ }
  }
  meetingReady = true;
}

/** API 키 — Worker Secret 우선, 없으면 class_config의 secret_* 폴백. */
async function apiKey(env: Env, kind: "openai" | "anthropic"): Promise<string> {
  const fromEnv = kind === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY;
  if (fromEnv) return fromEnv;
  try {
    const k = kind === "openai" ? "secret_openai_key" : "secret_anthropic_key";
    const r = await env.DB.prepare("SELECT v FROM class_config WHERE k=?").bind(k).first<{ v: string }>();
    return String(r?.v ?? "");
  } catch {
    return "";
  }
}

async function getCategories(env: Env): Promise<string[]> {
  let extra: string[] = [];
  try {
    const r = await env.DB.prepare("SELECT v FROM class_config WHERE k='meeting_categories'").first<{ v: string }>();
    const a = JSON.parse(String(r?.v ?? "[]"));
    if (Array.isArray(a)) extra = a.map(String);
  } catch { /* ignore */ }
  // 기본 + 커스텀(중복 제거, '기타'는 항상 맨 끝).
  const set: string[] = [];
  for (const c of [...DEFAULT_CATEGORIES.filter((x) => x !== "기타"), ...extra]) {
    const v = c.trim();
    if (v && v !== "기타" && !set.includes(v)) set.push(v);
  }
  set.push("기타");
  return set;
}

function parseSubs(s: unknown): string[] {
  try { const a = JSON.parse(String(s ?? "[]")); return Array.isArray(a) ? a.map(String) : []; }
  catch { return []; }
}

function listRow(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    title: String(r.title ?? ""),
    category: String(r.category ?? ""),
    meetingDate: String(r.meeting_date ?? ""),
    attendees: String(r.attendees ?? ""),
    status: String(r.status ?? "완료"),
    createdBy: String(r.created_by ?? ""),
    createdAt: Number(r.created_at ?? 0),
    hasSummary: !!String(r.summary ?? ""),
  };
}
function detailRow(r: Record<string, unknown>) {
  return {
    ...listRow(r),
    agenda: String(r.agenda ?? ""),
    rawText: String(r.raw_text ?? ""),
    summary: String(r.summary ?? ""),
    attendeeSubs: parseSubs(r.attendee_subs),
    createdSub: String(r.created_sub ?? ""),
  };
}

/** 이 사용자가 이 회의를 볼 수 있나 — 원장 전체, 그 외 작성자·참석자 본인만. */
function canView(me: SessionUser, createdSub: string, attendeeSubs: string[]): boolean {
  if (me.role === "admin") return true;
  if (createdSub && createdSub === me.sub) return true;
  return attendeeSubs.includes(me.sub);
}

// Whisper가 무음/저음질에서 지어내는 유튜브식 환각 문구들. 이 문구가 든 구간/문장은 버린다.
const HALLUCINATIONS = [
  /유료\s*광고/, /구독.*좋아요/, /좋아요.*구독/, /구독.*눌러/, /채널.*구독/,
  /시청.*감사/, /시청해\s*주셔서/, /다음\s*(영상|시간)에\s*(만나|뵈)/, /본\s*영상/,
  /자막\s*(제공|by)/, /한글\s*자막/, /엔딩/, /(MBC|SBS|KBS|JTBC)\s*뉴스/,
  /좋아요와\s*구독/, /알림\s*설정/, /이\s*영상은/,
];
function isHallu(t: string): boolean {
  return HALLUCINATIONS.some((re) => re.test(t));
}
/** Whisper 결과 정리 — 무음 구간(no_speech) 제거 + 환각 문구 제거 + 반복 중복 제거. */
function cleanTranscript(w: { text?: string; segments?: { text?: string; no_speech_prob?: number; avg_logprob?: number }[] }): string {
  let parts: string[];
  if (Array.isArray(w.segments) && w.segments.length) {
    parts = w.segments
      .filter((s) => !(Number(s.no_speech_prob) > 0.6 && Number(s.avg_logprob) < -0.4)) // 무음에 가까운 구간 버림
      .map((s) => String(s.text || ""));
  } else {
    parts = [String(w.text || "")];
  }
  // 문장 단위로 쪼개 환각 문구 제거.
  const sentences = parts.join(" ").split(/(?<=[.!?。\n])\s*/);
  const kept: string[] = [];
  let prev = "";
  for (const raw of sentences) {
    const t = raw.trim();
    if (!t || isHallu(t)) continue;
    if (t === prev) continue; // 같은 문장 반복(루프) 제거
    prev = t;
    kept.push(t);
  }
  return kept.join(" ").replace(/\s{2,}/g, " ").trim();
}

function buildSummaryPrompt(agendaText: string, rawText: string): string {
  const head = agendaText
    ? `회의 전에 작성한 회의안(안건)입니다.\n\n${agendaText}\n\n위 안건이 실제 회의에서 어떻게 논의·결정됐는지도 함께 반영해, 아래 형식으로 정확하게 요약해주세요.`
    : `다음은 학원 회의 내용입니다. 아래 형식으로 정확하게 요약해주세요.`;
  return `${head}
각 항목은 반드시 "- " 불릿으로 작성하고, 내용이 없으면 "- 해당 없음"이라고 써주세요.

## 핵심 내용
(회의에서 논의된 주요 내용 3~5가지)

## 결정사항
(회의에서 확정된 사항들)

## 할일 목록
(담당자 포함, 예: - [지현] 교재 주문 확인)

---
회의 내용:
${rawText}`;
}

export async function handleMeeting(env: Env, request: Request, p: string, me: SessionUser): Promise<Response | null> {
  const m = request.method;
  await ensureMeetingTable(env);

  // 회의 종류 목록 — 조회(스태프) / 추가(스태프).
  if (p === "/api/meetings/categories" && m === "GET") {
    return json({ categories: await getCategories(env) });
  }
  if (p === "/api/meetings/categories" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { name?: string };
    const name = String(b.name || "").trim().slice(0, 40);
    if (!name) return json({ error: "name_required" }, 400);
    let extra: string[] = [];
    try {
      const r = await env.DB.prepare("SELECT v FROM class_config WHERE k='meeting_categories'").first<{ v: string }>();
      const a = JSON.parse(String(r?.v ?? "[]"));
      if (Array.isArray(a)) extra = a.map(String);
    } catch { /* ignore */ }
    if (!DEFAULT_CATEGORIES.includes(name) && !extra.includes(name)) extra.push(name);
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS class_config (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')").run();
    await env.DB.prepare("INSERT INTO class_config(k,v) VALUES('meeting_categories',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(JSON.stringify(extra)).run();
    return json({ ok: true, categories: await getCategories(env) });
  }

  // 목록 — 권한 필터(원장 전체 / 그 외 작성자·참석자 본인).
  if (p === "/api/meetings" && m === "GET") {
    const { results } = await env.DB
      .prepare("SELECT id, title, category, meeting_date, attendees, status, summary, created_by, created_sub, attendee_subs, created_at FROM meeting_records ORDER BY meeting_date DESC, created_at DESC")
      .all<Record<string, unknown>>();
    const visible = (results || []).filter((r) => canView(me, String(r.created_sub ?? ""), parseSubs(r.attendee_subs)));
    return json({ meetings: visible.map(listRow) });
  }

  // 상세 — 권한 확인.
  if (/^\/api\/meetings\/\d+$/.test(p) && m === "GET") {
    const id = Number(p.split("/").pop());
    const row = await env.DB.prepare("SELECT * FROM meeting_records WHERE id=?").bind(id).first<Record<string, unknown>>();
    if (!row) return json({ error: "not_found" }, 404);
    if (!canView(me, String(row.created_sub ?? ""), parseSubs(row.attendee_subs))) return json({ error: "forbidden" }, 403);
    return json({ meeting: detailRow(row) });
  }

  // 음성 변환 + AI 요약(저장 전 미리보기). agenda(회의안 평문)가 있으면 요약에 반영.
  if (p === "/api/meetings/transcribe" && m === "POST") {
    try {
      const form = await request.formData();
      const audio = form.get("audio");
      const manualText = String(form.get("text") || "").trim();
      const agendaText = String(form.get("agenda") || "").trim().slice(0, 20000);
      let rawText = "";

      if (audio && typeof audio !== "string" && audio.size > 0) {
        const openaiKey = await apiKey(env, "openai");
        if (!openaiKey) return json({ error: "OpenAI API 키가 설정되지 않았어요. 원장님께 OPENAI_API_KEY 등록을 요청해주세요." }, 500);
        if (audio.size > 25 * 1024 * 1024) return json({ error: "음성 파일은 25MB 이하만 가능해요." }, 413);
        const wForm = new FormData();
        wForm.append("file", audio);
        wForm.append("model", "whisper-1");
        wForm.append("language", "ko");
        wForm.append("temperature", "0");
        // 무음 구간 환각(유튜브식 문구)을 줄이려 회의 맥락을 prompt로 주고, 구간별 신뢰도를 받는다.
        wForm.append("response_format", "verbose_json");
        wForm.append("prompt", "다음은 학원 운영 회의 녹음입니다. 한국어 회의 내용을 그대로 받아씁니다.");
        const wRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}` },
          body: wForm,
        });
        if (!wRes.ok) {
          const errText = await wRes.text();
          return json({ error: "음성 변환에 실패했어요. " + errText.slice(0, 300) }, 500);
        }
        const wData = (await wRes.json()) as { text?: string; segments?: { text?: string; no_speech_prob?: number; avg_logprob?: number }[] };
        rawText = cleanTranscript(wData);
        if (!rawText) {
          return json({ error: "음성이 또렷하게 녹음되지 않았어요. 마이크에 가까이·조용한 곳에서 다시 녹음하거나, ‘텍스트 직접 입력’으로 넣어 주세요." }, 422);
        }
      } else if (manualText) {
        rawText = manualText;
      } else {
        return json({ error: "음성 파일이나 텍스트를 입력해주세요." }, 400);
      }

      if (!rawText) return json({ error: "변환된 내용이 비어 있어요." }, 400);

      const anthropicKey = await apiKey(env, "anthropic");
      if (!anthropicKey) return json({ error: "Claude API 키가 설정되지 않았어요. 원장님께 ANTHROPIC_API_KEY 등록을 요청해주세요." }, 500);
      const cRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          messages: [{ role: "user", content: buildSummaryPrompt(agendaText, rawText) }],
        }),
      });
      if (!cRes.ok) {
        const errText = await cRes.text();
        return json({ error: "AI 요약 생성에 실패했어요. " + errText.slice(0, 300) }, 500);
      }
      const cData = (await cRes.json()) as { content?: { text?: string }[] };
      const summary = String(cData.content?.[0]?.text || "").trim();
      return json({ rawText, summary });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  // 저장 — id 없으면 생성, 있으면 수정(작성자·원장만). 회의안만 저장(예정)도 가능.
  if (p === "/api/meetings" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as {
      id?: number;
      title?: string;
      category?: string;
      meetingDate?: string;
      attendees?: string;
      attendeeSubs?: string[];
      agenda?: string;
      rawText?: string;
      summary?: string;
    };
    const title = String(b.title || "").trim().slice(0, 200);
    const meetingDate = String(b.meetingDate || "").trim().slice(0, 20);
    if (!title || !meetingDate) return json({ error: "제목과 날짜는 필수예요." }, 400);
    const category = String(b.category || "").trim().slice(0, 40);
    const attendees = String(b.attendees || "").slice(0, 500);
    const attendeeSubs = Array.isArray(b.attendeeSubs) ? b.attendeeSubs.map(String).slice(0, 100) : [];
    const agenda = String(b.agenda || "").slice(0, 200000);
    const rawText = String(b.rawText || "").slice(0, 200000);
    const summary = String(b.summary || "").slice(0, 20000);
    const status = summary ? "완료" : "예정";
    const now = Date.now();

    if (b.id) {
      const cur = await env.DB.prepare("SELECT created_sub FROM meeting_records WHERE id=?").bind(Number(b.id)).first<{ created_sub: string }>();
      if (!cur) return json({ error: "not_found" }, 404);
      if (me.role !== "admin" && String(cur.created_sub) !== me.sub) return json({ error: "forbidden" }, 403);
      await env.DB
        .prepare("UPDATE meeting_records SET title=?, category=?, meeting_date=?, attendees=?, attendee_subs=?, agenda=?, raw_text=?, summary=?, status=?, updated_at=? WHERE id=?")
        .bind(title, category, meetingDate, attendees, JSON.stringify(attendeeSubs), agenda, rawText, summary, status, now, Number(b.id))
        .run();
      return json({ ok: true, id: Number(b.id) });
    }

    const r = await env.DB
      .prepare("INSERT INTO meeting_records(title, category, meeting_date, attendees, attendee_subs, agenda, raw_text, summary, status, created_by, created_sub, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(title, category, meetingDate, attendees, JSON.stringify(attendeeSubs), agenda, rawText, summary, status, me.name, me.sub, now, now)
      .run();
    return json({ ok: true, id: r.meta.last_row_id });
  }

  // 삭제 — 작성자·원장만.
  if (p === "/api/meetings/delete" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: number | string };
    const id = Number(b.id);
    if (!id) return json({ error: "id_required" }, 400);
    const cur = await env.DB.prepare("SELECT created_sub FROM meeting_records WHERE id=?").bind(id).first<{ created_sub: string }>();
    if (!cur) return json({ ok: true });
    if (me.role !== "admin" && String(cur.created_sub) !== me.sub) return json({ error: "forbidden" }, 403);
    await env.DB.prepare("DELETE FROM meeting_records WHERE id=?").bind(id).run();
    return json({ ok: true });
  }

  return null;
}
