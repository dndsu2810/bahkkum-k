/// <reference types="@cloudflare/workers-types" />
// 영어(신규) 백엔드 — 일일 학습일지 · 진도 · 테스트. 앱(허브) 자체 저장(노션 X).
// 수학과 분리된 class_eng_* 테이블.

import type { Env } from "./index";
import type { SessionUser } from "./auth";
import { kstToday } from "./briefing";
import { baseballBoardFor } from "./baseball";

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

// '오늘 한 것' 기본 항목(초등 수업일지). 전체공통은 class_config, 학생별은 class_eng_done_items.
const DEFAULT_DONE_ITEMS = ["준비", "Practice Book", "영문법", "자판연습", "core phonics", "아카데미 주니어 프린트", "판다라이팅"];
function parseStrArr(s: unknown): string[] {
  try { const v = JSON.parse(String(s ?? "[]")); return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []; }
  catch { return []; }
}
// 포인트 사유 기본 목록(저장된 카탈로그가 없을 때 출발점). 라벨 끝 숫자가 점수.
const DEFAULT_POINT_REASONS: { name: string; value: number }[] = [
  { name: "출석 100", value: 100 },
  { name: "지각 -100", value: -100 },
  { name: "칭찬 200", value: 200 },
  { name: "단어숙제 50", value: 50 },
  { name: "독해숙제 50", value: 50 },
  { name: "문법숙제 50", value: 50 },
  { name: "숙제 50", value: 50 },
  { name: "숙제 -100", value: -100 },
  { name: "협동 300", value: 300 },
];
function parseReasonList(s: unknown): { name: string; value: number }[] {
  try { const a = JSON.parse(String(s ?? "[]")); return Array.isArray(a) ? a.map((r) => ({ name: String(r?.name ?? "").trim(), value: Math.round(Number(r?.value)) || 0 })).filter((r) => r.name) : []; }
  catch { return []; }
}
/** 포인트 항목 카탈로그 → {기본이름: 점수} 맵(라벨 끝 숫자 제거). 자동 적립 계산용. */
async function pointCatMap(env: Env): Promise<Record<string, number>> {
  let list = parseReasonList(await cfgGet(env, "point_reasons"));
  if (!list.length) list = DEFAULT_POINT_REASONS;
  const m: Record<string, number> = {};
  for (const r of list) {
    const key = String(r.name).replace(/\s*-?\d+\s*$/, "").trim();
    if (key && !(key in m)) m[key] = Math.round(Number(r.value)) || 0;
  }
  return m;
}
async function cfgGet(env: Env, k: string): Promise<string> {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS class_config (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')").run();
  return (await env.DB.prepare("SELECT v FROM class_config WHERE k=?").bind(k).first<{ v: string }>())?.v || "";
}
/** 한 학생의 '오늘 한 것' 선택지 = (기본−숨김) + 전체공통 + 학생별 (중복 제거). */
async function doneItemsFor(env: Env, sid: string): Promise<string[]> {
  const global = parseStrArr(await cfgGet(env, "eng_extra_done_items"));
  const hidden = parseStrArr(await cfgGet(env, "eng_hidden_done_items"));
  let student: string[] = [];
  try { student = parseStrArr((await env.DB.prepare("SELECT items FROM class_eng_done_items WHERE student_id=?").bind(sid).first<{ items: string }>())?.items); } catch { /* ignore */ }
  return [...new Set([...DEFAULT_DONE_ITEMS.filter((d) => !hidden.includes(d)), ...global, ...student])];
}

// 스키마 보장은 워커 isolate당 1회만(매 요청 수십 개 DDL 왕복 방지). 새 배포 = 새 isolate라 컬럼 추가 반영됨.
let engReady = false;
export async function ensureEngTables(env: Env): Promise<void> {
  if (engReady) return;
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
    // 학생이 직접 추가하는 '내가 추가한 학습'(강사 커리큘럼과 분리 — 강사 것을 덮지 않음).
    "CREATE TABLE IF NOT EXISTS class_eng_curriculum_self (student_id TEXT PRIMARY KEY, items TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL DEFAULT 0)",
    // '오늘 한 것' 학생별 추가 항목(전체공통은 class_config). 학생-1건, items JSON 배열.
    "CREATE TABLE IF NOT EXISTS class_eng_done_items (student_id TEXT PRIMARY KEY, items TEXT NOT NULL DEFAULT '[]')",
    // 내신기간 모드 — 학생별 ON/OFF + 기간(시작·종료) + 학교·시험일(D-day). 기간 안에서만 '오늘' 숙제가 자유입력+배부자료 기준으로 바뀐다.
    "CREATE TABLE IF NOT EXISTS class_eng_naesin (student_id TEXT PRIMARY KEY, on_flag INTEGER NOT NULL DEFAULT 0, start_date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '', school TEXT NOT NULL DEFAULT '', exam_date TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0)",
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
    // 중고등영어 진도 예고 — '다음에 할 것'(book_no는 '오늘 한 것').
    "ALTER TABLE class_eng_daily ADD COLUMN book_next TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_eng_daily ADD COLUMN word_test TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_eng_daily ADD COLUMN done_items TEXT NOT NULL DEFAULT '[]'",
    // 학생이 직접 적는 수업 시작/끝 시간(초등 개별 페이지 일지).
    "ALTER TABLE class_eng_daily ADD COLUMN start_time TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_eng_daily ADD COLUMN end_time TEXT NOT NULL DEFAULT ''",
    // 보강 플래그 — 이 수업이 보강이면 1. 출결은 그대로 남기되 포인트 적립에서 제외(수학과 통일).
    "ALTER TABLE class_eng_daily ADD COLUMN makeup INTEGER NOT NULL DEFAULT 0",
    // 테스트 결과 — 통과/재시(NP). 단어·문장 시험 미통과 표시.
    "ALTER TABLE class_eng_test ADD COLUMN result TEXT NOT NULL DEFAULT ''",
    // 재시험 연결 — 이 시험이 어떤 시험(id)의 '재시'로 자동 생성됐는지. 빈값이면 일반 시험.
    "ALTER TABLE class_eng_test ADD COLUMN retake_of TEXT NOT NULL DEFAULT ''",
    // 내신모드용 자유 숙제 — {assign:[내줄숙제], check:[{text,status}]} JSON. 지난 '내줄 숙제'가 이번 '숙제 검사'로 이어진다.
    "ALTER TABLE class_eng_daily ADD COLUMN hw_items TEXT NOT NULL DEFAULT '{}'",
    // 공유 숙제 목록 — 강사·학생이 함께 보고 체크(줄긋기). 숙제 자료 배부 시 자동 편입. [{text,done}]
    "ALTER TABLE class_eng_daily ADD COLUMN hw_list TEXT NOT NULL DEFAULT '[]'",
    // 학생이 '선생님께' 남기는 메모 — 강사 코멘트(comment)와 분리. 학생만 작성, 강사는 읽기.
    "ALTER TABLE class_eng_daily ADD COLUMN student_note TEXT NOT NULL DEFAULT ''",
    // 중고등영어 숙제 코멘트 — '수업 코멘트'(comment)와 별도로 숙제에 대한 코멘트.
    "ALTER TABLE class_eng_daily ADD COLUMN hw_comment TEXT NOT NULL DEFAULT ''",
    // 내신모드 학년 — 학생 명단에서 자동 매칭(학교와 함께).
    "ALTER TABLE class_eng_naesin ADD COLUMN grade TEXT NOT NULL DEFAULT ''",
    // 교재 완료일 — 수학 진도·교재관리와 동일. status='완료'로 바뀐 날.
    "ALTER TABLE class_eng_progress ADD COLUMN end_date TEXT NOT NULL DEFAULT ''",
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
  engReady = true;
}

export async function handleEng(env: Env, request: Request, p: string, me: SessionUser): Promise<Response | null> {
  const m = request.method;
  await ensureEngTables(env);
  const url = new URL(request.url);

  /* ---------------- 포인트 랭킹 ---------------- */
  // 영어 수업기록 포인트(class_eng_daily)와 수학 출결·칭찬 포인트(point_history, category='learn')를
  // 함께 합산한 통합 랭킹. (이전에는 영어만 집계되어 수학 등원 포인트가 빠져 있었음)
  if (p === "/api/eng/ranking" && m === "GET") {
    const r = await env.DB
      .prepare(
        "SELECT t.sid sid, SUM(t.pts) pts, SUM(t.cnt) cnt, s.name name, s.grade grade FROM (" +
          "SELECT CAST(student_id AS INTEGER) sid, SUM(points) pts, COUNT(*) cnt FROM class_eng_daily GROUP BY student_id" +
          " UNION ALL " +
          "SELECT student_id sid, SUM(delta) pts, COUNT(DISTINCT date(created_at)) cnt FROM point_history WHERE category='learn' GROUP BY student_id" +
          ") t JOIN students s ON s.id = t.sid WHERE (s.hidden IS NULL OR s.hidden=0) AND (s.status='재원' OR s.status IS NULL OR s.status='') GROUP BY t.sid ORDER BY pts DESC, s.name"
      )
      .all<Record<string, unknown>>();
    return json({
      ranking: (r.results || []).map((x) => ({ studentId: String(x.sid), name: String(x.name ?? ""), grade: String(x.grade ?? ""), points: Number(x.pts) || 0, days: Number(x.cnt) || 0 })),
    });
  }

  /* ---------------- 강사 추가 목록(오늘 한 것·포인트 사유) ---------------- */
  if (p === "/api/eng/catalog" && (m === "GET" || m === "POST")) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS class_config (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')").run();
    const getK = async (k: string) => (await env.DB.prepare("SELECT v FROM class_config WHERE k=?").bind(k).first<{ v: string }>())?.v || "";
    if (m === "POST") {
      const b = (await request.json().catch(() => ({}))) as { doneItems?: unknown; pointReasons?: unknown };
      const setK = (k: string, v: string) => env.DB.prepare("INSERT INTO class_config(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, v).run();
      if (Array.isArray(b.doneItems)) await setK("eng_extra_done_items", JSON.stringify(b.doneItems.map((x) => String(x).trim()).filter(Boolean).slice(0, 50)));
      if (Array.isArray(b.pointReasons)) await setK("eng_extra_point_reasons", JSON.stringify((b.pointReasons as { name?: unknown; value?: unknown }[]).filter((r) => r && r.name).map((r) => ({ name: String(r.name).trim(), value: Math.round(Number(r.value)) || 0 })).slice(0, 50)));
      return json({ ok: true });
    }
    let doneItems: string[] = [];
    let pointReasons: { name: string; value: number }[] = [];
    try { doneItems = JSON.parse((await getK("eng_extra_done_items")) || "[]"); } catch { /* ignore */ }
    try { pointReasons = JSON.parse((await getK("eng_extra_point_reasons")) || "[]"); } catch { /* ignore */ }
    return json({ doneItems, pointReasons });
  }

  /* ---------------- 포인트 항목(적립·차감 사유) 카탈로그 — 공통 단일 목록(원장·강사가 직접 작성) ---------------- */
  if (p === "/api/eng/point-reasons" && m === "GET") {
    let saved: { name: string; value: number }[] = [];
    try { const a = JSON.parse((await cfgGet(env, "point_reasons")) || "[]"); if (Array.isArray(a)) saved = a.map((r) => ({ name: String(r.name ?? "").trim(), value: Math.round(Number(r.value)) || 0 })).filter((r) => r.name); } catch { /* ignore */ }
    if (saved.length) return json({ reasons: saved });
    // 저장된 목록이 없으면 기본값 + 기존에 추가했던 사유를 합쳐 보여준다(최초 1회 작성 출발점).
    const extra = parseReasonList(await cfgGet(env, "eng_extra_point_reasons"));
    return json({ reasons: [...DEFAULT_POINT_REASONS, ...extra] });
  }
  if (p === "/api/eng/point-reasons" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { reasons?: unknown };
    const reasons = Array.isArray(b.reasons)
      ? (b.reasons as { name?: unknown; value?: unknown }[]).map((r) => ({ name: String(r?.name ?? "").trim(), value: Math.round(Number(r?.value)) || 0 })).filter((r) => r.name).slice(0, 100)
      : [];
    await env.DB.prepare("INSERT INTO class_config(k,v) VALUES('point_reasons',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(JSON.stringify(reasons)).run();
    return json({ ok: true, count: reasons.length });
  }
  if (p === "/api/eng/done-items" && m === "GET") {
    const sid = url.searchParams.get("student_id") || "";
    const global = parseStrArr(await cfgGet(env, "eng_extra_done_items"));
    const hidden = parseStrArr(await cfgGet(env, "eng_hidden_done_items"));
    let student: string[] = [];
    if (sid) { try { student = parseStrArr((await env.DB.prepare("SELECT items FROM class_eng_done_items WHERE student_id=?").bind(sid).first<{ items: string }>())?.items); } catch { /* ignore */ } }
    return json({ defaults: DEFAULT_DONE_ITEMS, hidden, global, student, merged: [...new Set([...DEFAULT_DONE_ITEMS.filter((d) => !hidden.includes(d)), ...global, ...student])] });
  }
  if (p === "/api/eng/done-items" && m === "POST") {
    const setCfg = (k: string, v: string) => env.DB.prepare("INSERT INTO class_config(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, v).run();
    const b = (await request.json().catch(() => ({}))) as { scope?: string; studentId?: string; add?: string; remove?: string };
    const add = String(b.add || "").trim();
    const remove = String(b.remove || "").trim();
    if (b.scope === "student") {
      const sid = String(b.studentId || "");
      if (!sid) return json({ error: "studentId_required" }, 400);
      let s: string[] = [];
      try { s = parseStrArr((await env.DB.prepare("SELECT items FROM class_eng_done_items WHERE student_id=?").bind(sid).first<{ items: string }>())?.items); } catch { /* ignore */ }
      if (add && !s.includes(add)) s.push(add);
      if (remove) s = s.filter((x) => x !== remove);
      await env.DB.prepare("INSERT INTO class_eng_done_items(student_id,items) VALUES(?,?) ON CONFLICT(student_id) DO UPDATE SET items=excluded.items").bind(sid, JSON.stringify(s.slice(0, 100))).run();
    } else {
      let g = parseStrArr(await cfgGet(env, "eng_extra_done_items"));
      let hidden = parseStrArr(await cfgGet(env, "eng_hidden_done_items"));
      // 기본 항목은 삭제 대신 '숨김' 목록으로, 추가 시 숨김 해제(복원). 커스텀은 전체공통 목록에서 추가/삭제.
      if (add) {
        if (DEFAULT_DONE_ITEMS.includes(add)) hidden = hidden.filter((x) => x !== add);
        else if (!g.includes(add)) g.push(add);
      }
      if (remove) {
        if (DEFAULT_DONE_ITEMS.includes(remove)) { if (!hidden.includes(remove)) hidden.push(remove); }
        else g = g.filter((x) => x !== remove);
      }
      await setCfg("eng_extra_done_items", JSON.stringify(g.slice(0, 100)));
      await setCfg("eng_hidden_done_items", JSON.stringify(hidden.slice(0, 50)));
    }
    return json({ ok: true });
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
    // 출결 상태 — 수학과 통일: 출석/지각/결석 + 조퇴/무단결석. 구버전 '등원'은 '출석'으로 정규화.
    let status = ["출석", "등원", "지각", "결석", "조퇴", "무단결석"].includes(String(b.attStatus)) ? String(b.attStatus) : "";
    if (status === "등원") status = "출석";
    const lateMin = Number(b.lateMin) || 0;
    const reason = String(b.absentReason || "");
    // 출석여부 — 출석·지각·조퇴는 등원(1), 결석·무단결석은 0. 상태 없으면 기존 attended 불린.
    const attended = status ? (status === "출석" || status === "지각" || status === "조퇴" ? 1 : 0) : b.attended ? 1 : 0;
    // 보강 플래그 — 켜면 이 수업은 보강(포인트 미적립).
    const makeup = b.makeup ? 1 : 0;
    const hwSt = (v: unknown) => (["완료", "미흡", "안함", "없음"].includes(String(v)) ? String(v) : "");
    const hwW = hwSt(b.hwWord), hwR = hwSt(b.hwReading), hwG = hwSt(b.hwGrammar);
    // 포인트 자동 적립 — 출결·숙제 상태로 '포인트 항목' 카탈로그 점수를 자동 계산(수동 선택 폐지).
    //   출석/조퇴 +출석점수, 지각 +지각점수(보통 −), 숙제 완료 +·미흡 절반·안함 −. 보강이면 전부 0.
    const catMap = await pointCatMap(env);
    const cs = (k: string, fb = 0) => (k in catMap ? catMap[k] : fb);
    const autoReasons: string[] = [];
    let points = 0;
    if (!makeup) {
      if (status === "출석" || status === "조퇴") { const v = cs("출석"); if (v) { points += v; autoReasons.push(`출석 ${v}`); } }
      else if (status === "지각") { const v = cs("지각"); if (v) { points += v; autoReasons.push(`지각 ${v}`); } }
      const hwPt = (val: string, key: string) => {
        if (!val || val === "없음") return;
        const base = cs(key, cs("숙제", 50));
        const v = val === "완료" ? base : val === "미흡" ? Math.round(base / 2) : val === "안함" ? -base : 0;
        if (v) { points += v; autoReasons.push(`${key} ${v}`); }
      };
      hwPt(hwW, "단어숙제"); hwPt(hwR, "독해숙제"); hwPt(hwG, "문법숙제");
    }
    const doneItems = Array.isArray(b.doneItems) ? (b.doneItems as unknown[]).map((x) => String(x)) : [];
    // 내신모드 자유 숙제 — 내줄 숙제(문자열 목록) + 숙제 검사(항목+상태). 점수에는 영향 없음(출결·3분류만 적립).
    const hwAssign = Array.isArray(b.hwAssign) ? (b.hwAssign as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 60) : [];
    const hwCheck = Array.isArray(b.hwCheck)
      ? (b.hwCheck as { text?: unknown; status?: unknown }[])
          .map((x) => ({ text: String(x?.text ?? "").trim(), status: hwSt(x?.status) }))
          .filter((x) => x.text)
          .slice(0, 60)
      : [];
    const hwItems = JSON.stringify({ assign: hwAssign, check: hwCheck, hwNone: !!b.hwNone, testNone: !!b.testNone });
    await env.DB
      .prepare(
        "INSERT INTO class_eng_daily(student_id,date,attended,att_status,late_min,absent_reason,makeup,goals,homework,hw_checked,hw_word,hw_reading,hw_grammar,wrong_check,attitude,point_reasons,points,note,book_no,book_next,word_test,done_items,comment,hw_comment,materials,hw_items,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(student_id,date) DO UPDATE SET attended=excluded.attended, att_status=excluded.att_status, late_min=excluded.late_min, absent_reason=excluded.absent_reason, makeup=excluded.makeup, goals=excluded.goals, homework=excluded.homework, hw_checked=excluded.hw_checked, hw_word=excluded.hw_word, hw_reading=excluded.hw_reading, hw_grammar=excluded.hw_grammar, wrong_check=excluded.wrong_check, attitude=excluded.attitude, point_reasons=excluded.point_reasons, points=excluded.points, note=excluded.note, book_no=excluded.book_no, book_next=excluded.book_next, word_test=excluded.word_test, done_items=excluded.done_items, comment=excluded.comment, hw_comment=excluded.hw_comment, materials=excluded.materials, hw_items=excluded.hw_items, updated_at=excluded.updated_at"
      )
      .bind(sid, date, attended, status, lateMin, reason, makeup, goals, String(b.homework || ""), b.hwChecked ? 1 : 0, hwW, hwR, hwG, b.wrongCheck ? 1 : 0, String(b.attitude || ""), JSON.stringify(autoReasons), points, String(b.note || ""), String(b.bookNo || ""), String(b.bookNext || ""), String(b.wordTest || ""), JSON.stringify(doneItems), String(b.comment || ""), String(b.hwComment || ""), String(b.materials || ""), hwItems, Date.now())
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
    } else if (status) {
      // 결석을 출석/지각/조퇴 등으로 정정하면, 자동 생성됐던 '보강 대기'(미예약 예정)를 같이 지운다.
      // 직접 날짜를 잡았거나 완료/취소된 보강은 건드리지 않는다.
      try {
        await env.DB
          .prepare("DELETE FROM class_eng_makeup WHERE student_id=? AND absent_date=? AND status='예정' AND (makeup_date IS NULL OR makeup_date='')")
          .bind(sid, date)
          .run();
      } catch {
        /* 정리 실패해도 출결 저장은 유지 */
      }
    }
    return json({ ok: true });
  }

  /* ---------------- 내신기간 모드 (학생별 ON/OFF + 기간·학교·시험일) ---------------- */
  if (p === "/api/eng/naesin" && m === "GET") {
    const r = await env.DB.prepare("SELECT * FROM class_eng_naesin").all<Record<string, unknown>>();
    return json({ list: (r.results || []).map(naesinRow) });
  }
  if (p === "/api/eng/naesin" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = String(b.studentId || "");
    if (!sid) return json({ error: "studentId_required" }, 400);
    const on = b.on ? 1 : 0;
    await env.DB
      .prepare(
        "INSERT INTO class_eng_naesin(student_id,on_flag,start_date,end_date,school,grade,exam_date,memo,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET on_flag=excluded.on_flag, start_date=excluded.start_date, end_date=excluded.end_date, school=excluded.school, grade=excluded.grade, exam_date=excluded.exam_date, memo=excluded.memo, updated_at=excluded.updated_at"
      )
      .bind(sid, on, String(b.startDate || ""), String(b.endDate || ""), String(b.school || ""), String(b.grade || ""), String(b.examDate || ""), String(b.memo || ""), Date.now())
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
    // 완료일 — 완료면 클라가 보낸 endDate, 진행/보류면 비움.
    const endDate = status === "완료" ? String(b.endDate || "") : "";
    const exists = await env.DB.prepare("SELECT id FROM class_eng_progress WHERE id=?").bind(id).first();
    if (exists) {
      await env.DB
        .prepare("UPDATE class_eng_progress SET book=?,level=?,status=?,start_date=?,end_date=?,memo=?,updated_at=? WHERE id=?")
        .bind(String(b.book || ""), String(b.level || ""), status, String(b.startDate || ""), endDate, String(b.memo || ""), Date.now(), id)
        .run();
    } else {
      await env.DB
        .prepare("INSERT INTO class_eng_progress(id,student_id,book,level,status,start_date,end_date,memo,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(id, sid, String(b.book || ""), String(b.level || ""), status, String(b.startDate || ""), endDate, String(b.memo || ""), Date.now())
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
    const sid = me.role === "student" ? me.sub : (url.searchParams.get("student_id") || "");
    const date = url.searchParams.get("date") || "";
    let q;
    if (sid && date) q = env.DB.prepare("SELECT * FROM class_eng_test WHERE student_id=? AND date=? ORDER BY created_at DESC").bind(sid, date);
    else if (sid) q = env.DB.prepare("SELECT * FROM class_eng_test WHERE student_id=? ORDER BY date DESC").bind(sid);
    else if (date) q = env.DB.prepare("SELECT * FROM class_eng_test WHERE date=? ORDER BY created_at DESC").bind(date);
    else q = env.DB.prepare("SELECT * FROM class_eng_test ORDER BY date DESC LIMIT 1000");
    const r = await q.all<Record<string, unknown>>();
    return json({ tests: (r.results || []).map(testRow) });
  }
  if (p === "/api/eng/test" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = me.role === "student" ? me.sub : String(b.studentId || "");
    if (!sid) return json({ error: "studentId_required" }, 400);
    const id = String(b.id || "") || newId("et");
    const result = ["통과", "재시"].includes(String(b.result)) ? String(b.result) : "";
    const retakeOf = String(b.retakeOf || "");
    const name = String(b.name || "");
    const total = Number(b.total) || 100;
    const exists = await env.DB.prepare("SELECT id FROM class_eng_test WHERE id=?").bind(id).first();
    if (exists) {
      await env.DB
        .prepare("UPDATE class_eng_test SET date=?,name=?,score=?,total=?,memo=?,result=?,retake_of=? WHERE id=?")
        .bind(String(b.date || ""), name, Number(b.score) || 0, total, String(b.memo || ""), result, retakeOf, id)
        .run();
    } else {
      await env.DB
        .prepare("INSERT INTO class_eng_test(id,student_id,date,name,score,total,memo,result,retake_of,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(id, sid, String(b.date || ""), name, Number(b.score) || 0, total, String(b.memo || ""), result, retakeOf, Date.now())
        .run();
    }
    // 재시(NP)면 같은 이름의 재시험을 자동 생성(중복 방지). 기본 날짜는 원 시험과 같은 날(오늘) — 화면에서 다음 시간으로 옮길 수 있음.
    // 재시를 해제하면, 아직 안 본(점수 0·결과 없음) 자동 재시험은 정리한다.
    let retakeId = "";
    if (result === "재시") {
      const child = await env.DB.prepare("SELECT id FROM class_eng_test WHERE retake_of=?").bind(id).first<{ id: string }>();
      if (child) {
        retakeId = String(child.id);
      } else {
        retakeId = newId("et");
        await env.DB
          .prepare("INSERT INTO class_eng_test(id,student_id,date,name,score,total,memo,result,retake_of,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .bind(retakeId, sid, String(b.date || ""), name, 0, total, "", "", id, Date.now())
          .run();
      }
    } else if (!retakeOf) {
      // 원 시험이 더는 재시가 아니면 미응시 자동 재시험 제거.
      await env.DB.prepare("DELETE FROM class_eng_test WHERE retake_of=? AND result='' AND score=0").bind(id).run();
    }
    return json({ ok: true, id, retakeId });
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

/* 커리큘럼 구조 — 노션 '수업 내용' 표와 동일.
   섹션(예: 매일 반복 / 지난 시간에 이어서 학습)별로 항목(이름 + 분량/내용). */
interface CurriculumRow {
  name: string;
  amount: string;
}
interface CurriculumSection {
  title: string;
  rows: CurriculumRow[];
}
interface Curriculum {
  note: string;
  sections: CurriculumSection[];
}

/** 신규/빈 학생 기본 양식(노션 초등 진도표 표준 구성). */
const CURRICULUM_DEFAULT: Curriculum = {
  note: "1개의 학습을 완전히 마무리 하고 다음 학습으로 넘어가세요.",
  sections: [
    {
      title: "⭐ 매일 반복",
      rows: [
        { name: "단어시험", amount: "10개씩" },
        { name: "스냅파닉스", amount: "1개" },
        { name: "Practice Book", amount: "하루에 한 개 꼭!" },
      ],
    },
    {
      title: "지난 시간에 이어서 학습",
      rows: [
        { name: "class 5", amount: "1개 학습 완료 후 Link 온라인 학습" },
        { name: "Link 교재", amount: "1 Unit" },
        { name: "원서 읽고 독서기록장 쓰기", amount: "1개" },
        { name: "필기체 쓰기", amount: "1개" },
      ],
    },
  ],
};

/** 초등영어 페이지 권한 보유자만 커리큘럼 편집 가능(원장 포함). */
function canEditCurriculum(me: SessionUser): boolean {
  if (me.role === "admin") return true;
  const scope = me.scope || [];
  // 영어 강사(초등·중고등)면 커리큘럼/진도 편집 가능. 원장이 화면 권한을 지정했으면 그걸 따른다.
  if (scope.length) return scope.includes("eng_elem") || scope.includes("eng_mid");
  return me.role === "english_elem" || me.role === "english_mid";
}

function cleanRows(v: unknown): CurriculumRow[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => ({ name: String((x as Record<string, unknown>)?.name ?? "").trim(), amount: String((x as Record<string, unknown>)?.amount ?? "").trim() }))
    .filter((r) => r.name || r.amount)
    .slice(0, 30);
}

function parseCurriculum(s: unknown): Curriculum {
  try {
    const v = JSON.parse(String(s ?? ""));
    // 구버전: [{label,value}] 배열 → 단일 섹션으로 변환.
    if (Array.isArray(v)) {
      const rows = v.map((x) => ({ name: String((x as Record<string, unknown>)?.label ?? "").trim(), amount: String((x as Record<string, unknown>)?.value ?? "").trim() })).filter((r) => r.name);
      return { note: "", sections: rows.length ? [{ title: "커리큘럼", rows }] : [] };
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const sections = Array.isArray(o.sections)
        ? (o.sections as unknown[]).map((sec) => ({ title: String((sec as Record<string, unknown>)?.title ?? "").trim(), rows: cleanRows((sec as Record<string, unknown>)?.rows) })).filter((sec) => sec.title || sec.rows.length).slice(0, 12)
        : [];
      return { note: String(o.note ?? ""), sections };
    }
  } catch {
    /* ignore */
  }
  return { note: "", sections: [] };
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
    const selfRow = await env.DB.prepare("SELECT items FROM class_eng_curriculum_self WHERE student_id=?").bind(sid).first<{ items: string }>();
    const selfCurriculum = cleanRows((() => { try { return JSON.parse(String(selfRow?.items ?? "[]")); } catch { return []; } })());

    const dRes = await env.DB.prepare("SELECT * FROM class_eng_daily WHERE student_id=? ORDER BY date DESC LIMIT 120").bind(sid).all<Record<string, unknown>>();
    const daily = (dRes.results || []).map(dailyRow);

    // 배부된 자료(수업/숙제) — 해제(배부취소) 전까지 계속 보임. 학생·강사 동일하게 일지에 표시.
    let materials: { kind: string; name: string }[] = [];
    try {
      const matRes = await env.DB
        .prepare("SELECT a.kind kind, m.name name FROM class_material_assign a JOIN class_materials m ON a.material_id=m.id WHERE a.student_id=? AND (m.archived IS NULL OR m.archived=0) ORDER BY a.created_at DESC")
        .bind(String(sid))
        .all<{ kind: string; name: string }>();
      const seen = new Set<string>();
      materials = (matRes.results || [])
        .map((r) => ({ kind: String(r.kind || "lesson"), name: String(r.name || "") }))
        .filter((r) => {
          const key = r.kind + "|" + r.name;
          if (!r.name || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    } catch {
      /* 자료 테이블 없거나 조회 실패는 무시 */
    }

    // 진행중 교재 — 진도·교재관리(class_eng_progress, status='진행')에서 가져와 학생 화면에 보여줌.
    let progressBooks: string[] = [];
    try {
      const pr = await env.DB.prepare("SELECT book, level FROM class_eng_progress WHERE student_id=? AND status='진행' AND book!='' ORDER BY updated_at DESC").bind(String(sid)).all<{ book: string; level: string }>();
      // 대시보드와 동일하게 '교재+레벨' 라벨 기준으로 중복 제거(같은 교재의 다른 레벨도 각각 표시).
      const seen = new Set<string>();
      for (const r of pr.results || []) {
        const book = String(r.book ?? "").trim();
        if (!book) continue;
        const lv = String(r.level ?? "").trim();
        const label = lv ? `${book} ${lv}` : book;
        if (seen.has(label)) continue;
        seen.add(label);
        progressBooks.push(label);
      }
    } catch {
      /* 진도 테이블 없거나 조회 실패는 무시 */
    }

    // 내신모드 여부 — 중고등(mid)만. 켜져 있고 오늘이 기간 안이면 true. 내신모드면 학생 화면에서 교재·진도 칸을 숨긴다.
    let examMode = false;
    if (band === "mid") {
      try {
        const n = await env.DB.prepare("SELECT on_flag, start_date, end_date FROM class_eng_naesin WHERE student_id=?").bind(String(sid)).first<{ on_flag: number; start_date: string; end_date: string }>();
        if (n && n.on_flag) {
          const t = kstToday().date;
          const start = String(n.start_date ?? "");
          const end = String(n.end_date ?? "");
          examMode = (!start || t >= start) && (!end || t <= end);
        }
      } catch {
        /* 내신 테이블 없거나 조회 실패는 무시 */
      }
    }

    // 수학 전광판(수학 야구) — 수학 수강생이면 점수판을, 아니면 null. 학생 화면 칩/모달용.
    const mathBoard = await baseballBoardFor(env, String(sid)).catch(() => null);

    return json({
      role: me.role,
      canEditCurriculum: canEditCurriculum(me),
      student: { id: String(sRow.id), name: String(sRow.name ?? ""), grade: String(sRow.grade ?? ""), school: String(sRow.school ?? ""), band, photo },
      engSlots,
      curriculum,
      selfCurriculum,
      daily,
      materials,
      progressBooks,
      examMode,
      mathBoard,
      doneItemOptions: await doneItemsFor(env, sid),
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
        "INSERT INTO class_eng_daily(student_id,date,attended,att_status,book_no,done_items,start_time,end_time,student_note,updated_at) VALUES(?,?,1,'출석',?,?,?,?,?,?) " +
          "ON CONFLICT(student_id,date) DO UPDATE SET attended=1, att_status=CASE WHEN class_eng_daily.att_status='' THEN '출석' ELSE class_eng_daily.att_status END, " +
          "book_no=excluded.book_no, done_items=excluded.done_items, start_time=excluded.start_time, end_time=excluded.end_time, student_note=excluded.student_note, updated_at=excluded.updated_at"
      )
      .bind(sid, date, String(b.bookNo || ""), JSON.stringify(doneItems), String(b.startTime || ""), String(b.endTime || ""), String(b.studentNote || ""), Date.now())
      .run();
    // 학습 목표 체크 — 학생/강사가 같은 목표를 공유(양방향). goals를 보낼 때만 갱신해 강사 목표를 덮어쓰지 않음.
    if (Array.isArray(b.goals)) {
      const goals = JSON.stringify((b.goals as unknown[]).map((g) => ({ text: String((g as Record<string, unknown>)?.text ?? ""), done: !!(g as Record<string, unknown>)?.done })));
      await env.DB.prepare("UPDATE class_eng_daily SET goals=?, updated_at=? WHERE student_id=? AND date=?").bind(goals, Date.now(), sid, date).run();
    }
    // 숙제 — 오늘의 숙제(assign)·숙제 검사(check)를 학생도 편집(강사와 양방향). 보낸 항목만 갱신, 안 보낸 건 보존.
    if (Array.isArray(b.hwAssign) || Array.isArray(b.hwCheck)) {
      const row = await env.DB.prepare("SELECT hw_items FROM class_eng_daily WHERE student_id=? AND date=?").bind(sid, date).first<{ hw_items: string }>();
      let curAssign: string[] = [];
      let curCheck: { text: string; status: string }[] = [];
      try {
        const o = JSON.parse(String(row?.hw_items ?? "{}")) as Record<string, unknown>;
        if (Array.isArray(o?.assign)) curAssign = (o.assign as unknown[]).map((x) => String(x));
        if (Array.isArray(o?.check)) curCheck = (o.check as Record<string, unknown>[]).map((x) => ({ text: String(x?.text ?? ""), status: String(x?.status ?? "") })).filter((x) => x.text);
      } catch { /* ignore */ }
      const hwSt = (v: unknown) => (["완료", "미흡", "안함", "없음"].includes(String(v)) ? String(v) : "");
      const assign = Array.isArray(b.hwAssign) ? (b.hwAssign as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 60) : curAssign;
      const check = Array.isArray(b.hwCheck)
        ? (b.hwCheck as { text?: unknown; status?: unknown }[]).map((x) => ({ text: String(x?.text ?? "").trim(), status: hwSt(x?.status) })).filter((x) => x.text).slice(0, 60)
        : curCheck;
      await env.DB.prepare("UPDATE class_eng_daily SET hw_items=?, updated_at=? WHERE student_id=? AND date=?").bind(JSON.stringify({ assign, check }), Date.now(), sid, date).run();
    }
    return json({ ok: true });
  }

  /* ---- 커리큘럼 저장(초등영어 권한자·원장) ---- */
  if (p === "/api/student/curriculum" && m === "POST") {
    if (!canEditCurriculum(me)) return json({ error: "forbidden" }, 403);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = String(b.studentId || "").trim();
    if (!sid) return json({ error: "student_required" }, 400);
    const sections = Array.isArray(b.sections)
      ? (b.sections as unknown[]).map((sec) => ({ title: String((sec as Record<string, unknown>)?.title ?? "").trim(), rows: cleanRows((sec as Record<string, unknown>)?.rows) })).filter((sec) => sec.title || sec.rows.length).slice(0, 12)
      : [];
    const payload: Curriculum = { note: String(b.note || ""), sections };
    await env.DB
      .prepare("INSERT INTO class_eng_curriculum(student_id,items,updated_at) VALUES(?,?,?) ON CONFLICT(student_id) DO UPDATE SET items=excluded.items, updated_at=excluded.updated_at")
      .bind(sid, JSON.stringify(payload), Date.now())
      .run();
    return json({ ok: true });
  }

  /* ---- '내가 추가한 학습' 저장(학생 본인·강사) — 강사 커리큘럼과 분리 ---- */
  if (p === "/api/student/curriculum-self" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = targetId(b.studentId as string);
    if (!sid) return json({ error: "student_required" }, 400);
    const items = cleanRows(b.items);
    await env.DB
      .prepare("INSERT INTO class_eng_curriculum_self(student_id,items,updated_at) VALUES(?,?,?) ON CONFLICT(student_id) DO UPDATE SET items=excluded.items, updated_at=excluded.updated_at")
      .bind(sid, JSON.stringify(items), Date.now())
      .run();
    return json({ ok: true });
  }

  /* ---- 커리큘럼 기본 양식(강사가 '기본 양식 불러오기') ---- */
  if (p === "/api/student/curriculum/defaults" && m === "GET") {
    return json({ defaults: CURRICULUM_DEFAULT });
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
  let hwAssign: string[] = [];
  let hwCheck: { text: string; status: string }[] = [];
  let hwNone = false;
  let testNone = false;
  try {
    const hi = JSON.parse(String(r.hw_items ?? "{}"));
    if (hi && typeof hi === "object") {
      if (Array.isArray(hi.assign)) hwAssign = hi.assign.map((x: unknown) => String(x));
      if (Array.isArray(hi.check)) hwCheck = hi.check.map((x: Record<string, unknown>) => ({ text: String(x?.text ?? ""), status: String(x?.status ?? "") })).filter((x: { text: string }) => x.text);
      hwNone = !!hi.hwNone;
      testNone = !!hi.testNone;
    }
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
    makeup: Number(r.makeup ?? 0) === 1,
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
    bookNext: String(r.book_next ?? ""),
    wordTest: String(r.word_test ?? ""),
    doneItems: (() => { try { const a = JSON.parse(String(r.done_items ?? "[]")); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } })(),
    startTime: String(r.start_time ?? ""),
    endTime: String(r.end_time ?? ""),
    comment: String(r.comment ?? ""),
    hwComment: String(r.hw_comment ?? ""),
    studentNote: String(r.student_note ?? ""),
    materials: String(r.materials ?? ""),
    hwAssign,
    hwCheck,
    hwNone,
    testNone,
    updatedAt: Number(r.updated_at ?? 0),
  };
}
function naesinRow(r: Record<string, unknown>) {
  return {
    studentId: String(r.student_id),
    on: Number(r.on_flag ?? 0) === 1,
    startDate: String(r.start_date ?? ""),
    endDate: String(r.end_date ?? ""),
    school: String(r.school ?? ""),
    grade: String(r.grade ?? ""),
    examDate: String(r.exam_date ?? ""),
    memo: String(r.memo ?? ""),
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
    endDate: String(r.end_date ?? ""),
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
    result: String(r.result ?? ""),
    retakeOf: String(r.retake_of ?? ""),
  };
}
