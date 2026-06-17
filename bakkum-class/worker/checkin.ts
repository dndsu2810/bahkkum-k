/// <reference types="@cloudflare/workers-types" />
// 등하원(체크인) — 학생이 출석번호로 등원/하원을 직접 찍고, 선생님이 확인 후 알림톡(솔라피)을 보낸다.
// 학생-학부모 번호는 기존 학생 데이터(students/class_student_meta)를 그대로 재사용한다.
// 솔라피 실제 발송은 키 설정 전까지 '테스트 모드'(기록만)로 동작한다.

import type { Env } from "./index";
import { readSession } from "./auth";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

// 한국시간(KST) 기준 날짜/시각.
function kstDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function kstTime(): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

export async function ensureCheckinTable(env: Env): Promise<void> {
  try {
    await env.DB
      .prepare(
        "CREATE TABLE IF NOT EXISTS class_checkin (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '등원', subject TEXT NOT NULL DEFAULT '', time TEXT NOT NULL DEFAULT '', sent INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL DEFAULT 0, corrected INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)"
      )
      .run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_class_checkin_date ON class_checkin(date)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_class_checkin_student ON class_checkin(student_id)").run();
  } catch {
    /* ignore */
  }
}

interface FoundStudent {
  id: string;
  name: string;
  grade: string;
  subjects: string[];
  parentPhone: string;
}

async function findByCode(env: Env, code: string): Promise<FoundStudent | null> {
  const c = code.trim();
  if (!c) return null;
  // 출석번호(학원이 부여한 checkin_no)를 우선 매칭, 없으면 온라인ID·학생번호로도 매칭(이전 설정 호환).
  // 과목은 meta.subjects 뿐 아니라 실제 수업 슬롯(수학=class_lessons, 영어=class_eng_lessons)·영어반으로도
  // 판정한다 — 영수 동시 수강생이 meta에 한 과목만 표시돼 4버튼이 안 뜨던 문제 방지.
  const row = await env.DB
    .prepare(
      "SELECT s.id id, s.name name, s.grade grade, s.parent_phone parent_phone, m.subjects subjects, m.english_band band, " +
        "(SELECT COUNT(*) FROM class_lessons WHERE student_id=CAST(s.id AS TEXT)) math_n, " +
        "(SELECT COUNT(*) FROM class_eng_lessons WHERE student_id=CAST(s.id AS TEXT)) eng_n " +
        "FROM students s LEFT JOIN class_student_meta m ON m.student_id = CAST(s.id AS TEXT) " +
        "WHERE (s.hidden IS NULL OR s.hidden=0) AND (m.checkin_no=? OR m.online_id=? OR CAST(s.id AS TEXT)=?) " +
        "ORDER BY CASE WHEN m.checkin_no=? THEN 0 ELSE 1 END LIMIT 1"
    )
    .bind(c, c, c, c)
    .first<{ id: number; name: string; grade: string; parent_phone: string; subjects: string; band: string; math_n: number; eng_n: number }>();
  if (!row) return null;
  const metaSubj = String(row.subjects ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const hasMath = metaSubj.includes("math") || Number(row.math_n) > 0;
  const hasEng = metaSubj.includes("english") || !!String(row.band ?? "") || Number(row.eng_n) > 0;
  let subjects = [hasMath ? "math" : "", hasEng ? "english" : ""].filter(Boolean);
  if (subjects.length === 0) subjects = ["math", "english"]; // 정보가 전혀 없으면 둘 다 노출
  return { id: String(row.id), name: String(row.name), grade: String(row.grade ?? ""), subjects, parentPhone: String(row.parent_phone ?? "") };
}

function rowOut(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    studentId: String(r.student_id),
    name: String(r.name ?? ""),
    grade: String(r.grade ?? ""),
    date: String(r.date ?? ""),
    kind: String(r.kind ?? "등원"),
    subject: String(r.subject ?? ""),
    time: String(r.time ?? ""),
    sent: Number(r.sent ?? 0) === 1,
    sentAt: Number(r.sent_at ?? 0),
    corrected: Number(r.corrected ?? 0) === 1,
  };
}

export async function handleCheckin(env: Env, request: Request, p: string, url: URL): Promise<Response | null> {
  const m = request.method;
  await ensureCheckinTable(env);

  // ---- 학생 키오스크(공개) — 출석번호 조회 ----
  if (p === "/api/checkin/lookup" && m === "GET") {
    const stu = await findByCode(env, url.searchParams.get("code") || "");
    if (!stu) return json({ found: false });
    return json({ found: true, student: { id: stu.id, name: stu.name, grade: stu.grade, subjects: stu.subjects } });
  }

  // ---- 학생 키오스크(공개) — 등원/하원 찍기 ----
  if (p === "/api/checkin/punch" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { code?: string; subject?: string; kind?: string };
    const stu = await findByCode(env, String(b.code || ""));
    if (!stu) return json({ ok: false, error: "not_found" }, 404);
    const kind = b.kind === "하원" ? "하원" : "등원";
    const subject = b.subject === "수학" ? "수학" : b.subject === "영어" ? "영어" : "";
    const date = kstDate();
    const time = kstTime();
    const now = Date.now();
    // 학생·날짜·과목·구분별 1건(다시 찍으면 시간 갱신). 이미 발송됐으면 정정 대상으로 표시.
    const id = `ci_${stu.id}_${date}_${subject || "x"}_${kind}`;
    const ex = await env.DB.prepare("SELECT sent FROM class_checkin WHERE id=?").bind(id).first<{ sent: number }>();
    if (ex) {
      const corrected = Number(ex.sent) === 1 ? 1 : 0; // 발송 후 재기록 → 정정 필요
      await env.DB.prepare("UPDATE class_checkin SET time=?, corrected=?, updated_at=? WHERE id=?").bind(time, corrected, now, id).run();
    } else {
      await env.DB
        .prepare("INSERT INTO class_checkin(id,student_id,date,kind,subject,time,sent,sent_at,corrected,created_at,updated_at) VALUES(?,?,?,?,?,?,0,0,0,?,?)")
        .bind(id, stu.id, date, kind, subject, time, now, now)
        .run();
    }
    return json({ ok: true, name: stu.name, grade: stu.grade, subject, kind, time });
  }

  // 이하 스태프 전용.
  const me = await readSession(env, request);
  if (!me || me.role === "student") return json({ error: "forbidden" }, 403);

  // ---- 선생님 관리 — 날짜별 목록 + 요약 ----
  if (p === "/api/checkin" && m === "GET") {
    const date = url.searchParams.get("date") || kstDate();
    const r = await env.DB
      .prepare(
        "SELECT c.*, s.name name, s.grade grade FROM class_checkin c JOIN students s ON s.id = CAST(c.student_id AS INTEGER) WHERE c.date=? ORDER BY c.time DESC, s.name"
      )
      .bind(date)
      .all<Record<string, unknown>>();
    const list = (r.results || []).map(rowOut);
    const arrive = list.filter((x) => x.kind === "등원").length;
    const leave = list.filter((x) => x.kind === "하원").length;
    const unsent = list.filter((x) => !x.sent).length;
    return json({ date, list, summary: { arrive, leave, unsent } });
  }

  // ---- 지난 날짜 목록(접기용) — 최근 N일의 날짜별 건수 ----
  if (p === "/api/checkin/days" && m === "GET") {
    const r = await env.DB
      .prepare("SELECT date, COUNT(*) cnt, SUM(CASE WHEN sent=0 THEN 1 ELSE 0 END) unsent FROM class_checkin GROUP BY date ORDER BY date DESC LIMIT 30")
      .all<{ date: string; cnt: number; unsent: number }>();
    return json({ days: (r.results || []).map((x) => ({ date: String(x.date), count: Number(x.cnt) || 0, unsent: Number(x.unsent) || 0 })) });
  }

  // ---- 선생님 — 시간 수정 ----
  if (p === "/api/checkin/time" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string; time?: string };
    if (!b.id || !/^\d{1,2}:\d{2}$/.test(String(b.time || ""))) return json({ error: "bad_request" }, 400);
    await env.DB.prepare("UPDATE class_checkin SET time=?, updated_at=? WHERE id=?").bind(String(b.time), Date.now(), b.id).run();
    return json({ ok: true });
  }

  // ---- 선생님 — 학부모 알림 보내기(솔라피) ----
  // 솔라피 키(secret_solapi_*) 미설정 시 '테스트 모드': 발송 기록만 남기고 실제 발송은 하지 않음.
  if (p === "/api/checkin/send" && m === "POST") {
    const b = (await request.json().catch(() => ({}))) as { id?: string };
    if (!b.id) return json({ error: "id_required" }, 400);
    const row = await env.DB
      .prepare("SELECT c.*, s.name name FROM class_checkin c JOIN students s ON s.id = CAST(c.student_id AS INTEGER) WHERE c.id=?")
      .bind(b.id)
      .first<Record<string, unknown>>();
    if (!row) return json({ error: "not_found" }, 404);
    const wasSent = Number(row.sent) === 1;
    const template = wasSent || Number(row.corrected) === 1 ? "정정" : String(row.kind ?? "등원"); // 등원 / 하원 / 정정
    const now = Date.now();
    // TODO(솔라피): 키 설정 후 sendSolapi(parentPhone, template, vars) 호출. 지금은 테스트 모드로 기록만.
    await env.DB.prepare("UPDATE class_checkin SET sent=1, sent_at=?, corrected=0, updated_at=? WHERE id=?").bind(now, now, b.id).run();
    return json({ ok: true, template, testMode: true });
  }

  // ---- 학생 상세 — 등하원 이력(조회용) ----
  if (p === "/api/checkin/student" && m === "GET") {
    const sid = url.searchParams.get("studentId") || "";
    if (!sid) return json({ history: [] });
    const r = await env.DB
      .prepare("SELECT c.*, s.name name, s.grade grade FROM class_checkin c JOIN students s ON s.id = CAST(c.student_id AS INTEGER) WHERE c.student_id=? ORDER BY c.date DESC, c.time DESC LIMIT 200")
      .bind(sid)
      .all<Record<string, unknown>>();
    return json({ history: (r.results || []).map(rowOut) });
  }

  return null;
}
