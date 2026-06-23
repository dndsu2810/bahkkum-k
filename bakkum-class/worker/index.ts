/// <reference types="@cloudflare/workers-types" />
// Cloudflare Worker: serves the built SPA and the /api JSON API backed by D1
// (the shared `bakuum-production` database).
//
// STUDENT ROSTER IS SHARED with the mogakgong `students` table:
//   - read  : the roster (id, name) comes from `students`; academic fields,
//             lessons, attendance, makeups live in `class_*` keyed by that id.
//   - add   : POST /api/students inserts into `students` (additive) + extras.
//   - rename: best-effort single-row UPDATE of students.name.
//   - NEVER deletes or bulk-overwrites `students` (mogakgong data is protected).
// attendance_log_v2 / student_schedules / consultations are NOT touched.
//
// API:
//   GET  /api/health
//   GET  /api/data            -> DataSnapshot (roster merged with class_* extras)
//   PUT  /api/data            -> replaces all class_* data (never students)
//   POST /api/students        -> {name,...} create/link roster student -> {id}
//   POST /api/points          -> {studentId,delta,reason} award/revoke points
//   GET  /api/report          -> monthly attendance aggregation

import type { AttRecord, DataSnapshot, Makeup, ScheduleVersion, Student, Task, TestLog } from "../src/types";
import {
  fetchNotionStudents,
  inspectDb,
  upsertHomeworkRecord,
  upsertProgressRecord,
  fetchHomeworkRecords,
  fetchProgressRecords,
  fetchAttendanceRecords,
  fetchTestRecords,
  upsertTestRecord,
  upsertAttendanceRecord,
  fetchScheduleItems,
  fetchClassPageMap,
  classPageIdForGrade,
  fetchAllStudentsFull,
  fetchClassTitleMap,
  fetchManualPages,
  fetchSnsPages,
  fetchEngHomework,
  fetchEngAttendance,
  fetchElemLog,
  fetchTaskAssignments,
  pushStudentsToNotion,
  type RestoreStudent,
} from "./notion";
import { NOTION_CFG } from "./notion";
import { isHoliday, holidayName } from "../src/lib/holidays";
import { buildBriefing, kstToday } from "./briefing";
import { sendKakao } from "./kakao";
import {
  type Role,
  type SessionUser,
  readSession,
  signSession,
  sessionCookie,
  clearCookie,
  loginTeacher,
  loginStudent,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getUserPrefs,
  setUserPrefs,
} from "./auth";
import { handleHub, ensureHubTables } from "./hub";
import { handleEng, handleStudent, ensureEngTables } from "./eng";
import { handleFeedback } from "./feedback";
import { handleMessages } from "./message";
import { handleCheckin } from "./checkin";
import { runCheckinAlerts } from "./checkinbot";
import { handleOrders } from "./orders";
import { handleMeeting } from "./meeting";
import { handlePost } from "./post";

const DEFAULT_APP_URL = "https://bakkum-class.dndsu2810.workers.dev";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MEDIA?: R2Bucket; // 업로드 이미지 저장
  NOTION_TOKEN?: string;
  // 카카오워크 브리핑 봇 (Worker Secret로 주입)
  KAKAO_WEBHOOK_URL?: string; // Incoming Webhook URL (권장)
  KAKAO_WORK_TOKEN?: string;
  KAKAO_WORK_RECIPIENT?: string;
  BOT_SECRET?: string; // 수동 테스트 엔드포인트 보호용
  APP_URL?: string; // 메시지 안의 앱 링크 (없으면 기본값)
  // 통합 허브 인증
  AUTH_SECRET?: string; // 세션 쿠키 서명 키 (없으면 BOT_SECRET/기본값)
  ADMIN_PIN?: string; // 원장(이지현) 부트스트랩 기본 PIN (없으면 기본값)
  // 학습키오스크(bakuum-kiosk) 포인트 미러링 — 수학 학생 적립/감점을 키오스크로 단방향 전송
  KIOSK_URL?: string; // 예: https://bakuum-kiosk.pages.dev
  KIOSK_POINTS_KEY?: string; // 키오스크 EXTERNAL_POINTS_KEY와 동일 값 (Secret)
  // 회의록 — 음성→텍스트(Whisper)·텍스트→요약(Claude) (Worker Secret로 주입)
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

const TEACHER = "이지현";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p.startsWith("/api/")) {
      try {
        if (p === "/api/health") return json({ ok: true });

        // 등하원(체크인) — lookup·punch는 공개(학생 키오스크), 나머지는 핸들러 내부에서 세션 확인.
        if (p.startsWith("/api/checkin")) {
          const res = await handleCheckin(env, request, p, url);
          if (res) return res;
        }
        // 교재·비품 주문 관리 — 스태프 전용(핸들러 내부에서 세션 확인).
        if (p.startsWith("/api/orders")) {
          const res = await handleOrders(env, request, p);
          if (res) return res;
        }

        // 업로드 이미지 서빙(공개) / 업로드(스태프)
        if (p.startsWith("/api/media/") && request.method === "GET") {
          if (!env.MEDIA) return new Response("no media", { status: 404 });
          const key = decodeURIComponent(p.slice("/api/media/".length));
          const obj = await env.MEDIA.get(key);
          if (!obj) return new Response("not found", { status: 404 });
          const h = new Headers();
          obj.writeHttpMetadata(h);
          h.set("cache-control", "public, max-age=31536000, immutable");
          return new Response(obj.body, { headers: h });
        }
        if (p === "/api/upload" && request.method === "POST") {
          const me = await readSession(env, request);
          // 로그인한 사용자면 업로드 허용(학생 포함) — 학생도 오류 신고에 스크린샷을 첨부할 수 있어야 이미지가 보인다.
          if (!me) return json({ error: "forbidden" }, 403);
          if (!env.MEDIA) return json({ error: "no_media" }, 500);
          const ct = request.headers.get("content-type") || "application/octet-stream";
          const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : "bin";
          const body = await request.arrayBuffer();
          if (body.byteLength === 0) return json({ error: "empty" }, 400);
          if (body.byteLength > 12_000_000) return json({ error: "too_large" }, 413);
          const key = `up/${crypto.randomUUID()}.${ext}`;
          await env.MEDIA.put(key, body, { httpMetadata: { contentType: ct } });
          return json({ url: `/api/media/${key}` });
        }
        // 일반 파일(첨부) 서빙(공개 다운로드) — 원래 파일명으로 내려준다.
        if (p.startsWith("/api/files/") && request.method === "GET") {
          if (!env.MEDIA) return new Response("no media", { status: 404 });
          const key = decodeURIComponent(p.slice("/api/files/".length));
          const obj = await env.MEDIA.get(key);
          if (!obj) return new Response("not found", { status: 404 });
          const name = key.split("/").pop() || "file";
          const h = new Headers();
          obj.writeHttpMetadata(h);
          h.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
          h.set("cache-control", "public, max-age=31536000, immutable");
          return new Response(obj.body, { headers: h });
        }
        // 일반 파일 업로드(스태프) — 원본 파일명 보존. x-filename 헤더에 파일명.
        if (p === "/api/files" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role === "student") return json({ error: "forbidden" }, 403);
          if (!env.MEDIA) return json({ error: "no_media" }, 500);
          const ct = request.headers.get("content-type") || "application/octet-stream";
          const rawName = decodeURIComponent(request.headers.get("x-filename") || "file");
          const name = rawName.replace(/[/\\]/g, "_").slice(0, 160) || "file";
          const body = await request.arrayBuffer();
          if (body.byteLength === 0) return json({ error: "empty" }, 400);
          if (body.byteLength > 25_000_000) return json({ error: "too_large" }, 413);
          const key = `file/${crypto.randomUUID()}/${name}`;
          await env.MEDIA.put(key, body, { httpMetadata: { contentType: ct } });
          return json({ url: `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`, name, size: body.byteLength });
        }
        // 전역 설정(학원 로고 등). GET: 로그인 스태프 누구나, POST: 원장.
        if (p === "/api/config" && request.method === "GET") {
          const me = await readSession(env, request);
          if (!me) return json({ error: "forbidden" }, 403);
          await env.DB.prepare("CREATE TABLE IF NOT EXISTS class_config (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')").run();
          const r = await env.DB.prepare("SELECT k,v FROM class_config").all<{ k: string; v: string }>();
          const cfg: Record<string, string> = {};
          const secretSet: string[] = []; // secret_* 키는 값 미노출, 설정 여부만.
          for (const row of r.results || []) {
            if (row.k.startsWith("secret_")) {
              if (row.v) secretSet.push(row.k);
            } else cfg[row.k] = row.v;
          }
          return json({ config: cfg, secretSet });
        }
        if (p === "/api/config" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me) return json({ error: "forbidden" }, 403);
          const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const keys = Object.keys(b);
          // 원장(admin)은 모든 설정 저장. 수학 강사는 '연간 수업 계획표' 키만. 강사 정보 안내(teacher_info)는 강사 누구나(학생 제외).
          const isPlanKey = (k: string) => (k.startsWith("math_plan_") || k.startsWith("math_year_plan")) && !k.startsWith("secret_");
          const allowed =
            me.role === "admin" ||
            (me.role === "math" && keys.length > 0 && keys.every(isPlanKey)) ||
            (me.role !== "student" && keys.length > 0 && keys.every((k) => k === "teacher_info"));
          if (!allowed) return json({ error: "forbidden" }, 403);
          await env.DB.prepare("CREATE TABLE IF NOT EXISTS class_config (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')").run();
          for (const [k, v] of Object.entries(b)) {
            await env.DB.prepare("INSERT INTO class_config(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(v ?? "")).run();
          }
          return json({ ok: true });
        }

        // 링크 미리보기(북마크 카드) — 대상 페이지의 og 메타 추출. 스태프 전용·http(s)만(SSRF 방지).
        if (p === "/api/linkmeta" && request.method === "GET") {
          const me = await readSession(env, request);
          if (!me) return json({ error: "unauthorized" }, 401);
          let u: URL;
          try { u = new URL(url.searchParams.get("url") || ""); } catch { return json({ error: "bad_url" }, 400); }
          if (u.protocol !== "http:" && u.protocol !== "https:") return json({ error: "bad_url" }, 400);
          const site = u.hostname.replace(/^www\./, "");
          try {
            const r = await fetch(u.href, { headers: { "user-agent": "Mozilla/5.0 (compatible; SoezBot/1.0)", accept: "text/html" }, redirect: "follow" });
            const html = (await r.text()).slice(0, 200000);
            const meta = (prop: string) => {
              const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i")) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i"));
              return m ? decodeEntities(m[1].trim()) : "";
            };
            const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
            const title = meta("og:title") || (titleTag ? decodeEntities(titleTag[1].trim()) : "") || site;
            const desc = meta("og:description") || meta("description");
            let image = meta("og:image");
            if (image && image.startsWith("//")) image = u.protocol + image;
            else if (image && image.startsWith("/")) image = u.origin + image;
            return json({ url: u.href, title, desc, image, site });
          } catch {
            return json({ url: u.href, title: site, desc: "", image: "", site });
          }
        }

        // ---- 통합 허브 인증 ----
        if (p === "/api/auth/login" && request.method === "POST") return await authLogin(env, request);
        if (p === "/api/auth/logout" && request.method === "POST") return authLogout();
        if (p === "/api/auth/me" && request.method === "GET") {
          const u = await readSession(env, request);
          return u ? json({ user: u }) : json({ user: null }, 401);
        }
        // 계정별 화면 설정(메뉴 순서·즐겨찾기) — PC 달라도 따라오게 계정에 저장.
        if (p === "/api/me/prefs") {
          const me = await readSession(env, request);
          if (!me) return json({ error: "unauthorized" }, 401);
          if (request.method === "GET") return json({ prefs: await getUserPrefs(env, me.sub) });
          if (request.method === "POST") {
            const b = (await request.json().catch(() => ({}))) as { prefs?: unknown };
            const prefs = typeof b.prefs === "string" ? b.prefs : JSON.stringify(b.prefs ?? "");
            await setUserPrefs(env, me.sub, prefs);
            return json({ ok: true });
          }
        }
        // 강사 계정 — 조회는 학생 제외 전 스태프(이름·역할만, 담당자 지정용), 생성·수정·삭제는 원장 전용.
        if (p === "/api/users") {
          const me = await readSession(env, request);
          if (request.method === "GET") {
            if (!me || me.role === "student") return json({ error: "forbidden" }, 403);
            return json({ users: await listUsers(env) });
          }
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          if (request.method === "POST") return await usersCreate(env, request);
        }
        if (p === "/api/users/update" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await usersUpdate(env, request);
        }
        if (p === "/api/users/delete" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await usersDelete(env, request);
        }

        // ---- 공통 학생 마스터 (수학·영어 공유) ----
        if (p === "/api/roster" && request.method === "GET") {
          const me = await readSession(env, request);
          if (!me || me.role === "student") return json({ error: "forbidden" }, 403);
          return json({ students: await readRoster(env) });
        }
        // 학생 명단/학생 관리 편집 — 학생 제외 전 스태프 허용(협업 관리).
        if (p === "/api/roster/meta" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role === "student") return json({ error: "forbidden" }, 403);
          return await rosterMetaUpsert(env, request);
        }
        if (p === "/api/roster/core" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role === "student") return json({ error: "forbidden" }, 403);
          return await rosterCoreUpdate(env, request);
        }
        if (p === "/api/roster/slots" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role === "student") return json({ error: "forbidden" }, 403);
          return await rosterSlotsUpdate(env, request);
        }
        // 학년 일괄: 생년월일 자동채움 · 전체 승급 · 일괄 되돌리기(원장 전용).
        if ((p === "/api/roster/grade-fill" || p === "/api/roster/promote" || p === "/api/roster/grade-bulk") && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          if (p === "/api/roster/grade-fill") return await rosterGradeFill(env);
          if (p === "/api/roster/promote") return await rosterPromote(env, request);
          return await rosterGradeBulk(env, request);
        }
        // 원장 대시보드 — 등록 현황·지각결석·특이사항 집계(원장 전용).
        if (p === "/api/admin/overview" && request.method === "GET") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await adminOverview(env, url);
        }
        if (p === "/api/admin/student" && request.method === "GET") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await adminStudentReport(env, url);
        }
        // 데스크 오늘 — 오늘 등원·지각(학생 제외 전 스태프).
        if (p === "/api/today" && request.method === "GET") {
          const me = await readSession(env, request);
          if (!me || me.role === "student") return json({ error: "forbidden" }, 403);
          return await todayAttendance(env);
        }
        // 노션 → 앱: 전체 재원 학생 동기화(수업 선택으로 과목 구분, 원장 전용, ?dry=1 미리보기)
        if (p === "/api/sync/roster") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await syncRoster(env, url);
        }
        // 시간표: 통합 조회(스태프) / 일괄 등록(원장)
        if (p === "/api/timetable" && request.method === "GET") {
          const me = await readSession(env, request);
          if (!me || me.role === "student") return json({ error: "forbidden" }, 403);
          return json({ lessons: await readTimetable(env) });
        }
        if (p === "/api/sync/timetable" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await writeTimetable(env, request);
        }
        // 노션 → 앱: 바꿈 매뉴얼 → 위키 / SNS(블로그) → SNS 관리 (원장 전용)
        if (p === "/api/sync/wiki") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await importWiki(env);
        }
        if (p === "/api/sync/sns") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await importSns(env);
        }
        if (p === "/api/sync/events") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await importEvents(env, request);
        }
        if (p === "/api/sync/eng-timetable" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await importEngTimetable(env, request);
        }
        // 노션 '과제기록 입력'(중고등영어 단어·리딩·문법 숙제) → class_eng_daily 가져오기.
        if (p === "/api/sync/eng-daily" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await importEngDaily(env);
        }
        // 노션 '수업기록(출결+포인트)' → class_eng_daily 출결·포인트 가져오기.
        if (p === "/api/sync/eng-attendance" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await importEngAttendance(env);
        }
        // 노션 '초등 수업일지' → class_eng_daily 초등 일지 가져오기.
        if (p === "/api/sync/eng-elem-log" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await importElemLog(env);
        }
        // 노션 '바꿈 할 일 배정 사항' → class_tasks(강사 업무보드) 가져오기.
        if (p === "/api/sync/tasks" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await importTasks(env);
        }
        // 복구: 앱 학생 명단 → 노션 학생 DB 되살리기(원장, ?dry=1 미리보기).
        if (p === "/api/restore/students-to-notion" && request.method === "POST") {
          const me = await readSession(env, request);
          if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);
          return await restoreStudentsToNotion(env, url);
        }

        // ---- 허브 공유 영역(특이사항·위키·SNS·업무보드) ----
        if (p.startsWith("/api/notes") || p.startsWith("/api/wiki") || p.startsWith("/api/sns") || p.startsWith("/api/tasks") || p.startsWith("/api/events") || p.startsWith("/api/reqs") || p.startsWith("/api/materials")) {
          const me = await readSession(env, request);
          if (!me || me.role === "student") return json({ error: "forbidden" }, 403);
          const res = await handleHub(env, request, p, me);
          if (res) return res;
        }

        // ---- 공지 배너 + 오류·개선 요청 — 로그인 누구나(학생 포함). 작성/조회 권한은 핸들러에서 ----
        if (p.startsWith("/api/notice") || p.startsWith("/api/issue")) {
          const me = await readSession(env, request);
          if (!me) return json({ error: "forbidden" }, 403);
          const res = await handleFeedback(env, request, p, me);
          if (res) return res;
        }

        // ---- 회의록 — 스태프 전용(학생 제외). 음성→텍스트·AI 요약·저장 ----
        if (p.startsWith("/api/meetings")) {
          const me = await readSession(env, request);
          if (!me || me.role === "student") return json({ error: "forbidden" }, 403);
          const res = await handleMeeting(env, request, p, me);
          if (res) return res;
        }

        // ---- 공지사항 게시판 — 로그인 누구나(학생은 전체공개분만, 작성은 스태프. 권한은 핸들러에서) ----
        if (p.startsWith("/api/posts")) {
          const me = await readSession(env, request);
          if (!me) return json({ error: "forbidden" }, 403);
          const res = await handlePost(env, request, p, me);
          if (res) return res;
        }

        // ---- 학생 메시지 — 로그인 누구나(발송=원장·수학, 수신=학생 본인. 권한은 핸들러에서) ----
        if (p.startsWith("/api/messages")) {
          const me = await readSession(env, request);
          if (!me) return json({ error: "forbidden" }, 403);
          const res = await handleMessages(env, request, p, me);
          if (res) return res;
        }

        // ---- 학생 개별 페이지 — 로그인 누구나(학생은 본인만, 강사는 student_id 지정) ----
        if (p.startsWith("/api/student/")) {
          const me = await readSession(env, request);
          if (!me) return json({ error: "forbidden" }, 403);
          const res = await handleStudent(env, request, p, me);
          if (res) return res;
        }

        // ---- 영어(신규) — 원장·영어 강사 전용 ----
        // 단, 통합 포인트 랭킹·포인트 항목은 수학/공통에서도 쓰는 공용 데이터라 권한을 완화한다.
        //  · /api/eng/ranking      : 수학+영어 합산 랭킹 → 로그인한 모든 사용자 열람
        //  · /api/eng/point-reasons: 적립·차감 사유 카탈로그 → 강사(수학 포함)·원장 공용(저장은 강사 이상)
        if (p.startsWith("/api/eng/")) {
          const me = await readSession(env, request);
          const isEngStaff = !!me && (me.role === "admin" || me.role === "english_mid" || me.role === "english_elem");
          const isTeacher = isEngStaff || (!!me && me.role === "math");
          const isCommonEng = p === "/api/eng/ranking" || p === "/api/eng/point-reasons";
          // 시험(테스트)은 학생 화면에서도 입력·조회 — 학생은 본인 것만(handleEng에서 본인 강제).
          const isStudentTest = !!me && me.role === "student" && p.startsWith("/api/eng/test");
          if (isCommonEng) {
            if (!me) return json({ error: "forbidden" }, 403);
            // 포인트 항목 저장(POST)은 강사 이상만.
            if (p === "/api/eng/point-reasons" && request.method === "POST" && !isTeacher)
              return json({ error: "forbidden" }, 403);
          } else if (!isEngStaff && !isStudentTest) {
            return json({ error: "forbidden" }, 403);
          }
          const res = await handleEng(env, request, p, me);
          if (res) return res;
        }

        // 수학 앱 핵심 데이터(로스터·기록·포인트) — 스태프(학생 제외) 로그인 필요.
        // (이전엔 무인증이라 PII 노출·무단 덮어쓰기 위험이 있었음)
        if (p === "/api/data" || p === "/api/students" || p === "/api/students/hide" || p === "/api/points" || p === "/api/points/redeem") {
          const me = await readSession(env, request);
          if (!me || me.role === "student") return json({ error: "forbidden" }, 403);
        }
        // 포인트 랭킹 '적립완료(시상)' — 그 학생의 누적 꿀을 0으로 초기화하고 새로 쌓게 한다.
        if (p === "/api/points/redeem" && request.method === "POST") return await redeemRanking(env, request);
        if (p === "/api/data" && request.method === "GET") return json(await readSnapshot(env));
        if (p === "/api/data" && request.method === "PUT") return await putData(env, request);
        if (p === "/api/students" && request.method === "POST") return await postStudents(env, request);
        if (p === "/api/students/hide" && request.method === "POST") {
          const b = (await request.json()) as { id?: string };
          if (b.id && /^\d+$/.test(b.id)) await env.DB.prepare("UPDATE students SET hidden=1 WHERE id=?").bind(Number(b.id)).run();
          return json({ ok: true });
        }
        if (p === "/api/points" && request.method === "POST") return await postPoints(env, request, ctx);
        // 포인트 항목 카탈로그(읽기) — 수학·영어 공통 적립 점수. 저장된 게 없으면 빈 목록(클라가 기본값 사용).
        if (p === "/api/points/catalog" && request.method === "GET") {
          await env.DB.prepare("CREATE TABLE IF NOT EXISTS class_config (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')").run();
          const v = (await env.DB.prepare("SELECT v FROM class_config WHERE k='point_reasons'").first<{ v: string }>())?.v || "[]";
          let reasons: { name: string; value: number }[] = [];
          try { const a = JSON.parse(v); if (Array.isArray(a)) reasons = a; } catch { /* ignore */ }
          return json({ reasons });
        }
        if (p === "/api/report" && request.method === "GET") return await getReport(env, url);
        if (p === "/api/sync/students" && request.method === "GET") return await syncStudents(env);
        if (p === "/api/schedule" && request.method === "GET") return await getSchedule(env, url);
        if (p === "/api/notion/inspect" && request.method === "GET") {
          try {
            return json(await inspectDb(env, url.searchParams.get("db") || "student"));
          } catch (e) {
            return json({ error: String(e) }, 500);
          }
        }
        if (p === "/api/notion/attendance" && request.method === "POST") return await notionAttendance(env, request);
        if (p === "/api/notion/homework" && request.method === "POST") return await notionHomework(env, request);
        if (p === "/api/notion/progress" && request.method === "POST") return await notionProgress(env, request);
        if (p === "/api/notion/test" && request.method === "POST") return await notionTest(env, request);
        if (p === "/api/sync/records" && request.method === "GET") return await importRecords(env, url);
        return json({ error: "not_found" }, 404);
      } catch (e) {
        return json({ error: "server_error", message: String(e) }, 500);
      }
    }

    // 카카오워크 봇 수동 테스트 (BOT_SECRET 설정 시 ?key= 필요). send=1 이면 실제 발송.
    if (p === "/__send-noon" || p === "/__send-night") {
      if (env.BOT_SECRET && url.searchParams.get("key") !== env.BOT_SECRET) return json({ error: "forbidden" }, 403);
      const slot = p === "/__send-noon" ? "noon" : "night";
      const doSend = url.searchParams.get("send") === "1";
      try {
        return json(await runBriefing(env, slot, doSend));
      } catch (e) {
        return json({ error: "briefing_failed", message: String(e) }, 500);
      }
    }
    // 등하원 알림봇 미리보기/수동테스트. ?at=HH:MM 시각 기준, send=1 이면 실제 발송(아니면 dry-run).
    if (p === "/__checkin") {
      if (env.BOT_SECRET && url.searchParams.get("key") !== env.BOT_SECRET) return json({ error: "forbidden" }, 403);
      const at = url.searchParams.get("at");
      const atMinutes = at && /^\d{1,2}:\d{2}$/.test(at) ? Number(at.split(":")[0]) * 60 + Number(at.split(":")[1]) : undefined;
      const doSend = url.searchParams.get("send") === "1";
      try {
        return json({ at, send: doSend, groups: await runCheckinAlerts(env, { atMinutes, dry: !doSend }) });
      } catch (e) {
        return json({ error: "checkin_failed", message: String(e) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },

  // 크론: 매분(등하원 알림봇) + 13:00 KST(낮 브리핑) + 21:00 KST(밤 요약).
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // 일일 브리핑은 지정된 크론에서만(매분 크론과 구분).
    if (event.cron === "0 4 * * *" || event.cron === "0 12 * * *") {
      const slot: "noon" | "night" = event.cron === "0 4 * * *" ? "noon" : "night";
      try { await runBriefing(env, slot, true); } catch (e) { console.error("scheduled briefing failed", String(e)); }
      try { await flushKioskOutbox(env); } catch (e) { console.error("flushKioskOutbox failed", String(e)); }
      return;
    }
    // 매분 — 등하원 알림봇.
    try { await runCheckinAlerts(env); } catch (e) { console.error("checkin alerts failed", String(e)); }
  },
};

interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

/** 오늘자 스냅샷을 읽어 낮/밤 메시지를 만들고, send면 수업 있는 날만 카카오로 발송. */
async function runBriefing(env: Env, slot: "noon" | "night", send: boolean) {
  const snap = await readSnapshot(env);
  const { date } = kstToday();
  const holiday = holidayName(date);
  const appUrl = env.APP_URL || DEFAULT_APP_URL;
  const b = buildBriefing(snap, holiday);
  const text = slot === "noon" ? b.noon : b.night;
  const button = { label: slot === "noon" ? "출결 입력하러 가기" : "보강·출결 정리하러 가기", url: appUrl };
  // 수업 없는 날(휴원/등원 0)이면 발송하지 않음.
  if (send && !b.hasClass) return { slot, date, hasClass: false, sent: false, reason: "no_class_today", text };
  const result = send ? await sendKakao(env, text, button) : { sent: false, reason: "dry_run" };
  return { slot, date, hasClass: b.hasClass, holiday: b.holiday, ...result, text };
}

/* ---------------- 인증 핸들러 ---------------- */
async function authLogin(env: Env, request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as {
    kind?: "teacher" | "student";
    name?: string;
    pin?: string;
    birth?: string;
  };
  const name = (b.name || "").trim();
  if (!name) return json({ error: "name_required" }, 400);
  let user: SessionUser | null = null;
  if (b.kind === "student") {
    const res = await loginStudent(env, name, b.birth || "");
    // 휴원·퇴원생은 로그인 차단 — 상태를 안내(팝업).
    if (res && "blockedStatus" in res) return json({ error: "student_blocked", status: res.blockedStatus }, 403);
    user = res;
  } else {
    user = await loginTeacher(env, name, b.pin || "");
  }
  if (!user) return json({ error: "invalid_credentials" }, 401);
  const token = await signSession(env, user);
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "set-cookie": sessionCookie(token) },
  });
}

function authLogout(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "set-cookie": clearCookie() },
  });
}

const VALID_ROLES: Role[] = ["admin", "developer", "math", "english_mid", "english_elem", "desk"];

async function usersCreate(env: Env, request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as {
    name?: string;
    role?: Role;
    scope?: string[];
    pin?: string;
    duty?: string[];
  };
  const name = (b.name || "").trim();
  const role = (b.role && VALID_ROLES.includes(b.role) ? b.role : "math") as Role;
  const pin = (b.pin || "").trim();
  if (!name) return json({ error: "name_required" }, 400);
  if (!/^\d{4,}$/.test(pin)) return json({ error: "pin_min_4_digits" }, 400);
  const user = await createUser(env, { name, role, scope: b.scope || defaultScope(role), pin, duty: b.duty || [] });
  return json({ user });
}

async function usersUpdate(env: Env, request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    role?: Role;
    scope?: string[];
    pin?: string;
    duty?: string[];
  };
  if (!b.id) return json({ error: "id_required" }, 400);
  if (b.pin != null && b.pin !== "" && !/^\d{4,}$/.test(b.pin)) return json({ error: "pin_min_4_digits" }, 400);
  if (b.role != null && !VALID_ROLES.includes(b.role)) return json({ error: "bad_role" }, 400);
  await updateUser(env, b.id, { name: b.name, role: b.role, scope: b.scope, pin: b.pin, duty: b.duty });
  return json({ ok: true });
}

async function usersDelete(env: Env, request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as { id?: string };
  if (!b.id) return json({ error: "id_required" }, 400);
  try {
    await deleteUser(env, b.id);
  } catch (e) {
    if (String(e).includes("last_admin")) return json({ error: "last_admin" }, 400);
    throw e;
  }
  return json({ ok: true });
}

/* ---------------- 공통 학생 마스터 ----------------
   기존 students 로스터(노션·모각공 공유)는 그대로 두고, 허브 전용 필드
   (온라인ID·수강과목·영어반)는 별도 class_student_meta에 보관(추가전용). */
let studentMetaReady = false;
async function ensureStudentMeta(env: Env): Promise<void> {
  if (studentMetaReady) return; // isolate당 1회 — roster 로드마다 DDL 왕복 방지
  try {
    await env.DB
      .prepare(
        "CREATE TABLE IF NOT EXISTS class_student_meta (student_id TEXT PRIMARY KEY, online_id TEXT NOT NULL DEFAULT '', subjects TEXT NOT NULL DEFAULT '', english_band TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0)"
      )
      .run();
  } catch {
    /* ignore */
  }
  // 허브 전용 추가 필드 — 등원요일(JSON 배열)·메모(특이사항 누적). 추가전용 ALTER(이미 있으면 무시).
  for (const col of [
    "ALTER TABLE class_student_meta ADD COLUMN attend_days TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_student_meta ADD COLUMN memo TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_student_meta ADD COLUMN photo TEXT NOT NULL DEFAULT ''",
    // 등하원 키오스크용 출석번호 — 학원이 직접 부여(학생이 키패드로 입력).
    "ALTER TABLE class_student_meta ADD COLUMN checkin_no TEXT NOT NULL DEFAULT ''",
    // 과목별 첫 등원일 — 영수 동시 수강생은 수학·영어 첫 등원일이 다를 수 있어 따로 둔다.
    "ALTER TABLE class_student_meta ADD COLUMN math_start TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_student_meta ADD COLUMN eng_start TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      await env.DB.prepare(col).run();
    } catch {
      /* 이미 있으면 무시 */
    }
  }
  studentMetaReady = true;
}

interface RosterStudent {
  id: string;
  name: string;
  grade: string;
  status: string;
  school: string;
  birthdate: string;
  parentPhone: string;
  studentPhone: string;
  startDate: string;
  onlineId: string;
  subjects: string[]; // ["math","english"]
  englishBand: string; // "elem" | "mid" | ""
  attendDays: string[]; // 등원요일 ["월","수","금"]
  memo: string; // 메모/특이사항(누적 자유 입력)
  photo: string; // 프로필 사진 URL(선택)
  checkinNo: string; // 등하원 키오스크 출석번호(학원이 부여)
  mathStart: string; // 수학 첫 등원일
  engStart: string; // 영어 첫 등원일
  mathSlots: Slot[]; // 수학 수업 요일·시간 (class_lessons 공유 — 수학 앱과 양방향)
  engSlots: Slot[]; // 영어 수업 요일·시간 (class_eng_lessons)
}
interface Slot {
  day: string;
  time: string;
  duration: number;
}

async function readRoster(env: Env): Promise<RosterStudent[]> {
  await ensureStudentMeta(env);
  const rosterRes = await env.DB
    .prepare(
      "SELECT id,name,grade,status,school,birth_date,parent_phone,student_phone,start_date FROM students WHERE hidden IS NULL OR hidden = 0 ORDER BY name"
    )
    .all<Record<string, unknown>>();

  const metaMap: Record<string, { online_id: string; subjects: string; english_band: string; attend_days?: string; memo?: string; photo?: string; checkin_no?: string; math_start?: string; eng_start?: string }> = {};
  try {
    const m = await env.DB
      .prepare("SELECT student_id, online_id, subjects, english_band, attend_days, memo, photo, checkin_no, math_start, eng_start FROM class_student_meta")
      .all<{ student_id: string; online_id: string; subjects: string; english_band: string; attend_days: string; memo: string; photo: string; checkin_no: string; math_start: string; eng_start: string }>();
    for (const r of m.results || []) metaMap[String(r.student_id)] = r;
  } catch {
    /* meta 없으면 기본값 */
  }

  // 과목별 수업 슬롯 — 수학(class_lessons, 수학 앱과 공유)·영어(class_eng_lessons).
  await ensureEngLessons(env);
  const mathSlotMap: Record<string, Slot[]> = {};
  const engSlotMap: Record<string, Slot[]> = {};
  try {
    const ml = await env.DB.prepare("SELECT student_id, day, time, duration FROM class_lessons ORDER BY sort_order").all<{ student_id: string; day: string; time: string; duration: number }>();
    for (const r of ml.results || []) (mathSlotMap[String(r.student_id)] ||= []).push({ day: String(r.day), time: String(r.time), duration: Number(r.duration) });
  } catch {
    /* ignore */
  }
  try {
    const el = await env.DB.prepare("SELECT student_id, day, time, duration FROM class_eng_lessons").all<{ student_id: string; day: string; time: string; duration: number }>();
    for (const r of el.results || []) (engSlotMap[String(r.student_id)] ||= []).push({ day: String(r.day), time: String(r.time), duration: Number(r.duration) });
  } catch {
    /* ignore */
  }

  return (rosterRes.results || []).map((r) => {
    const id = String(r.id);
    const meta = metaMap[id];
    let subjects: string[] = ["math"]; // 현재 로스터는 수학 기준 — 원장이 영어 추가
    if (meta) {
      try {
        const s = JSON.parse(meta.subjects || "[]");
        if (Array.isArray(s)) subjects = s.map(String);
      } catch {
        /* ignore */
      }
    }
    return {
      id,
      name: String(r.name ?? ""),
      grade: String(r.grade ?? ""),
      status: String(r.status ?? "재원"),
      school: String(r.school ?? ""),
      birthdate: String(r.birth_date ?? ""),
      parentPhone: String(r.parent_phone ?? ""),
      studentPhone: String(r.student_phone ?? ""),
      startDate: String(r.start_date ?? ""),
      onlineId: meta?.online_id || "",
      subjects,
      englishBand: meta?.english_band || "",
      attendDays: parseStrArr(meta?.attend_days),
      memo: meta?.memo || "",
      photo: meta?.photo || "",
      checkinNo: meta?.checkin_no || "",
      mathStart: meta?.math_start || "",
      engStart: meta?.eng_start || "",
      mathSlots: mathSlotMap[id] || [],
      engSlots: engSlotMap[id] || [],
    };
  });
}

function parseStrArr(s: unknown): string[] {
  try {
    const v = JSON.parse(String(s ?? "[]"));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

const DOW = ["월", "화", "수", "목", "금", "토", "일"];
async function rosterMetaUpsert(env: Env, request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as {
    studentId?: string;
    onlineId?: string;
    subjects?: string[];
    englishBand?: string;
    attendDays?: string[];
    memo?: string;
    photo?: string;
    checkinNo?: string;
    mathStart?: string;
    engStart?: string;
  };
  const sid = String(b.studentId || "");
  if (!sid) return json({ error: "studentId_required" }, 400);
  await ensureStudentMeta(env);
  const subjects = Array.isArray(b.subjects) ? b.subjects.map(String).filter((s) => s === "math" || s === "english") : [];
  const band = b.englishBand === "elem" || b.englishBand === "mid" || b.englishBand === "bridge" ? b.englishBand : "";
  const onlineId = typeof b.onlineId === "string" ? b.onlineId.slice(0, 120) : "";
  const attendDays = Array.isArray(b.attendDays) ? b.attendDays.map(String).filter((d) => DOW.includes(d)) : [];
  const memo = typeof b.memo === "string" ? b.memo.slice(0, 4000) : "";
  const photo = typeof b.photo === "string" ? b.photo.slice(0, 400) : "";
  const checkinNo = typeof b.checkinNo === "string" ? b.checkinNo.trim().slice(0, 20) : "";
  const mathStart = typeof b.mathStart === "string" ? b.mathStart.slice(0, 20) : "";
  const engStart = typeof b.engStart === "string" ? b.engStart.slice(0, 20) : "";
  await env.DB
    .prepare(
      "INSERT INTO class_student_meta(student_id,online_id,subjects,english_band,attend_days,memo,photo,checkin_no,math_start,eng_start,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET online_id=excluded.online_id, subjects=excluded.subjects, english_band=excluded.english_band, attend_days=excluded.attend_days, memo=excluded.memo, photo=excluded.photo, checkin_no=excluded.checkin_no, math_start=excluded.math_start, eng_start=excluded.eng_start, updated_at=excluded.updated_at"
    )
    .bind(sid, onlineId, JSON.stringify(subjects), band, JSON.stringify(attendDays), memo, photo, checkinNo, mathStart, engStart, Date.now())
    .run();
  return json({ ok: true });
}

/* 프로필 편집 — 공통 학생 핵심 필드(학교·학년·상태·생년월일·연락처·등록일)를 students에
   기록하고, 수정한 필드를 class_student_overrides에 '앱 소유'로 표시(노션 동기화가 안 덮어씀).
   수학 인라인 수정과 같은 메커니즘을 공유한다. 원장 전용. */
async function rosterCoreUpdate(env: Env, request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as {
    studentId?: string;
    name?: string;
    grade?: string;
    status?: string;
    school?: string;
    birthdate?: string;
    parentPhone?: string;
    studentPhone?: string;
    startDate?: string;
  };
  const sid = String(b.studentId || "");
  if (!sid || !/^\d+$/.test(sid)) return json({ error: "studentId_required" }, 400);
  const str = (v: unknown, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");
  // 이름은 수학 학생관리 인라인 수정에서만 함께 보낸다(보내지 않으면 기존 이름 유지).
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
  const grade = str(b.grade, 20);
  const status = str(b.status, 20) || "재원";
  const school = str(b.school);
  const birth = str(b.birthdate, 20);
  const pPhone = str(b.parentPhone, 40);
  const sPhone = str(b.studentPhone, 40);
  const start = str(b.startDate, 20);
  try {
    if (name) {
      await env.DB
        .prepare(
          "UPDATE students SET name=?,grade=?,status=?,school=?,birth_date=?,parent_phone=?,student_phone=?,start_date=? WHERE id=?"
        )
        .bind(name, grade, status, school, birth, pPhone, sPhone, start, Number(sid))
        .run();
    } else {
      await env.DB
        .prepare(
          "UPDATE students SET grade=?,status=?,school=?,birth_date=?,parent_phone=?,student_phone=?,start_date=? WHERE id=?"
        )
        .bind(grade, status, school, birth, pPhone, sPhone, start, Number(sid))
        .run();
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  // 수정한 필드를 '앱 소유'로 표시 — 노션 동기화가 이 값들을 덮어쓰지 않도록.
  try {
    await env.DB
      .prepare("CREATE TABLE IF NOT EXISTS class_student_overrides (student_id TEXT PRIMARY KEY, fields TEXT NOT NULL DEFAULT '[]')")
      .run();
    const row = await env.DB.prepare("SELECT fields FROM class_student_overrides WHERE student_id=?").bind(sid).first<{ fields: string }>();
    const cur = new Set<string>();
    try {
      for (const f of JSON.parse(String(row?.fields ?? "[]"))) cur.add(String(f));
    } catch {
      /* ignore */
    }
    ["grade", "status", "school", "birthdate", "parentPhone", "studentPhone", "startDate"].forEach((f) => cur.add(f));
    if (name) cur.add("name");
    await env.DB
      .prepare("INSERT INTO class_student_overrides(student_id,fields) VALUES(?,?) ON CONFLICT(student_id) DO UPDATE SET fields=excluded.fields")
      .bind(sid, JSON.stringify([...cur]))
      .run();
  } catch {
    /* overrides 실패해도 본 저장은 유지 */
  }
  return json({ ok: true });
}

/* ---------------- 학년 일괄 처리(원장) ---------------- */
// "초6"→{div,n}. 레거시 "초등"→n:0. 못읽으면 null.
function parseGradeW(g: string): { div: string; n: number } | null {
  const s = (g || "").trim();
  const m = /^(초|중|고)\s*(\d+)/.exec(s);
  if (m) return { div: m[1], n: Number(m[2]) };
  if (s.startsWith("초")) return { div: "초", n: 0 };
  if (s.startsWith("중")) return { div: "중", n: 0 };
  if (s.startsWith("고")) return { div: "고", n: 0 };
  return null;
}
function gradeFromBirthW(birth: string, year: number): string {
  const m = /^(\d{4})/.exec((birth || "").trim());
  if (!m) return "";
  const g = year - Number(m[1]) - 6;
  if (g < 1 || g > 12) return "";
  if (g <= 6) return "초" + g;
  if (g <= 9) return "중" + (g - 6);
  return "고" + (g - 9);
}
function promoteGradeW(g: string): string | null {
  const p = parseGradeW(g);
  if (!p || p.n <= 0) return null;
  if (p.div === "초") return p.n < 6 ? "초" + (p.n + 1) : "중1";
  if (p.div === "중") return p.n < 3 ? "중" + (p.n + 1) : "고1";
  if (p.div === "고") return p.n < 3 ? "고" + (p.n + 1) : "";
  return null;
}
// 생년월일 → 세부학년 1회 자동채움(세부학년 이미 있는 학생은 건너뜀).
async function rosterGradeFill(env: Env): Promise<Response> {
  const year = new Date().getFullYear();
  const r = await env.DB.prepare("SELECT id,grade,birth_date FROM students WHERE hidden IS NULL OR hidden=0").all<{ id: number; grade: string; birth_date: string }>();
  let filled = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const s of r.results || []) {
    const p = parseGradeW(String(s.grade || ""));
    if (p && p.n > 0) continue; // 이미 세부학년 있음
    const g = gradeFromBirthW(String(s.birth_date || ""), year);
    if (!g) continue;
    stmts.push(env.DB.prepare("UPDATE students SET grade=? WHERE id=?").bind(g, s.id));
    filled++;
  }
  for (let i = 0; i < stmts.length; i += 50) { try { await env.DB.batch(stmts.slice(i, i + 50)); } catch { /* skip */ } }
  return json({ ok: true, filled });
}
// 전체 학년 +1 승급. 고3→졸업(status). before 스냅샷 반환(되돌리기용).
async function rosterPromote(env: Env, request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as { includeAll?: boolean };
  const r = await env.DB.prepare("SELECT id,grade,status FROM students WHERE hidden IS NULL OR hidden=0").all<{ id: number; grade: string; status: string }>();
  let promoted = 0, graduated = 0;
  const before: { id: number; grade: string; status: string }[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const s of r.results || []) {
    const status = String(s.status || "재원");
    if (!b.includeAll && status !== "재원") continue;
    const ng = promoteGradeW(String(s.grade || ""));
    if (ng === null) continue; // 세부학년 없는 값은 제외
    before.push({ id: s.id, grade: String(s.grade || ""), status });
    if (ng === "") {
      stmts.push(env.DB.prepare("UPDATE students SET status='졸업' WHERE id=?").bind(s.id));
      graduated++;
    } else {
      stmts.push(env.DB.prepare("UPDATE students SET grade=? WHERE id=?").bind(ng, s.id));
      promoted++;
    }
  }
  for (let i = 0; i < stmts.length; i += 50) { try { await env.DB.batch(stmts.slice(i, i + 50)); } catch { /* skip */ } }
  return json({ ok: true, promoted, graduated, before });
}
// 일괄 학년/상태 세팅(되돌리기용). items=[{id,grade,status}].
async function rosterGradeBulk(env: Env, request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as { items?: { id?: number; grade?: string; status?: string }[] };
  const items = Array.isArray(b.items) ? b.items : [];
  const stmts: D1PreparedStatement[] = [];
  for (const it of items) {
    if (!it.id) continue;
    stmts.push(env.DB.prepare("UPDATE students SET grade=?, status=? WHERE id=?").bind(String(it.grade ?? ""), String(it.status ?? "재원"), Number(it.id)));
  }
  for (let i = 0; i < stmts.length; i += 50) { try { await env.DB.batch(stmts.slice(i, i + 50)); } catch { /* skip */ } }
  return json({ ok: true, reverted: items.length });
}

/* 학생 1명의 과목별 수업 슬롯(요일·시간·수업시간)을 교체 저장.
   수학은 class_lessons(수학 앱과 공유), 영어는 class_eng_lessons. 원장 전용.
   수학 슬롯은 수학 앱의 시간표·학생관리와 같은 테이블이라 양방향 반영된다.
   (다버전 시간표 이력이 있는 학생은 수학 앱에서 수정 권장 — 주석 참고) */
async function rosterSlotsUpdate(env: Env, request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as {
    studentId?: string;
    math?: { day?: string; time?: string; duration?: number }[];
    english?: { day?: string; time?: string; duration?: number }[];
  };
  const sid = String(b.studentId || "");
  if (!sid || !/^\d+$/.test(sid)) return json({ error: "studentId_required" }, 400);
  await ensureEngLessons(env);
  const clean = (arr: unknown): Slot[] =>
    (Array.isArray(arr) ? arr : [])
      .map((l) => {
        const o = (l || {}) as { day?: string; time?: string; duration?: number };
        return { day: String(o.day || ""), time: String(o.time || ""), duration: Number(o.duration) || 0 };
      })
      .filter((l) => DOW.includes(l.day) && /^\d{1,2}:\d{2}$/.test(l.time));
  const math = clean(b.math);
  const eng = clean(b.english);
  const stmts: D1PreparedStatement[] = [];
  stmts.push(env.DB.prepare("DELETE FROM class_lessons WHERE student_id=?").bind(sid));
  math.forEach((l, i) =>
    stmts.push(
      env.DB.prepare("INSERT INTO class_lessons(id,student_id,day,time,duration,sort_order) VALUES(?,?,?,?,?,?)").bind(`${sid}-${i}`, sid, l.day, l.time, l.duration, i)
    )
  );
  stmts.push(env.DB.prepare("DELETE FROM class_eng_lessons WHERE student_id=?").bind(sid));
  eng.forEach((l, i) =>
    stmts.push(
      env.DB.prepare("INSERT INTO class_eng_lessons(id,student_id,day,time,duration) VALUES(?,?,?,?,?)").bind(`${sid}-e${i}`, sid, l.day, l.time, l.duration)
    )
  );
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  return json({ ok: true });
}

/* ---------------- 원장 대시보드 · 데스크 오늘 집계 ---------------- */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
async function rowsRecent<T>(env: Env, sql: string, id: string, map: (r: Record<string, unknown>) => T): Promise<T[]> {
  try {
    const r = await env.DB.prepare(sql).bind(id).all<Record<string, unknown>>();
    return (r.results || []).map(map);
  } catch {
    return [];
  }
}

async function adminOverview(env: Env, url: URL): Promise<Response> {
  await ensureHubTables(env);
  const now = new Date();
  const month = url.searchParams.get("month") || `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const [yy, mm] = month.split("-").map(Number);
  const lmD = new Date(Date.UTC(yy, mm - 2, 1));
  const lastMonth = `${lmD.getUTCFullYear()}-${pad2(lmD.getUTCMonth() + 1)}`;

  const roster = await readRoster(env);
  const nameOf: Record<string, string> = {};
  for (const s of roster) nameOf[s.id] = s.name;
  const enrolled = roster.filter((s) => !s.status || s.status === "재원");
  const has = (s: RosterStudent, x: string) => s.subjects.includes(x);
  const summary = {
    total: enrolled.length,
    math: enrolled.filter((s) => has(s, "math")).length,
    eng: enrolled.filter((s) => has(s, "english")).length,
    elem: enrolled.filter((s) => has(s, "english") && s.englishBand === "elem").length,
    mid: enrolled.filter((s) => has(s, "english") && s.englishBand === "mid").length,
  };
  const newThis = roster.filter((s) => (s.startDate || "").startsWith(month)).length;
  const newLast = roster.filter((s) => (s.startDate || "").startsWith(lastMonth)).length;

  let late = 0;
  let absent = 0;
  // 과목별(math/elem/mid)로 분리 집계. 같은 학생·날짜·과목·상태는 1회만(중복 키 방지).
  type Cat = "math" | "elem" | "mid";
  type LA = { late: number; absent: number };
  const blank = (): Record<Cat, LA> => ({ math: { late: 0, absent: 0 }, elem: { late: 0, absent: 0 }, mid: { late: 0, absent: 0 } });
  const per: Record<string, Record<Cat, LA>> = {};
  const seen = new Set<string>();
  const bandOf: Record<string, string> = {};
  for (const s of roster) bandOf[s.id] = s.englishBand;
  const bump = (sid: string, date: string, st: string, cat: Cat) => {
    const k = sid + "|" + date + "|" + cat + "|" + st;
    if (seen.has(k)) return;
    seen.add(k);
    if (st === "지각") { late++; (per[sid] ||= blank())[cat].late++; }
    else if (st === "결석" || st === "무단결석") { absent++; (per[sid] ||= blank())[cat].absent++; }
  };
  try {
    const aRes = await env.DB.prepare("SELECT att_key,status FROM class_attendance WHERE att_key LIKE ?").bind(month + "%").all<Record<string, unknown>>();
    for (const r of aRes.results || []) {
      const parts = String(r.att_key).split("|");
      bump(parts[1], parts[0], String(r.status), "math");
    }
    const eRes = await env.DB.prepare("SELECT student_id,date,att_status FROM class_eng_daily WHERE date LIKE ?").bind(month + "%").all<Record<string, unknown>>();
    for (const r of eRes.results || []) {
      const sid = String(r.student_id);
      bump(sid, String(r.date), String(r.att_status ?? ""), bandOf[sid] === "elem" ? "elem" : "mid");
    }
  } catch {
    /* ignore */
  }
  const tot = (c: Record<Cat, LA>) => c.math.late + c.math.absent + c.elem.late + c.elem.absent + c.mid.late + c.mid.absent;
  const perStudent = Object.keys(per)
    .filter((sid) => nameOf[sid])
    .map((sid) => ({ id: sid, name: nameOf[sid], math: per[sid].math, elem: per[sid].elem, mid: per[sid].mid }))
    .sort((a, b) => tot(per[b.id]) - tot(per[a.id]));

  // 특이사항 — 수학·허브(class_notes)와 영어 수업기록(class_eng_daily.note)을 한데 모아 과목 라벨과 함께.
  type NoteItem = { studentId: string; studentName: string; author: string; body: string; createdAt: number; subject: string };
  let notes: NoteItem[] = [];
  try {
    const nRes = await env.DB.prepare("SELECT * FROM class_notes ORDER BY created_at DESC LIMIT 30").all<Record<string, unknown>>();
    for (const r of nRes.results || []) {
      notes.push({
        studentId: String(r.student_id),
        studentName: nameOf[String(r.student_id)] || "",
        author: String(r.author_name || ""),
        body: String(r.body || ""),
        createdAt: Number(r.created_at || 0),
        subject: "수학",
      });
    }
  } catch {
    /* ignore */
  }
  try {
    const eRes = await env.DB.prepare("SELECT student_id, date, note, updated_at FROM class_eng_daily WHERE note <> '' ORDER BY date DESC LIMIT 30").all<Record<string, unknown>>();
    for (const r of eRes.results || []) {
      const sid = String(r.student_id);
      const band = bandOf[sid] === "elem" ? "초등영어" : "영어";
      notes.push({
        studentId: sid,
        studentName: nameOf[sid] || "",
        author: "",
        body: String(r.note || ""),
        createdAt: Number(r.updated_at || 0) || Date.parse(String(r.date) + "T00:00:00+09:00") || 0,
        subject: band,
      });
    }
  } catch {
    /* ignore */
  }
  notes.sort((a, b) => b.createdAt - a.createdAt);
  notes = notes.slice(0, 20);

  return json({
    month,
    lastMonth,
    summary,
    newThis,
    newLast,
    late,
    absent,
    perStudent,
    notes,
    students: roster.map((s) => ({ id: s.id, name: s.name, grade: s.grade, status: s.status, subjects: s.subjects, englishBand: s.englishBand })),
  });
}

async function adminStudentReport(env: Env, url: URL): Promise<Response> {
  const id = url.searchParams.get("id") || "";
  if (!id) return json({ error: "id_required" }, 400);
  const now = new Date();
  const month = url.searchParams.get("month") || `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const roster = await readRoster(env);
  const stu = roster.find((s) => s.id === id);

  let mPresent = 0, mLate = 0, mAbsent = 0;
  try {
    const aRes = await env.DB.prepare("SELECT att_key,status FROM class_attendance WHERE att_key LIKE ?").bind(month + "%").all<Record<string, unknown>>();
    const seen = new Set<string>(); // 날짜·상태 중복 제거(중복 키 이중집계 방지)
    for (const r of aRes.results || []) {
      const parts = String(r.att_key).split("|");
      if (parts[1] !== id) continue;
      const st = String(r.status);
      const k = parts[0] + "|" + st;
      if (seen.has(k)) continue;
      seen.add(k);
      if (st === "지각") mLate++;
      else if (st === "결석" || st === "무단결석") mAbsent++;
      else mPresent++;
    }
  } catch {
    /* ignore */
  }
  let mathHw = 0;
  try {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM class_homework WHERE student_id=? AND date LIKE ?").bind(id, month + "%").first<{ n: number }>();
    mathHw = Number(r?.n || 0);
  } catch {
    /* ignore */
  }
  const mathTests = await rowsRecent(env, "SELECT * FROM class_tests WHERE student_id=? ORDER BY date DESC LIMIT 5", id, (r) => ({ date: String(r.date ?? ""), type: String(r.type ?? ""), score: Number(r.score ?? 0), status: String(r.status ?? "") }));
  const mathProg = await rowsRecent(env, "SELECT * FROM class_progress WHERE student_id=? ORDER BY date DESC LIMIT 5", id, (r) => ({ date: String(r.date ?? ""), unit: String(r.unit ?? ""), area: String(r.area ?? ""), pct: Number(r.pct ?? 0) }));

  let engAttend = 0, engHw = 0, engLate = 0, engAbsent = 0, engPoints = 0;
  const engComments: { date: string; comment: string }[] = [];
  try {
    const eRes = await env.DB.prepare("SELECT * FROM class_eng_daily WHERE student_id=? AND date LIKE ? ORDER BY date DESC").bind(id, month + "%").all<Record<string, unknown>>();
    for (const r of eRes.results || []) {
      if (Number(r.attended) === 1) engAttend++;
      if (Number(r.hw_checked) === 1) engHw++;
      const ast = String(r.att_status ?? "");
      if (ast === "지각") engLate++;
      else if (ast === "결석") engAbsent++;
      engPoints += Number(r.points ?? 0);
      if (r.comment) engComments.push({ date: String(r.date), comment: String(r.comment) });
    }
  } catch {
    /* ignore */
  }
  const engTests = await rowsRecent(env, "SELECT * FROM class_eng_test WHERE student_id=? ORDER BY date DESC LIMIT 5", id, (r) => ({ date: String(r.date ?? ""), name: String(r.name ?? ""), score: Number(r.score ?? 0), total: Number(r.total ?? 100) }));
  const engProg = await rowsRecent(env, "SELECT * FROM class_eng_progress WHERE student_id=? ORDER BY updated_at DESC LIMIT 5", id, (r) => ({ book: String(r.book ?? ""), level: String(r.level ?? ""), status: String(r.status ?? "") }));
  const mathNotes = await rowsRecent(env, "SELECT * FROM class_notes WHERE student_id=? ORDER BY created_at DESC LIMIT 10", id, (r) => ({ author: String(r.author_name ?? ""), body: String(r.body ?? ""), createdAt: Number(r.created_at ?? 0), subject: "수학" }));
  const engBand = stu?.englishBand === "elem" ? "초등영어" : "영어";
  const engNotes = await rowsRecent(env, "SELECT date, note, updated_at FROM class_eng_daily WHERE student_id=? AND note <> '' ORDER BY date DESC LIMIT 10", id, (r) => ({ author: "", body: String(r.note ?? ""), createdAt: Number(r.updated_at ?? 0) || Date.parse(String(r.date) + "T00:00:00+09:00") || 0, subject: engBand }));
  const notes = [...mathNotes, ...engNotes].sort((a, b) => b.createdAt - a.createdAt).slice(0, 15);

  return json({
    id,
    month,
    student: stu ? { name: stu.name, grade: stu.grade, school: stu.school, status: stu.status, subjects: stu.subjects, englishBand: stu.englishBand } : null,
    math: { present: mPresent, late: mLate, absent: mAbsent, homework: mathHw, tests: mathTests, progress: mathProg },
    english: { attended: engAttend, hwChecked: engHw, late: engLate, absent: engAbsent, points: engPoints, comments: engComments.slice(0, 5), tests: engTests, progress: engProg },
    notes,
  });
}

async function todayAttendance(env: Env): Promise<Response> {
  const now = new Date();
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const roster = await readRoster(env);
  const nameOf: Record<string, string> = {};
  const gradeOf: Record<string, string> = {};
  for (const s of roster) { nameOf[s.id] = s.name; gradeOf[s.id] = s.grade; }
  const records: { name: string; grade: string; subject: string; status: string; late: number; time: string }[] = [];
  try {
    const aRes = await env.DB.prepare("SELECT att_key,status,late_minutes FROM class_attendance WHERE att_key LIKE ?").bind(date + "%").all<Record<string, unknown>>();
    for (const r of aRes.results || []) {
      const parts = String(r.att_key).split("|");
      const sid = parts[1];
      if (!nameOf[sid]) continue;
      records.push({ name: nameOf[sid], grade: gradeOf[sid] || "", subject: "math", status: String(r.status), late: r.late_minutes ? Number(r.late_minutes) : 0, time: parts[2] || "" });
    }
  } catch {
    /* ignore */
  }
  try {
    const eRes = await env.DB.prepare("SELECT student_id,attended FROM class_eng_daily WHERE date=?").bind(date).all<Record<string, unknown>>();
    for (const r of eRes.results || []) {
      const sid = String(r.student_id);
      if (!nameOf[sid] || Number(r.attended) !== 1) continue;
      records.push({ name: nameOf[sid], grade: gradeOf[sid] || "", subject: "english", status: "등원", late: 0, time: "" });
    }
  } catch {
    /* ignore */
  }
  return json({ date, records });
}

/* 노션 → 앱 전체 학생 동기화. '수업 선택'(연결된 수업 제목)으로 과목을 구분한다:
   제목에 '수학'→math, '영어'→english. 영어 반은 제목의 '초등'/'중고등'(없으면 학년).
   앱에 없는 재원 학생은 students에 추가(공통 로스터). 과목·영어반·온라인ID는
   class_student_meta에 기록. ?dry=1이면 미반영 미리보기만. */
function gradeFromTitles(titles: string[]): string {
  return titles.some((t) => t.includes("초등")) ? "초등" : "중등";
}
function bandFrom(engTitles: string[], grade: string): string {
  if (engTitles.some((t) => t.includes("초등"))) return "elem";
  if (engTitles.some((t) => t.includes("중") || t.includes("고"))) return "mid";
  return String(grade).startsWith("초") ? "elem" : "mid"; // 실제 학년(초3 등)도 초등으로 인식
}
async function syncRoster(env: Env, url: URL): Promise<Response> {
  const dry = url.searchParams.get("dry") === "1";
  await ensureStudentMeta(env);
  let students, classMap: Record<string, string>;
  try {
    [students, classMap] = await Promise.all([fetchAllStudentsFull(env), fetchClassTitleMap(env)]);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  if (Object.keys(classMap).length === 0)
    return json({ error: "수업(과목) DB를 읽지 못했습니다. 노션 연동에 수업 DB 공유가 필요합니다." }, 400);

  // 기존 D1 학생: notion_page_id → {id, grade}
  const rows = await env.DB
    .prepare("SELECT id, grade, notion_page_id FROM students WHERE (hidden IS NULL OR hidden=0)")
    .all<{ id: number; grade: string; notion_page_id: string | null }>();
  const byPage: Record<string, { id: string; grade: string }> = {};
  for (const r of rows.results || [])
    if (r.notion_page_id) byPage[String(r.notion_page_id)] = { id: String(r.id), grade: String(r.grade || "") };

  const classCount: Record<string, number> = {};
  let inserted = 0;
  let mathN = 0;
  let engN = 0;
  let bothN = 0;
  const engSample: string[] = [];
  const noClass: string[] = [];

  for (const s of students) {
    const titles = s.classIds.map((id) => classMap[id]).filter(Boolean);
    for (const t of titles) classCount[t] = (classCount[t] || 0) + 1;
    const hasMath = titles.some((t) => t.includes("수학"));
    const hasEng = titles.some((t) => t.includes("영어"));
    const engTitles = titles.filter((t) => t.includes("영어"));
    // 수업 연결이 전혀 없는 페이지(템플릿·미배정)는 건너뛴다.
    if (!hasMath && !hasEng) {
      noClass.push(s.name);
      continue;
    }
    const subjects = [...(hasMath ? ["math"] : []), ...(hasEng ? ["english"] : [])];
    const existing = byPage[s.notionPageId];
    const grade = existing?.grade || gradeFromTitles(titles);
    const band = hasEng ? bandFrom(engTitles, grade) : "";

    if (hasMath && hasEng) bothN++;
    else if (hasMath) mathN++;
    else if (hasEng) engN++;
    if (hasEng && engSample.length < 80) engSample.push(`${s.name}(${band === "elem" ? "초등" : "중고등"})`);

    if (!dry) {
      let sid = existing?.id;
      if (!sid) {
        // 앱에 없는 재원 학생 추가(공통 로스터). 추가전용 — 기존 데이터 무영향.
        const ins = await env.DB
          .prepare(
            "INSERT INTO students(name,grade,status,school,birth_date,parent_phone,student_phone,start_date,notion_page_id) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id"
          )
          .bind(s.name, grade, "재원", s.school, s.birth, s.parentPhone, s.studentPhone, s.start, s.notionPageId)
          .first<{ id: number }>();
        sid = String(ins!.id);
        inserted++;
      }
      await env.DB
        .prepare(
          "INSERT INTO class_student_meta(student_id,online_id,subjects,english_band,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET online_id=excluded.online_id, subjects=excluded.subjects, english_band=excluded.english_band, updated_at=excluded.updated_at"
        )
        .bind(sid, s.onlineId.trim(), JSON.stringify(subjects), band, Date.now())
        .run();
    } else if (!existing) {
      inserted++; // dry: 추가 예정 수
    }
  }

  return json({
    dry,
    applied: !dry,
    notionStudents: students.length,
    classKinds: classCount, // 발견된 수업 제목별 인원 (확인용)
    willInsert: inserted,
    mathOnly: mathN,
    englishOnly: engN,
    both: bothN,
    noClassCount: noClass.length,
    noClass: noClass.slice(0, 40),
    englishSample: engSample,
  });
}

/* ---------------- 시간표 (수학=class_lessons / 영어=class_eng_lessons) ---------------- */
let engLessonsReady = false;
async function ensureEngLessons(env: Env): Promise<void> {
  if (engLessonsReady) return; // isolate당 1회
  try {
    await env.DB
      .prepare(
        "CREATE TABLE IF NOT EXISTS class_eng_lessons (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, day TEXT NOT NULL, time TEXT NOT NULL, duration INTEGER NOT NULL DEFAULT 0)"
      )
      .run();
  } catch {
    /* ignore */
  }
  engLessonsReady = true;
}

interface TtLesson {
  studentId: string;
  name: string;
  subject: "math" | "english";
  day: string;
  time: string;
  duration: number;
}
async function readTimetable(env: Env): Promise<TtLesson[]> {
  await ensureEngLessons(env);
  // 재원생만 — 휴원·퇴원생은 시간표에서 제외(상태를 재원으로 되돌리면 다시 보임).
  const nameRows = await env.DB.prepare("SELECT id, name FROM students WHERE (hidden IS NULL OR hidden = 0) AND (status='재원' OR status IS NULL OR status='')").all<{ id: number; name: string }>();
  const nameOf: Record<string, string> = {};
  for (const r of nameRows.results || []) nameOf[String(r.id)] = String(r.name);
  const out: TtLesson[] = [];
  const m = await env.DB.prepare("SELECT student_id, day, time, duration FROM class_lessons").all<{ student_id: string; day: string; time: string; duration: number }>();
  for (const r of m.results || [])
    if (nameOf[String(r.student_id)]) out.push({ studentId: String(r.student_id), name: nameOf[String(r.student_id)], subject: "math", day: String(r.day), time: String(r.time), duration: Number(r.duration) });
  try {
    const e = await env.DB.prepare("SELECT student_id, day, time, duration FROM class_eng_lessons").all<{ student_id: string; day: string; time: string; duration: number }>();
    for (const r of e.results || [])
      if (nameOf[String(r.student_id)]) out.push({ studentId: String(r.student_id), name: nameOf[String(r.student_id)], subject: "english", day: String(r.day), time: String(r.time), duration: Number(r.duration) });
  } catch {
    /* eng_lessons 없으면 수학만 */
  }
  return out;
}

async function writeTimetable(env: Env, request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as {
    math?: { studentId: string; day: string; time: string; duration: number }[];
    english?: { studentId: string; day: string; time: string; duration: number }[];
  };
  await ensureEngLessons(env);
  const math = (b.math || []).filter((l) => l.studentId && l.day && l.time);
  const eng = (b.english || []).filter((l) => l.studentId && l.day && l.time);
  const mathIds = [...new Set(math.map((l) => l.studentId))];
  const engIds = [...new Set(eng.map((l) => l.studentId))];

  const stmts: D1PreparedStatement[] = [];
  // 페이로드에 등장한 학생의 기존 시간표를 지우고 새로 넣는다(교체).
  for (const id of mathIds) stmts.push(env.DB.prepare("DELETE FROM class_lessons WHERE student_id=?").bind(id));
  for (const id of engIds) stmts.push(env.DB.prepare("DELETE FROM class_eng_lessons WHERE student_id=?").bind(id));
  const idx: Record<string, number> = {};
  for (const l of math) {
    const i = (idx[l.studentId] = (idx[l.studentId] ?? -1) + 1);
    stmts.push(
      env.DB
        .prepare("INSERT INTO class_lessons(id,student_id,day,time,duration,sort_order) VALUES(?,?,?,?,?,?)")
        .bind(`${l.studentId}-tt${i}`, l.studentId, l.day, l.time, l.duration || 0, i)
    );
  }
  const eidx: Record<string, number> = {};
  for (const l of eng) {
    const i = (eidx[l.studentId] = (eidx[l.studentId] ?? -1) + 1);
    stmts.push(
      env.DB
        .prepare("INSERT INTO class_eng_lessons(id,student_id,day,time,duration) VALUES(?,?,?,?,?)")
        .bind(`${l.studentId}-e${i}`, l.studentId, l.day, l.time, l.duration || 0)
    );
  }
  await runChunked(env, stmts);
  return json({ ok: true, mathLessons: math.length, engLessons: eng.length, mathStudents: mathIds.length, engStudents: engIds.length });
}

/* ---------------- 노션 매뉴얼/SNS 가져오기 ---------------- */
function mapImportance(s: string): number {
  if (s.includes("핵심")) return 4;
  if (s.includes("매우")) return 3;
  if (s.includes("높음")) return 3;
  if (s.includes("보통")) return 2;
  if (s.includes("낮음")) return 1;
  return 2;
}
function mapWikiStatus(s: string): string {
  if (s.includes("최신")) return "current";
  if (s.includes("업데이트")) return "outdated";
  if (s.includes("검토")) return "review";
  if (s.includes("작성")) return "writing";
  return "draft";
}
function mapSnsStatus(s: string): string {
  if (s.includes("완료")) return "done";
  if (s.includes("중지")) return "stop";
  if (s.includes("수정")) return "edit";
  return "wait";
}
let importSeq = 0;
async function importWiki(env: Env): Promise<Response> {
  await ensureHubTables(env);
  let pages;
  try {
    pages = await fetchManualPages(env);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  // 노션 이미지(로고·스크린샷)를 R2로 옮겨 영구 URL로. 노션 원본 URL은 임시라 그대로 두면 곧 깨진다.
  let imgCount = 0;
  for (const p of pages) {
    const urls = await rehostWikiImages(env, p.images);
    (p as typeof p & { _imgUrls?: string[] })._imgUrls = urls;
    imgCount += urls.length;
  }
  // 매뉴얼은 노션 미러 — 전체 교체(임시로 들어온 기존분 포함 정리).
  await env.DB.prepare("DELETE FROM class_wiki").run();
  const stmts: D1PreparedStatement[] = [];
  for (const p of pages) {
    const imgs = JSON.stringify((p as typeof p & { _imgUrls?: string[] })._imgUrls || []);
    stmts.push(
      env.DB
        .prepare("INSERT INTO class_wiki(id,title,body,importance,status,images,updated_by,updated_at,src) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(`w_${Date.now().toString(36)}${importSeq++}`, p.title, p.body, mapImportance(p.importance), mapWikiStatus(p.status), imgs, "노션", Date.now(), p.pageId)
    );
  }
  await runChunked(env, stmts);
  return json({ ok: true, imported: pages.length, images: imgCount });
}

/** 노션 이미지 참조를 R2(MEDIA)로 이관 → 앱 영구 URL(/api/media/wiki/{blockId}). 이미 있으면 재다운로드 생략. */
async function rehostWikiImages(env: Env, imgs: { id: string; url: string; caption: string }[]): Promise<string[]> {
  const out: string[] = [];
  if (!env.MEDIA) return out;
  for (const im of imgs) {
    const key = `wiki/${im.id.replace(/-/g, "")}`;
    try {
      const head = await env.MEDIA.head(key);
      if (!head) {
        const r = await fetch(im.url);
        if (!r.ok) continue;
        const ct = r.headers.get("content-type") || "image/png";
        await env.MEDIA.put(key, await r.arrayBuffer(), { httpMetadata: { contentType: ct } });
      }
      out.push(`/api/media/${key}`);
    } catch {
      /* 이 이미지 실패는 건너뛴다(나머지는 계속) */
    }
  }
  return out;
}
// 노션 '학원 일정' → 앱 class_events 로 1회 가져오기. 노션 페이지 id(src)로 중복 방지(재가져오기 시 갱신).
function mapEventCat(c: string): string {
  if (c.includes("학교")) return "학교";
  if (c.includes("강사")) return "강사";
  if (c.includes("휴") || c.includes("공휴")) return "휴원";
  if (c.includes("할")) return "할일";
  return "학원";
}
let evSeq = 0;
async function importEvents(env: Env, request: Request): Promise<Response> {
  await ensureHubTables(env);
  // 기본: 지난 180일부터 이후 일정 모두. ?since=YYYY-MM-DD 로 조정 가능.
  // (노션에서 날짜를 옮긴 과거 일정도 빠짐없이 재동기화되도록 넉넉히.)
  const url = new URL(request.url);
  let since = url.searchParams.get("since") || "";
  if (!since) {
    const d = new Date(Date.now() - 180 * 86400000);
    since = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  let items;
  try {
    items = await fetchScheduleItems(env, since);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  let imported = 0;
  const now = Date.now();
  for (const it of items) {
    try {
      const cat = mapEventCat(it.category || "");
      const memo = it.status ? `상태: ${it.status}` : "";
      const ex = await env.DB.prepare("SELECT id FROM class_events WHERE src=?").bind(it.id).first<{ id: string }>();
      if (ex) {
        await env.DB
          .prepare("UPDATE class_events SET date=?,end_date=?,title=?,category=?,memo=?,updated_at=? WHERE id=?")
          .bind(it.date, it.dateEnd || "", it.title, cat, memo, now, ex.id)
          .run();
      } else {
        const id = `ev_${now.toString(36)}${(evSeq++).toString(36)}`;
        await env.DB
          .prepare("INSERT INTO class_events(id,date,end_date,title,category,memo,author_id,author_name,created_at,updated_at,src) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
          .bind(id, it.date, it.dateEnd || "", it.title, cat, memo, "", "노션", now, now, it.id)
          .run();
      }
      imported++;
    } catch {
      /* 개별 실패는 건너뜀 */
    }
  }
  return json({ ok: true, imported });
}

// 영어 시간표 일괄 가져오기 — 이름으로 학생 매칭 → class_eng_lessons만 교체(수학 불변). 원장 전용.
async function importEngTimetable(env: Env, request: Request): Promise<Response> {
  await ensureEngLessons(env);
  const b = (await request.json().catch(() => ({}))) as {
    students?: { name?: string; slots?: { day?: string; time?: string; duration?: number }[] }[];
  };
  const entries = Array.isArray(b.students) ? b.students : [];
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const e of entries) {
    const name = String(e.name || "").trim();
    if (!name) continue;
    const row = await env.DB.prepare("SELECT id FROM students WHERE name=? AND (hidden IS NULL OR hidden=0) LIMIT 1").bind(name).first<{ id: number }>();
    if (!row) {
      unmatched.push(name);
      continue;
    }
    const sid = String(row.id);
    const slots = (Array.isArray(e.slots) ? e.slots : [])
      .map((s) => ({ day: String(s.day || ""), time: String(s.time || ""), duration: Number(s.duration) || 0 }))
      .filter((s) => DOW.includes(s.day) && /^\d{1,2}:\d{2}$/.test(s.time));
    const stmts: D1PreparedStatement[] = [env.DB.prepare("DELETE FROM class_eng_lessons WHERE student_id=?").bind(sid)];
    slots.forEach((s, i) =>
      stmts.push(env.DB.prepare("INSERT INTO class_eng_lessons(id,student_id,day,time,duration) VALUES(?,?,?,?,?)").bind(`${sid}-e${i}`, sid, s.day, s.time, s.duration))
    );
    // 이 가져오기는 '중고등영어 시간표'(MID) 전용 — 매칭된 학생은 영어 과목 + 중고등(mid) 밴드로 보정한다.
    // (이전엔 학년이 '초등'이면 englishBand가 elem으로 자동 추정돼 이유리·장진혁이 초등으로 잘못 분류됨)
    const metaRow = await env.DB.prepare("SELECT subjects FROM class_student_meta WHERE student_id=?").bind(sid).first<{ subjects: string }>();
    const subjList = String(metaRow?.subjects ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!subjList.includes("english")) subjList.push("english");
    stmts.push(
      env.DB.prepare(
        "INSERT INTO class_student_meta(student_id,subjects,english_band,updated_at) VALUES(?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET subjects=excluded.subjects, english_band='mid', updated_at=excluded.updated_at"
      ).bind(sid, subjList.join(","), "mid", Date.now())
    );
    try {
      await env.DB.batch(stmts);
      matched.push(name);
    } catch {
      unmatched.push(name);
    }
  }
  return json({ ok: true, matched: matched.length, unmatched });
}

// 노션 과제기록(중고등영어 단어·리딩·문법 숙제) → class_eng_daily 가져오기(이름 매칭, 숙제 칸만 갱신).
async function importEngDaily(env: Env): Promise<Response> {
  await ensureEngTables(env);
  let rows;
  try {
    rows = await fetchEngHomework(env);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  const nameRows = await env.DB.prepare("SELECT id, name FROM students WHERE hidden IS NULL OR hidden = 0").all<{ id: number; name: string }>();
  const idByName = new Map<string, string>();
  for (const r of nameRows.results || []) idByName.set(String(r.name).trim(), String(r.id));
  const stmts: D1PreparedStatement[] = [];
  let imported = 0;
  const unmatched = new Set<string>();
  for (const hw of rows) {
    const sid = idByName.get(hw.studentName.trim());
    if (!sid) {
      unmatched.add(hw.studentName);
      continue;
    }
    imported++;
    stmts.push(
      env.DB.prepare(
        "INSERT INTO class_eng_daily(student_id,date,hw_word,hw_reading,hw_grammar,wrong_check,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(student_id,date) DO UPDATE SET hw_word=excluded.hw_word, hw_reading=excluded.hw_reading, hw_grammar=excluded.hw_grammar, wrong_check=excluded.wrong_check, updated_at=excluded.updated_at"
      ).bind(sid, hw.date, hw.word, hw.reading, hw.grammar, hw.wrongCheck ? 1 : 0, Date.now())
    );
  }
  for (let i = 0; i < stmts.length; i += 50) {
    try {
      await env.DB.batch(stmts.slice(i, i + 50));
    } catch {
      /* 청크 실패는 건너뜀 */
    }
  }
  return json({ ok: true, total: rows.length, imported, unmatched: [...unmatched] });
}

// 노션 수업기록(출결+포인트) → class_eng_daily 출결·포인트 칸만 upsert(이름 매칭).
async function importEngAttendance(env: Env): Promise<Response> {
  await ensureEngTables(env);
  let rows;
  try {
    rows = await fetchEngAttendance(env);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  const nameRows = await env.DB.prepare("SELECT id, name FROM students WHERE hidden IS NULL OR hidden = 0").all<{ id: number; name: string }>();
  const idByName = new Map<string, string>();
  for (const r of nameRows.results || []) idByName.set(String(r.name).trim(), String(r.id));
  const stmts: D1PreparedStatement[] = [];
  let imported = 0;
  const unmatched = new Set<string>();
  for (const a of rows) {
    const sid = idByName.get(a.studentName.trim());
    if (!sid) {
      unmatched.add(a.studentName);
      continue;
    }
    imported++;
    const attended = a.attStatus === "출석" || a.attStatus === "지각" ? 1 : 0;
    stmts.push(
      env.DB.prepare(
        "INSERT INTO class_eng_daily(student_id,date,attended,att_status,late_min,attitude,point_reasons,points,note,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(student_id,date) DO UPDATE SET attended=excluded.attended, att_status=excluded.att_status, late_min=excluded.late_min, attitude=excluded.attitude, point_reasons=excluded.point_reasons, points=excluded.points, note=excluded.note, updated_at=excluded.updated_at"
      ).bind(sid, a.date, attended, a.attStatus, a.lateMin, a.attitude, JSON.stringify(a.reasons), a.points, a.note, Date.now())
    );
  }
  for (let i = 0; i < stmts.length; i += 50) {
    try {
      await env.DB.batch(stmts.slice(i, i + 50));
    } catch {
      /* 청크 실패는 건너뜀 */
    }
  }
  return json({ ok: true, total: rows.length, imported, unmatched: [...unmatched] });
}

// 노션 초등 수업일지 → class_eng_daily 초등 일지 칸만 upsert(이름 매칭, 출석으로 기록).
async function importElemLog(env: Env): Promise<Response> {
  await ensureEngTables(env);
  let rows;
  try {
    rows = await fetchElemLog(env);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  const nameRows = await env.DB.prepare("SELECT id, name FROM students WHERE hidden IS NULL OR hidden = 0").all<{ id: number; name: string }>();
  const idByName = new Map<string, string>();
  for (const r of nameRows.results || []) idByName.set(String(r.name).trim(), String(r.id));
  const stmts: D1PreparedStatement[] = [];
  let imported = 0;
  const unmatched = new Set<string>();
  for (const a of rows) {
    const sid = idByName.get(a.studentName.trim());
    if (!sid) { unmatched.add(a.studentName); continue; }
    imported++;
    const comment = [a.comment, a.time ? `시간 ${a.time}` : ""].filter(Boolean).join(" · ");
    stmts.push(
      env.DB.prepare(
        "INSERT INTO class_eng_daily(student_id,date,attended,att_status,book_no,word_test,done_items,note,comment,updated_at) VALUES(?,?,1,'출석',?,?,?,?,?,?) ON CONFLICT(student_id,date) DO UPDATE SET attended=1, att_status=CASE WHEN class_eng_daily.att_status='' THEN '출석' ELSE class_eng_daily.att_status END, book_no=excluded.book_no, word_test=excluded.word_test, done_items=excluded.done_items, note=excluded.note, comment=excluded.comment, updated_at=excluded.updated_at"
      ).bind(sid, a.date, a.bookNo, a.wordTest, JSON.stringify(a.doneItems), a.note, comment, Date.now())
    );
  }
  for (let i = 0; i < stmts.length; i += 50) { try { await env.DB.batch(stmts.slice(i, i + 50)); } catch { /* skip */ } }
  return json({ ok: true, total: rows.length, imported, unmatched: [...unmatched] });
}

// 노션 담당자 이메일 → 앱 강사 이름 보정(노션 이름이 영문/다른 표기일 때).
const ASSIGNEE_EMAIL_MAP: Record<string, string> = {
  "jiyeontree05@gmail.com": "목지연",
};

/** 노션 담당자(이름/이메일)를 앱 강사 이름으로 매칭. 공백 무시 + 글자 재배열('성이름'↔'이름성') 허용. */
function makeAssigneeMatcher(appNames: string[]) {
  const norm = (s: string) => s.replace(/\s+/g, "");
  const sortKey = (s: string) => norm(s).split("").sort().join("");
  const byNorm = new Map<string, string>();
  const bySorted = new Map<string, string>();
  for (const a of appNames) {
    const n = norm(a);
    if (!n) continue;
    if (!byNorm.has(n)) byNorm.set(n, a);
    if (!bySorted.has(sortKey(a))) bySorted.set(sortKey(a), a);
  }
  return (person: { name: string; email: string }): string => {
    if (person.email && ASSIGNEE_EMAIL_MAP[person.email]) return ASSIGNEE_EMAIL_MAP[person.email];
    const n = norm(person.name);
    if (!n) return "";
    if (byNorm.has(n)) return byNorm.get(n)!; // 공백만 다른 경우
    const sk = sortKey(person.name);
    if (bySorted.has(sk)) return bySorted.get(sk)!; // '목지연'↔'지연목' 등 순서만 다른 경우
    return person.name; // 매칭 실패 → 노션 이름 그대로
  };
}

// 노션 '바꿈 할 일 배정 사항' → class_tasks(강사 업무보드) upsert. source=노션 페이지로 중복 방지.
//  - '미나'(원장 개인 단계) → admin_only=1(강사 비공개). '업무 배정'부터 강사에게 공개.
//  - 완료/최종 완료(과거 완료분) → archived=1 로 보드에서 내려 '완료' 칸이 길어지지 않게.
//  - 담당자는 앱 강사 이름으로 매칭(공백·순서 차이, 이메일 보정).
async function importTasks(env: Env): Promise<Response> {
  await ensureHubTables(env);
  let rows;
  try {
    rows = await fetchTaskAssignments(env);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  const userRows = await env.DB.prepare("SELECT name FROM class_users").all<{ name: string }>();
  const matchName = makeAssigneeMatcher((userRows.results || []).map((r) => String(r.name).trim()).filter(Boolean));
  let imported = 0;
  const now = Date.now();
  for (const t of rows) {
    try {
      const src = "ntask_" + t.srcId;
      const assignee = [...new Set(t.assignees.map(matchName).filter(Boolean))].join(", ");
      const adminOnly = t.notionStatus === "미나" || t.notionStatus === "마나" ? 1 : 0;
      const isDone = t.status === "done";
      // 완료·최종완료는 모두 '완료'로 통일해 보드에 보이게(보관 안 함). 메모는 사용자 편집 보존 위해 갱신 안 함.
      const ex = await env.DB.prepare("SELECT id, done_at FROM class_tasks WHERE source=?").bind(src).first<{ id: string; done_at: number | null }>();
      if (ex) {
        await env.DB
          .prepare("UPDATE class_tasks SET title=?,status=?,tag=?,due=?,assignee=?,priority=?,admin_only=?,assign_date=?,archived=0,done_at=? WHERE id=?")
          .bind(t.title, t.status, t.tag, t.due, assignee, t.priority, adminOnly, t.assignDate, isDone ? ex.done_at ?? now : null, ex.id)
          .run();
      } else {
        await env.DB
          .prepare(
            "INSERT INTO class_tasks(id,title,status,tag,due,student_id,memo,assignee,priority,admin_only,assign_date,source,created_at,done_at,archived) VALUES(?,?,?,?,?,'','',?,?,?,?,?,?,?,0)"
          )
          .bind(`nt_${t.srcId}`, t.title, t.status, t.tag, t.due, assignee, t.priority, adminOnly, t.assignDate, src, now, isDone ? now : null)
          .run();
      }
      imported++;
    } catch {
      /* 개별 실패는 건너뜀 */
    }
  }
  return json({ ok: true, total: rows.length, imported });
}

// 복구: 앱 D1의 재원 학생을 노션 학생 DB로 되살린다(이미 있는 건 건너뜀). ?dry=1 미리보기.
async function restoreStudentsToNotion(env: Env, url: URL): Promise<Response> {
  const dry = url.searchParams.get("dry") === "1";
  await ensureStudentMeta(env);
  const rows = await env.DB
    .prepare("SELECT id,name,grade,status,school,birth_date,parent_phone,student_phone,start_date,notion_page_id FROM students WHERE (hidden IS NULL OR hidden=0) AND status='재원' ORDER BY id")
    .all<{ id: number; name: string; grade: string; status: string; school: string; birth_date: string; parent_phone: string; student_phone: string; start_date: string; notion_page_id: string | null }>();
  const metaRows = await env.DB.prepare("SELECT student_id, subjects, english_band, online_id FROM class_student_meta").all<{ student_id: string; subjects: string; english_band: string; online_id: string }>();
  const metaBy = new Map<string, { subjects: string; english_band: string; online_id: string }>();
  for (const m of metaRows.results || []) metaBy.set(String(m.student_id), { subjects: String(m.subjects || "[]"), english_band: String(m.english_band || ""), online_id: String(m.online_id || "") });
  const students: RestoreStudent[] = (rows.results || []).map((r) => {
    const m = metaBy.get(String(r.id));
    let subjects: string[] = [];
    try { subjects = JSON.parse(m?.subjects || "[]"); } catch { /* ignore */ }
    return {
      appId: String(r.id),
      name: String(r.name || ""),
      status: String(r.status || "재원"),
      school: String(r.school || ""),
      birth: String(r.birth_date || ""),
      parentPhone: String(r.parent_phone || ""),
      studentPhone: String(r.student_phone || ""),
      start: String(r.start_date || ""),
      onlineId: String(m?.online_id || ""),
      grade: String(r.grade || ""),
      subjects,
      band: String(m?.english_band || ""),
      notionPageId: String(r.notion_page_id || ""),
    };
  });
  let result;
  try {
    result = await pushStudentsToNotion(env, students, dry);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  // 새로 만든 페이지 id를 앱에 반영(다음 동기화 때 매칭되게).
  if (!dry) {
    for (const c of result.created) {
      try { await env.DB.prepare("UPDATE students SET notion_page_id=? WHERE id=?").bind(c.pageId, Number(c.appId)).run(); } catch { /* ignore */ }
    }
  }
  return json(result);
}

async function importSns(env: Env): Promise<Response> {
  await ensureHubTables(env);
  let pages;
  try {
    pages = await fetchSnsPages(env);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  await env.DB.prepare("DELETE FROM class_sns WHERE src <> ''").run();
  const stmts: D1PreparedStatement[] = [];
  for (const p of pages) {
    const now = Date.now();
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_sns(id,title,body,channel,author_id,author_name,status,link,created_at,updated_at,src) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
        )
        .bind(`s_${Date.now().toString(36)}${importSeq++}`, p.title, p.body, "블로그", "", "노션", mapSnsStatus(p.status), p.link, now, now, p.pageId)
    );
  }
  await runChunked(env, stmts);
  return json({ ok: true, imported: pages.length });
}

/** 역할별 기본 담당 배분. */
function defaultScope(role: Role): string[] {
  if (role === "math") return ["math"];
  if (role === "english_mid") return ["english_mid"];
  if (role === "english_elem") return ["english_elem"];
  if (role === "admin" || role === "developer") return ["math", "english_mid", "english_elem"];
  return [];
}

/* class_schedules / class_tests 테이블 자가 생성(마이그레이션 미적용이어도 동작하게).
   추가전용(IF NOT EXISTS) — 기존 데이터 무영향. */
async function ensureSchedulesTable(env: Env): Promise<void> {
  try {
    await env.DB
      .prepare("CREATE TABLE IF NOT EXISTS class_schedules (student_id TEXT PRIMARY KEY, versions TEXT NOT NULL DEFAULT '[]')")
      .run();
  } catch {
    /* ignore */
  }
  try {
    await env.DB
      .prepare(
        "CREATE TABLE IF NOT EXISTS class_tests (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, date TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', round TEXT NOT NULL DEFAULT '', range_ TEXT NOT NULL DEFAULT '', score INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '예정', memo TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"
      )
      .run();
  } catch {
    /* ignore */
  }
  // 사용자가 직접 삭제한 보강(결석)의 att_key — 노션 재가져오기/재체크 때 되살아나지 않게.
  try {
    await env.DB
      .prepare("CREATE TABLE IF NOT EXISTS class_makeup_dismissed (att_key TEXT PRIMARY KEY)")
      .run();
  } catch {
    /* ignore */
  }
  // 앱에서 인라인 수정해 '앱 소유'가 된 학생 필드 — 노션 동기화가 덮어쓰지 않게.
  try {
    await env.DB
      .prepare("CREATE TABLE IF NOT EXISTS class_student_overrides (student_id TEXT PRIMARY KEY, fields TEXT NOT NULL DEFAULT '[]')")
      .run();
  } catch {
    /* ignore */
  }
  // '오늘 숙제 없음'으로 정리한 표식 — 숙제 기록을 만들지 않고 정리완료만 기억. key=studentId|날짜.
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS class_homework_none (mark_key TEXT PRIMARY KEY)").run();
  } catch {
    /* ignore */
  }
  // 숙제 검사 일정 영속화 — 다시검사일·밀림횟수·결석이월출처(있으면 무시).
  for (const a of [
    "ALTER TABLE class_homework ADD COLUMN recheck_date TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE class_homework ADD COLUMN delay_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE class_homework ADD COLUMN carried_from TEXT NOT NULL DEFAULT ''",
    // 진도·교재관리 개편 — 교재 완료일(완료 시점). 월말리포트 '이번 달 완료 교재' 집계용.
    "ALTER TABLE class_progress ADD COLUMN end_date TEXT NOT NULL DEFAULT ''",
    // 마지막 수정 시각 — 수정한 교재를 목록 위로 올리는 정렬용.
    "ALTER TABLE class_progress ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
  ]) {
    try { await env.DB.prepare(a).run(); } catch { /* 이미 있으면 무시 */ }
  }
  // 강사 업무 보드(칸반) 카드.
  try {
    await env.DB
      .prepare(
        "CREATE TABLE IF NOT EXISTS class_tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo', tag TEXT NOT NULL DEFAULT '', due TEXT NOT NULL DEFAULT '', student_id TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, done_at INTEGER, archived INTEGER NOT NULL DEFAULT 0)"
      )
      .run();
  } catch {
    /* ignore */
  }
}

/** 학생별 '앱 소유 필드' 맵 (student_id → ["name","status",…]). 없으면 빈 맵. */
async function readStudentOverrides(env: Env): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {};
  try {
    const r = await env.DB.prepare("SELECT student_id, fields FROM class_student_overrides").all<{ student_id: string; fields: string }>();
    for (const row of r.results || []) {
      try {
        const f = JSON.parse(String(row.fields));
        if (Array.isArray(f) && f.length) map[String(row.student_id)] = f.map(String);
      } catch {
        /* ignore corrupt row */
      }
    }
  } catch {
    /* table 없으면 빈 맵 */
  }
  return map;
}

/** 사용자가 삭제 표시한 보강 att_key 집합. 테이블이 없으면 빈 집합. */
async function readDismissedMakeups(env: Env): Promise<Set<string>> {
  try {
    const r = await env.DB.prepare("SELECT att_key FROM class_makeup_dismissed").all<{ att_key: string }>();
    return new Set((r.results || []).map((x) => String(x.att_key)));
  } catch {
    return new Set();
  }
}

/** '오늘 숙제 없음' 표식 집합 (studentId|날짜). 테이블이 없으면 빈 집합. */
async function readNoHomework(env: Env): Promise<Set<string>> {
  try {
    const r = await env.DB.prepare("SELECT mark_key FROM class_homework_none").all<{ mark_key: string }>();
    return new Set((r.results || []).map((x) => String(x.mark_key)));
  } catch {
    return new Set();
  }
}

/* ---------------- read (roster ⨝ class_* extras) ---------------- */
async function readSnapshot(env: Env): Promise<DataSnapshot> {
  await ensureSchedulesTable(env);
  const [rosterRes, lRes, mRes, aRes, hRes, pRes] = await env.DB.batch([
    env.DB.prepare(
      "SELECT id,name,grade,status,school,birth_date,parent_phone,student_phone,start_date,excluded FROM students WHERE hidden IS NULL OR hidden = 0"
    ),
    env.DB.prepare("SELECT * FROM class_lessons ORDER BY student_id, sort_order"),
    env.DB.prepare("SELECT * FROM class_makeups"),
    env.DB.prepare("SELECT * FROM class_attendance"),
    env.DB.prepare("SELECT * FROM class_homework ORDER BY date DESC"),
    env.DB.prepare("SELECT * FROM class_progress ORDER BY date DESC"),
  ]);

  const lessonsByStudent: Record<string, { day: string; time: string; duration: number }[]> = {};
  for (const r of lRes.results as Record<string, unknown>[]) {
    const sid = String(r.student_id);
    (lessonsByStudent[sid] ||= []).push({
      day: String(r.day),
      time: String(r.time),
      duration: Number(r.duration),
    });
  }

  // 시간표 변경 이력(버전) — 별도 쿼리 + try/catch로 분리.
  // (테이블이 없거나 깨져도 나머지 스냅샷 읽기는 절대 실패하지 않게)
  const scheduleByStudent: Record<string, ScheduleVersion[]> = {};
  try {
    const schRes = await env.DB.prepare("SELECT student_id, versions FROM class_schedules").all();
    for (const r of schRes.results as Record<string, unknown>[]) {
      try {
        const v = JSON.parse(String(r.versions)) as ScheduleVersion[];
        if (Array.isArray(v) && v.length) scheduleByStudent[String(r.student_id)] = v;
      } catch {
        /* ignore corrupt rows */
      }
    }
  } catch {
    /* class_schedules 없으면 시간표 이력 없이 진행 */
  }

  const overridesByStudent = await readStudentOverrides(env);

  // 영어만 듣는 학생(class_student_meta.subjects에 'math' 없음)은 수학 앱 명단에서 제외.
  // meta가 없으면(레거시) 수학으로 간주해 그대로 표시(회귀 방지).
  const mathExcluded = new Set<string>();
  const mathStartMap: Record<string, string> = {};
  try {
    const mr = await env.DB.prepare("SELECT student_id, subjects, math_start FROM class_student_meta").all<{ student_id: string; subjects: string; math_start: string }>();
    for (const r of mr.results || []) {
      if (r.math_start) mathStartMap[String(r.student_id)] = String(r.math_start);
      try {
        const s = JSON.parse(String(r.subjects || "[]"));
        if (Array.isArray(s) && s.length > 0 && !s.includes("math")) mathExcluded.add(String(r.student_id));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* meta 없으면 전체 표시 */
  }

  const rosterIds = new Set<string>();
  const students: Student[] = (rosterRes.results as Record<string, unknown>[])
    .filter((r) => !mathExcluded.has(String(r.id)))
    .map((r) => {
    const id = String(r.id);
    rosterIds.add(id);
    return {
      id,
      name: String(r.name),
      // 실제 학년(초6·중2·고1 등) 그대로 — 수학 앱은 startsWith("초"/"중")로 초·중등을 구분하므로
      // 공통 학생명단과 학년이 어긋나지 않게 한다. (이전엔 초등/중등으로 뭉개 표시됐음)
      grade: String(r.grade ?? "") || "초등",
      startDate: String(r.start_date ?? ""),
      mathStart: mathStartMap[id] || "",
      excluded: Number(r.excluded) === 1,
      status: (r.status as Student["status"]) || "재원",
      school: String(r.school ?? ""),
      birthdate: String(r.birth_date ?? ""),
      parentPhone: String(r.parent_phone ?? ""),
      studentPhone: String(r.student_phone ?? ""),
      lessons: lessonsByStudent[id] || [],
      ...(scheduleByStudent[id] ? { schedule: scheduleByStudent[id] } : {}),
      ...(overridesByStudent[id] ? { appEdited: overridesByStudent[id] } : {}),
    };
  });

  // 사용자가 직접 삭제 표시한 보강(att_key) — 되살아나지 않게 읽기 단계에서도 제외.
  const dismissedSet = await readDismissedMakeups(env);
  const noHomeworkSet = await readNoHomework(env);

  // makeups/attendance: only for students still in the roster (drops orphans)
  const makeups: Makeup[] = (mRes.results as Record<string, unknown>[])
    .filter((r) => rosterIds.has(String(r.student_id)))
    .filter((r) => !dismissedSet.has(String(r.att_key)))
    .map((r) => ({
      id: String(r.id),
      studentId: String(r.student_id),
      absentDate: String(r.absent_date),
      absentTime: String(r.absent_time),
      absentDuration: Number(r.absent_duration),
      attKey: String(r.att_key),
      status: r.status as Makeup["status"],
      makeupDate: String(r.makeup_date),
      makeupTime: String(r.makeup_time),
      makeupDuration: Number(r.makeup_duration),
      parentContacted: Number(r.parent_contacted) === 1,
      memo: String(r.memo),
      createdAt: Number(r.created_at),
    }));

  const attendance: DataSnapshot["attendance"] = {};
  for (const r of aRes.results as Record<string, unknown>[]) {
    const key = String(r.att_key);
    const sid = key.split("|")[1];
    if (!rosterIds.has(sid)) continue;
    let status = String(r.status);
    if (status === "present") status = "출석"; // legacy
    else if (status === "absent") status = "결석"; // legacy
    attendance[key] = {
      status: status as AttRecord["status"],
      lateMinutes: r.late_minutes == null ? undefined : Number(r.late_minutes),
      attitude: (r.attitude as AttRecord["attitude"]) || "",
      note: String(r.note ?? ""),
      pointsAwarded: Number(r.points_awarded) === 1,
    };
  }

  // 보강 출결 그림자 중복 정리: 같은 (날짜·학생)에 보강이 2개 이상이고
  // 한쪽은 메모(note)가 있는데 다른 쪽은 비어 있으면, 비어 있는 쪽을 버린다.
  // (앱의 '보강 완료'가 makeupTime 키로 새 행을 만들어 기존 보강 행과 겹치던 문제)
  const boBySD: Record<string, string[]> = {};
  for (const key of Object.keys(attendance)) {
    if (attendance[key].status !== "보강") continue;
    const p = key.split("|");
    (boBySD[p[0] + "|" + p[1]] ||= []).push(key);
  }
  for (const grp of Object.values(boBySD)) {
    if (grp.length < 2) continue;
    const hasNoted = grp.some((k) => (attendance[k].note || "").trim());
    if (!hasNoted) continue;
    for (const k of grp) if (!(attendance[k].note || "").trim()) delete attendance[k];
  }

  const homeworkLog = (hRes.results as Record<string, unknown>[])
    .filter((r) => rosterIds.has(String(r.student_id)))
    .map((r) => ({
      id: String(r.id),
      studentId: String(r.student_id),
      date: String(r.date),
      book: String(r.book ?? ""),
      tags: String(r.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      completion: Number(r.completion),
      status: r.status === "late" ? ("late" as const) : r.status === "pending" ? ("pending" as const) : ("done" as const),
      memo: String(r.memo ?? ""),
      recheckDate: String(r.recheck_date ?? "") || undefined,
      delayCount: Number(r.delay_count ?? 0) || undefined,
      carriedFrom: String(r.carried_from ?? "") || undefined,
    }));

  const progressLog = (pRes.results as Record<string, unknown>[])
    .filter((r) => rosterIds.has(String(r.student_id)))
    .map((r) => ({
      id: String(r.id),
      studentId: String(r.student_id),
      unit: String(r.unit ?? ""),
      area: String(r.area ?? ""),
      pct: Number(r.pct),
      startDate: String(r.start_date ?? ""),
      endDate: String(r.end_date ?? ""),
      memo: String(r.memo ?? ""),
      updatedAt: Number(r.updated_at ?? 0),
    }));

  // 테스트 기록 — 별도 쿼리 + try/catch(테이블 없어도 나머지 읽기 안 깨지게)
  const testLog: TestLog[] = [];
  try {
    const tRes = await env.DB.prepare("SELECT * FROM class_tests ORDER BY date DESC").all();
    for (const r of tRes.results as Record<string, unknown>[]) {
      if (!rosterIds.has(String(r.student_id))) continue;
      testLog.push({
        id: String(r.id),
        studentId: String(r.student_id),
        date: String(r.date ?? ""),
        type: String(r.type ?? ""),
        round: String(r.round ?? ""),
        range: String(r.range_ ?? ""),
        score: Number(r.score ?? 0),
        status: r.status === "완료" ? "완료" : "예정",
        memo: String(r.memo ?? ""),
      });
    }
  } catch {
    /* class_tests 없으면 빈 배열 */
  }

  // 보충수업(남은 분·사유) — 별도 쿼리 + try/catch(테이블 없어도 안전).
  const supplements: { id: string; studentId: string; date: string; minutes: number; reason: string }[] = [];
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS class_supplement (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, date TEXT NOT NULL DEFAULT '', minutes INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0)").run();
    const sRes = await env.DB.prepare("SELECT * FROM class_supplement ORDER BY date DESC").all();
    for (const r of sRes.results as Record<string, unknown>[]) {
      if (!rosterIds.has(String(r.student_id))) continue;
      supplements.push({ id: String(r.id), studentId: String(r.student_id), date: String(r.date ?? ""), minutes: Number(r.minutes ?? 0), reason: String(r.reason ?? "") });
    }
  } catch {
    /* class_supplement 없으면 빈 배열 */
  }

  // 강사 업무 보드 카드 — 별도 쿼리 + try/catch
  const tasks: Task[] = [];
  try {
    const kRes = await env.DB.prepare("SELECT * FROM class_tasks").all();
    for (const r of kRes.results as Record<string, unknown>[]) {
      tasks.push({
        id: String(r.id),
        title: String(r.title ?? ""),
        status: r.status === "doing" ? "doing" : r.status === "done" ? "done" : "todo",
        tag: String(r.tag ?? "") || undefined,
        due: String(r.due ?? "") || undefined,
        studentId: String(r.student_id ?? "") || undefined,
        memo: String(r.memo ?? "") || undefined,
        source: String(r.source ?? "") || undefined,
        createdAt: Number(r.created_at ?? 0),
        doneAt: r.done_at == null ? undefined : Number(r.done_at),
        archived: Number(r.archived ?? 0) === 1,
      });
    }
  } catch {
    /* class_tasks 없으면 빈 배열 */
  }

  return { students, makeups, attendance, homeworkLog, progressLog, testLog, supplements, tasks, dismissedMakeups: [...dismissedSet], noHomework: [...noHomeworkSet] };
}

/* ---------------- write (class_* only; roster never bulk-touched) ---------------- */
async function putData(env: Env, request: Request): Promise<Response> {
  const snap = (await request.json()) as DataSnapshot;
  await ensureSchedulesTable(env); // 테이블 없어도 저장이 통째로 실패하지 않게
  // 업무보드 hub 전용 컬럼(담당자·우선순위·원장전용)은 수학 스냅샷에 없다.
  // 스냅샷 저장 때 통째로 덮어쓰면 사라지므로, 기존 값을 미리 읽어 보존한다.
  const prevTaskHub = new Map<string, { assignee: string; priority: string; adminOnly: number; assignDate: string }>();
  try {
    const cur = await env.DB.prepare("SELECT id, assignee, priority, admin_only, assign_date FROM class_tasks").all<{ id: string; assignee: string; priority: string; admin_only: number; assign_date: string }>();
    for (const r of cur.results || []) prevTaskHub.set(String(r.id), { assignee: String(r.assignee || ""), priority: String(r.priority || "normal"), adminOnly: Number(r.admin_only || 0), assignDate: String(r.assign_date || "") });
  } catch {
    /* 컬럼/테이블 없으면 보존할 것도 없음 */
  }
  // 병합 저장(여러 강사 동시 사용 안전): 기록류(출결·보강·숙제·진도·테스트·업무카드)는
  // 전체 삭제하지 않고 upsert + 명시적 삭제목록(snap.deletions)만 지운다. 다른 강사가
  // 추가한 기록을 stale 스냅샷이 덮어쓰지 못하게 한다.
  // 시간표(lessons)·시간표이력(schedules)은 학생별 재구성이라 그대로 전체 교체.
  // class_student_overrides 는 전체 삭제하지 않는다(허브 '앱 소유' 표시 보존).
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM class_lessons"),
    env.DB.prepare("DELETE FROM class_schedules"),
  ];

  // 강사 업무 보드 카드 — hub 전용 컬럼은 기존 값 보존(수학 스냅샷엔 없음).
  for (const k of snap.tasks || []) {
    const hub = prevTaskHub.get(k.id);
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_tasks(id,title,status,tag,due,student_id,memo,assignee,priority,admin_only,assign_date,source,created_at,done_at,archived) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,status=excluded.status,tag=excluded.tag,due=excluded.due,student_id=excluded.student_id,memo=excluded.memo,assignee=excluded.assignee,priority=excluded.priority,admin_only=excluded.admin_only,assign_date=excluded.assign_date,source=excluded.source,done_at=excluded.done_at,archived=excluded.archived"
        )
        .bind(
          k.id,
          k.title || "",
          k.status || "todo",
          k.tag || "",
          k.due || "",
          k.studentId || "",
          k.memo || "",
          hub?.assignee || "",
          hub?.priority || "normal",
          hub?.adminOnly || 0,
          hub?.assignDate || "",
          k.source || "",
          k.createdAt || Date.now(),
          k.doneAt == null ? null : k.doneAt,
          k.archived ? 1 : 0
        )
    );
  }

  // 삭제 표시(tombstone) — 중복 제거 후 다시 기록.
  for (const key of [...new Set(snap.dismissedMakeups || [])]) {
    if (!key) continue;
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO class_makeup_dismissed(att_key) VALUES(?)").bind(key));
  }
  // '오늘 숙제 없음' 표식 — 숙제 기록 없이 정리완료만 기억.
  for (const key of [...new Set(snap.noHomework || [])]) {
    if (!key) continue;
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO class_homework_none(mark_key) VALUES(?)").bind(key));
  }

  for (const t of snap.testLog || []) {
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_tests(id,student_id,date,type,round,range_,score,status,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id,date=excluded.date,type=excluded.type,round=excluded.round,range_=excluded.range_,score=excluded.score,status=excluded.status,memo=excluded.memo"
        )
        .bind(
          t.id,
          t.studentId,
          t.date || "",
          t.type || "",
          t.round || "",
          t.range || "",
          t.score || 0,
          t.status || "예정",
          t.memo || "",
          Date.now()
        )
    );
  }

  // 보충수업(남은 분·사유) — 테이블 보장 후 upsert.
  stmts.push(env.DB.prepare("CREATE TABLE IF NOT EXISTS class_supplement (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, date TEXT NOT NULL DEFAULT '', minutes INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0)"));
  for (const sp of snap.supplements || []) {
    stmts.push(
      env.DB
        .prepare("INSERT INTO class_supplement(id,student_id,date,minutes,reason,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id,date=excluded.date,minutes=excluded.minutes,reason=excluded.reason")
        .bind(sp.id, sp.studentId, sp.date || "", sp.minutes || 0, sp.reason || "", Date.now())
    );
  }

  for (const h of snap.homeworkLog || []) {
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_homework(id,student_id,date,book,tags,completion,status,memo,recheck_date,delay_count,carried_from,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id,date=excluded.date,book=excluded.book,tags=excluded.tags,completion=excluded.completion,status=excluded.status,memo=excluded.memo,recheck_date=excluded.recheck_date,delay_count=excluded.delay_count,carried_from=excluded.carried_from"
        )
        .bind(h.id, h.studentId, h.date, h.book || "", (h.tags || []).join(","), h.completion || 0, h.status || "done", h.memo || "", h.recheckDate || "", h.delayCount || 0, h.carriedFrom || "", Date.now())
    );
  }
  for (const pr of snap.progressLog || []) {
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_progress(id,student_id,date,unit,area,pct,start_date,end_date,memo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id,date=excluded.date,unit=excluded.unit,area=excluded.area,pct=excluded.pct,start_date=excluded.start_date,end_date=excluded.end_date,memo=excluded.memo,updated_at=excluded.updated_at"
        )
        .bind(pr.id, pr.studentId, pr.startDate || "", pr.unit || "", pr.area || "", pr.pct || 0, pr.startDate || "", pr.endDate || "", pr.memo || "", Date.now(), Number(pr.updatedAt) || Date.now())
    );
  }

  for (const s of snap.students) {
    (s.lessons || []).forEach((l, i) => {
      stmts.push(
        env.DB
          .prepare("INSERT INTO class_lessons(id,student_id,day,time,duration,sort_order) VALUES(?,?,?,?,?,?)")
          .bind(`${s.id}-${i}`, s.id, l.day, l.time, l.duration, i)
      );
    });
    // 시간표 변경 이력(버전)을 JSON으로 보관 — 단일 버전뿐이면 굳이 저장하지 않음
    if (s.schedule && s.schedule.length > 1) {
      stmts.push(
        env.DB
          .prepare("INSERT INTO class_schedules(student_id,versions) VALUES(?,?)")
          .bind(s.id, JSON.stringify(s.schedule))
      );
    }
    // 앱에서 인라인 수정한 '앱 소유' 필드 목록 — 노션 동기화가 덮어쓰지 않게 보관.
    // 전체 삭제 대신 병합(upsert)해 기존 표시를 보존한다.
    if (s.appEdited && s.appEdited.length) {
      stmts.push(
        env.DB
          .prepare("INSERT INTO class_student_overrides(student_id,fields) VALUES(?,?) ON CONFLICT(student_id) DO UPDATE SET fields=excluded.fields")
          .bind(s.id, JSON.stringify([...new Set(s.appEdited)]))
      );
    }
  }

  for (const k of snap.makeups) {
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_makeups(id,student_id,absent_date,absent_time,absent_duration,att_key,status,makeup_date,makeup_time,makeup_duration,parent_contacted,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id,absent_date=excluded.absent_date,absent_time=excluded.absent_time,absent_duration=excluded.absent_duration,att_key=excluded.att_key,status=excluded.status,makeup_date=excluded.makeup_date,makeup_time=excluded.makeup_time,makeup_duration=excluded.makeup_duration,parent_contacted=excluded.parent_contacted,memo=excluded.memo"
        )
        .bind(
          k.id,
          k.studentId,
          k.absentDate,
          k.absentTime,
          k.absentDuration,
          k.attKey,
          k.status,
          k.makeupDate,
          k.makeupTime,
          k.makeupDuration,
          k.parentContacted ? 1 : 0,
          k.memo,
          k.createdAt
        )
    );
  }

  for (const key of Object.keys(snap.attendance)) {
    const a = snap.attendance[key];
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO class_attendance(att_key,status,late_minutes,attitude,note,points_awarded) VALUES(?,?,?,?,?,?) ON CONFLICT(att_key) DO UPDATE SET status=excluded.status,late_minutes=excluded.late_minutes,attitude=excluded.attitude,note=excluded.note,points_awarded=excluded.points_awarded"
        )
        .bind(key, a.status, a.lateMinutes == null ? null : a.lateMinutes, a.attitude || "", a.note || "", a.pointsAwarded ? 1 : 0)
    );
  }

  // 명시적 삭제(병합 저장) — 이 세션에서 삭제한 레코드만 지운다.
  const del = snap.deletions || {};
  const delIn = (table: string, col: string, ids?: string[]) => {
    for (const id of [...new Set(ids || [])]) {
      if (id) stmts.push(env.DB.prepare(`DELETE FROM ${table} WHERE ${col}=?`).bind(id));
    }
  };
  delIn("class_homework", "id", del.homework);
  delIn("class_progress", "id", del.progress);
  delIn("class_tests", "id", del.test);
  delIn("class_supplement", "id", del.supplement);
  delIn("class_makeups", "id", del.makeup);
  delIn("class_tasks", "id", del.task);
  delIn("class_attendance", "att_key", del.attendance);
  delIn("class_makeup_dismissed", "att_key", del.dismissed);
  delIn("class_homework_none", "mark_key", del.noHomework);

  // 50개씩 나눠 실행 — 한 번에 너무 많으면(대규모 로스터) D1 batch 한도로 저장이 통째로 실패할 수 있음.
  await runChunked(env, stmts);

  // Persist academic fields to the shared roster — UPDATE only (never DELETE,
  // never touch points/photo_url/notion_page_id). Per-row + try/catch so a
  // UNIQUE-name conflict can't break the class_* persistence above.
  // 로스터 핵심 필드는 '앱 소유(appEdited)'로 표시된 것만 덮어쓴다. 표시되지 않은 필드는
  // DB 값을 그대로 둬, 다른 화면(학생 명단)·다른 탭의 stale 스냅샷이 학년을 되돌리지 못하게 한다.
  // (excluded는 수학 앱 전용 플래그라 항상 반영)
  for (const s of snap.students) {
    if (!/^\d+$/.test(s.id)) continue;
    const ae = new Set(s.appEdited || []);
    const sets: string[] = ["excluded=?"];
    const binds: (string | number)[] = [s.excluded ? 1 : 0];
    const add = (key: string, col: string, val: string) => { if (ae.has(key)) { sets.push(col + "=?"); binds.push(val); } };
    add("name", "name", s.name);
    add("grade", "grade", s.grade);
    add("status", "status", s.status || "재원");
    add("school", "school", s.school || "");
    add("birthdate", "birth_date", s.birthdate || "");
    add("parentPhone", "parent_phone", s.parentPhone || "");
    add("studentPhone", "student_phone", s.studentPhone || "");
    add("startDate", "start_date", s.startDate || "");
    binds.push(Number(s.id));
    try {
      await env.DB.prepare(`UPDATE students SET ${sets.join(",")} WHERE id=?`).bind(...binds).run();
    } catch {
      /* ignore unique-name conflicts */
    }
  }

  return json({ ok: true });
}

/* ---------------- create / link a roster student ---------------- */
async function postStudents(env: Env, request: Request): Promise<Response> {
  const b = (await request.json()) as Partial<Student> & { name?: string };
  const name = (b.name || "").trim();
  if (!name) return json({ error: "name_required" }, 400);

  // link to an existing roster student with the same name, else insert. Then
  // set academic columns. Never touches points/photo_url/notion_page_id.
  const existing = await env.DB.prepare("SELECT id FROM students WHERE name = ?").bind(name).first<{ id: number }>();
  let id: number;
  if (existing) {
    id = existing.id;
    await env.DB
      .prepare(
        "UPDATE students SET grade=?,status=?,school=?,birth_date=?,parent_phone=?,student_phone=?,start_date=?,excluded=? WHERE id=?"
      )
      .bind(b.grade || "초등", b.status || "재원", b.school || "", b.birthdate || "", b.parentPhone || "", b.studentPhone || "", b.startDate || "", b.excluded ? 1 : 0, id)
      .run();
  } else {
    const ins = await env.DB
      .prepare(
        "INSERT INTO students(name,grade,status,school,birth_date,parent_phone,student_phone,start_date,excluded) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id"
      )
      .bind(name, b.grade || "초등", b.status || "재원", b.school || "", b.birthdate || "", b.parentPhone || "", b.studentPhone || "", b.startDate || "", b.excluded ? 1 : 0)
      .first<{ id: number }>();
    id = ins!.id;
  }

  return json({ id: String(id) });
}

/* ---------------- points (출석 적립/회수, by roster id) ---------------- */
// Logs a point_history row AND keeps the denormalized students.points total in
// sync (mogakgong invariant: students.points == SUM(point_history.delta)).
async function postPoints(env: Env, request: Request, ctx: ExecutionContext): Promise<Response> {
  const body = (await request.json()) as { studentId?: string; delta?: number; reason?: string };
  const sid = Number(body.studentId);
  const delta = Number(body.delta) || 0;
  const reason = (body.reason || "출석").slice(0, 40);
  if (!sid || !delta) return json({ matched: false });

  // 학생 이름 + 수학 수강 여부(checkin.ts와 동일 판정) — 키오스크 미러링 필터용.
  const row = await env.DB
    .prepare(
      "SELECT s.name name, m.subjects subjects, m.english_band band, " +
        "(SELECT COUNT(*) FROM class_lessons WHERE student_id=CAST(s.id AS TEXT)) math_n, " +
        "(SELECT COUNT(*) FROM class_eng_lessons WHERE student_id=CAST(s.id AS TEXT)) eng_n " +
        "FROM students s LEFT JOIN class_student_meta m ON m.student_id = CAST(s.id AS TEXT) " +
        "WHERE s.id = ?"
    )
    .bind(sid)
    .first<{ name: string; subjects: string; band: string; math_n: number; eng_n: number }>();
  if (!row) return json({ matched: false });

  await env.DB.batch([
    env.DB.prepare("INSERT INTO point_history(student_id,delta,reason,category) VALUES(?,?,?,'learn')").bind(sid, delta, reason),
    env.DB.prepare("UPDATE students SET points = points + ? WHERE id = ?").bind(delta, sid),
  ]);

  // 수학 학생이면 같은 금액(+/-)을 학습키오스크로 미러링(베스트에포트, 응답 차단 안 함).
  if (env.KIOSK_URL && env.KIOSK_POINTS_KEY) {
    const metaSubj = String(row.subjects ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const hasMath = metaSubj.includes("math") || Number(row.math_n) > 0;
    const hasEng = metaSubj.includes("english") || !!String(row.band ?? "") || Number(row.eng_n) > 0;
    // 과목 정보가 전혀 없으면 일단 시도 — 키오스크 로스터(수학 학생) 이름 매칭이 최종 필터.
    const isMath = hasMath || (!hasMath && !hasEng);
    if (isMath) ctx.waitUntil(enqueueKioskPoint(env, String(row.name ?? ""), delta, reason));
  }

  return json({ matched: true });
}

// 포인트 랭킹 '적립완료(시상)' — 학생의 현재 누적 꿀(영어 일일 + math 포인트이력) 합계만큼
// 음수 보정행을 point_history에 넣어 랭킹 합을 0으로 만든다. 이후 점수는 다시 0부터 쌓인다.
// (행 삭제 한 줄이면 되돌릴 수 있어 안전. 키오스크 연동은 v1에선 건드리지 않음.)
async function redeemRanking(env: Env, request: Request): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as { studentId?: string };
  const sid = Number(b.studentId);
  if (!sid) return json({ error: "bad_input" }, 400);
  const row = await env.DB
    .prepare(
      "SELECT (SELECT COALESCE(SUM(points),0) FROM class_eng_daily WHERE CAST(student_id AS INTEGER)=?) " +
        "+ (SELECT COALESCE(SUM(delta),0) FROM point_history WHERE student_id=? AND category='learn') AS total"
    )
    .bind(sid, sid)
    .first<{ total: number }>();
  const total = Math.round(Number(row?.total) || 0);
  if (total !== 0) {
    await env.DB
      .prepare("INSERT INTO point_history(student_id,delta,reason,category) VALUES(?,?,?,'learn')")
      .bind(sid, -total, "적립완료(시상)")
      .run();
  }
  return json({ ok: true, reset: total });
}

// ── 학습키오스크 포인트 미러링(아웃박스 + 크론 재전송으로 유실 방지) ──────────────
// 키오스크가 일시적으로 꺼져 있어도, 미전송 건을 크론이 다시 보낸다. 키오스크 측은
// eventId(아웃박스 id)로 멱등 처리하므로 재전송돼도 중복 적립되지 않는다.

async function ensureKioskOutbox(env: Env): Promise<void> {
  await env.DB
    .prepare(
      "CREATE TABLE IF NOT EXISTS class_kiosk_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT, sent INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0)"
    )
    .run();
}

// 적립/감점 1건을 아웃박스에 적재하고 즉시 전송 시도(실패해도 크론이 재전송).
async function enqueueKioskPoint(env: Env, name: string, delta: number, reason: string): Promise<void> {
  if (!name || !delta || !env.KIOSK_URL || !env.KIOSK_POINTS_KEY) return;
  await ensureKioskOutbox(env);
  const res = await env.DB
    .prepare("INSERT INTO class_kiosk_outbox(name,delta,reason,sent,attempts,created_at) VALUES(?,?,?,0,0,?)")
    .bind(name, delta, reason, Date.now())
    .run();
  const id = Number(res.meta?.last_row_id || 0);
  if (id) await sendKioskOutboxRow(env, { id, name, delta, reason });
}

// 단건 전송. 성공 시 sent=1, 실패 시 attempts++만(크론이 재전송).
async function sendKioskOutboxRow(env: Env, row: { id: number; name: string; delta: number; reason: string }): Promise<void> {
  if (!env.KIOSK_URL || !env.KIOSK_POINTS_KEY) return;
  let ok = false;
  try {
    const r = await fetch(env.KIOSK_URL.replace(/\/$/, "") + "/api/points/external", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Key": env.KIOSK_POINTS_KEY },
      body: JSON.stringify({ eventId: String(row.id), name: row.name, delta: row.delta, reason: row.reason }),
    });
    ok = r.ok;
  } catch (_) {
    ok = false;
  }
  try {
    await env.DB
      .prepare("UPDATE class_kiosk_outbox SET sent=?, attempts=attempts+1 WHERE id=?")
      .bind(ok ? 1 : 0, row.id)
      .run();
  } catch (_) {}
}

// 크론에서 호출: 미전송 건 재전송(최근 7일, 20회 미만 시도).
export async function flushKioskOutbox(env: Env): Promise<void> {
  if (!env.KIOSK_URL || !env.KIOSK_POINTS_KEY) return;
  await ensureKioskOutbox(env);
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  const rows = await env.DB
    .prepare("SELECT id,name,delta,reason FROM class_kiosk_outbox WHERE sent=0 AND attempts<20 AND created_at>=? ORDER BY id LIMIT 200")
    .bind(cutoff)
    .all<{ id: number; name: string; delta: number; reason: string }>();
  for (const row of rows.results || []) {
    await sendKioskOutboxRow(env, { id: Number(row.id), name: String(row.name), delta: Number(row.delta), reason: String(row.reason ?? "") });
  }
}

/* ---------------- monthly report aggregation ---------------- */
// GET /api/report?student_id=XXX&year=2026&month=5&comment=...
async function getReport(env: Env, url: URL): Promise<Response> {
  const studentId = url.searchParams.get("student_id") || "";
  const year = Number(url.searchParams.get("year")) || 0;
  const month = Number(url.searchParams.get("month")) || 0;
  const comment = url.searchParams.get("comment") || "";
  const pad = (n: number) => (n < 10 ? "0" + n : "" + n);

  const nameRow = await env.DB.prepare("SELECT name FROM students WHERE id = ?")
    .bind(Number(studentId) || -1)
    .first<{ name: string }>();

  const like = `${year}-${pad(month)}-%|${studentId}|%`;
  const rows = await env.DB.prepare(
    "SELECT status, COUNT(*) AS n FROM class_attendance WHERE att_key LIKE ? GROUP BY status"
  )
    .bind(like)
    .all<{ status: string; n: number }>();

  let total = 0;
  let present = 0;
  let late = 0;
  let absent = 0;
  let makeup = 0;
  for (const r of rows.results || []) {
    const n = Number(r.n);
    total += n;
    if (r.status === "출석") present += n;
    else if (r.status === "지각") late += n;
    else if (r.status === "결석" || r.status === "무단결석") absent += n;
    else if (r.status === "보강") makeup += n;
  }
  const rate = total ? Math.round(((present + late) / total) * 100) : 0;

  return json({
    studentName: nameRow ? nameRow.name : "",
    year,
    month,
    attendance: { total, present, late, absent, makeup, rate },
    homework: { rate: 0 },
    comment,
  });
}

/* ---------------- Notion: 학원 일정 (읽기 전용 표시) ---------------- */
// GET /api/schedule?since=YYYY-MM-DD  (기본: 31일 전부터)
async function getSchedule(env: Env, url: URL): Promise<Response> {
  let since = url.searchParams.get("since") || "";
  if (!since) {
    const d = new Date(Date.now() - 31 * 86400000);
    since = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  try {
    const items = await fetchScheduleItems(env, since);
    return json({ items });
  } catch (e) {
    return json({ items: [], error: String(e) }, 200);
  }
}

/* ---------------- Notion: 학생 동기화 (노션 → D1) ---------------- */
async function syncStudents(env: Env): Promise<Response> {
  let list;
  try {
    list = await fetchNotionStudents(env);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  const COLS =
    "id,name,status,school,birth_date,parent_phone,student_phone,start_date,notion_page_id";
  // 앱에서 인라인 수정한 '앱 소유' 필드는 노션 값으로 덮어쓰지 않는다.
  const overrides = await readStudentOverrides(env);
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const s of list) {
    try {
      // 중복 판단은 이름이 아니라 노션 페이지 고유 ID로만 한다(동명이인 대비).
      let ex = await env.DB.prepare(`SELECT ${COLS} FROM students WHERE notion_page_id = ? LIMIT 1`)
        .bind(s.notionPageId)
        .first<Record<string, unknown>>();
      // 아직 노션과 연결 안 된 동명 학생이 있으면 1회 연결(앱에서 먼저 만든 경우).
      // 이미 연결된(다른 id를 가진) 동명이인은 건드리지 않고 새로 추가된다.
      if (!ex) {
        ex = await env.DB
          .prepare(`SELECT ${COLS} FROM students WHERE name = ? AND (notion_page_id IS NULL OR notion_page_id = '') LIMIT 1`)
          .bind(s.name)
          .first<Record<string, unknown>>();
      }
      if (ex) {
        // start_date(등록일)는 앱에서 수정한 값을 보존 — 노션 첫수업일이 덮어쓰지
        // 않도록 비어있을 때만 채운다. 나머지 필드는 노션이 마스터.
        const curStart = String(ex.start_date ?? "");
        const newStart = curStart !== "" ? curStart : s.start;
        // 앱 소유 필드는 기존(앱) 값을 유지, 그 외는 노션 값으로.
        const owned = overrides[String(ex.id)] || [];
        const vName = owned.includes("name") ? String(ex.name ?? "") : s.name;
        const vStatus = owned.includes("status") ? String(ex.status ?? "") : s.status;
        const vSchool = owned.includes("school") ? String(ex.school ?? "") : s.school;
        // 허브 프로필에서 수정한(앱 소유) 생년월일·연락처도 노션이 덮어쓰지 않게 보존.
        const vBirth = owned.includes("birthdate") ? String(ex.birth_date ?? "") : s.birth;
        const vPPhone = owned.includes("parentPhone") ? String(ex.parent_phone ?? "") : s.parentPhone;
        const vSPhone = owned.includes("studentPhone") ? String(ex.student_phone ?? "") : s.studentPhone;
        const same =
          String(ex.name ?? "") === vName &&
          String(ex.status ?? "") === vStatus &&
          String(ex.school ?? "") === vSchool &&
          String(ex.birth_date ?? "") === vBirth &&
          String(ex.parent_phone ?? "") === vPPhone &&
          String(ex.student_phone ?? "") === vSPhone &&
          curStart === newStart &&
          String(ex.notion_page_id ?? "") === s.notionPageId;
        if (same) {
          unchanged++; // 똑같으면 건너뜀
        } else {
          await env.DB
            .prepare(
              "UPDATE students SET name=?,status=?,school=?,birth_date=?,parent_phone=?,student_phone=?,start_date=?,notion_page_id=? WHERE id=?"
            )
            .bind(vName, vStatus, vSchool, vBirth, vPPhone, vSPhone, newStart, s.notionPageId, Number(ex.id))
            .run();
          updated++;
        }
      } else {
        await env.DB
          .prepare(
            "INSERT INTO students(name,status,school,birth_date,parent_phone,student_phone,start_date,notion_page_id) VALUES(?,?,?,?,?,?,?,?)"
          )
          .bind(s.name, s.status, s.school, s.birth, s.parentPhone, s.studentPhone, s.start, s.notionPageId)
          .run();
        added++;
      }
    } catch (e) {
      console.log("sync upsert failed", s.name, String(e));
    }
  }
  return json({ added, updated, unchanged, total: list.length });
}

/* ---------------- Notion: 기록 저장 (앱 → 노션, best-effort) ---------------- */
// 학생의 노션 페이지 id + 학년(수업 선택 결정용) 조회.
async function studentNotionMeta(
  env: Env,
  studentId: string
): Promise<{ pageId?: string; grade: string; name: string }> {
  const r = await env.DB.prepare("SELECT name, notion_page_id, grade FROM students WHERE id = ?")
    .bind(Number(studentId) || -1)
    .first<{ name: string | null; notion_page_id: string | null; grade: string | null }>();
  return { pageId: r?.notion_page_id || undefined, grade: r?.grade || "", name: r?.name || "" };
}

async function notionAttendance(env: Env, request: Request): Promise<Response> {
  const b = (await request.json()) as {
    studentId?: string;
    date?: string;
    status?: string;
    attitude?: string;
    lateMinutes?: number;
    note?: string;
  };
  const meta = await studentNotionMeta(env, b.studentId || "");
  const classPageId = classPageIdForGrade(await fetchClassPageMap(env), meta.grade);
  const ok = await upsertAttendanceRecord(env, {
    notionPageId: meta.pageId,
    classPageId,
    date: b.date || "",
    status: b.status || "",
    attitude: b.attitude || "",
    lateMinutes: b.lateMinutes || 0,
    note: b.note || "",
  });
  return json({ ok });
}

async function notionHomework(env: Env, request: Request): Promise<Response> {
  const b = (await request.json()) as {
    studentId?: string;
    date?: string;
    book?: string;
    tags?: string[];
    completion?: number;
    done?: boolean;
    memo?: string;
    checkOnly?: boolean;
    delayCount?: number;
  };
  const meta = await studentNotionMeta(env, b.studentId || "");
  const classPageId = classPageIdForGrade(await fetchClassPageMap(env), meta.grade);
  const ok = await upsertHomeworkRecord(env, {
    notionPageId: meta.pageId,
    classPageId,
    date: b.date || "",
    book: b.book || "",
    tags: b.tags || [],
    completion: b.completion || 0,
    done: !!b.done,
    memo: b.memo || "",
    checkOnly: !!b.checkOnly,
    delayCount: b.delayCount || 0,
  });
  return json({ ok });
}

async function notionProgress(env: Env, request: Request): Promise<Response> {
  const b = (await request.json()) as {
    studentId?: string;
    unit?: string;
    area?: string;
    pct?: number;
    startDate?: string;
    memo?: string;
  };
  const meta = await studentNotionMeta(env, b.studentId || "");
  const classPageId = classPageIdForGrade(await fetchClassPageMap(env), meta.grade);
  const ok = await upsertProgressRecord(env, {
    notionPageId: meta.pageId,
    classPageId,
    unit: b.unit || "",
    area: b.area || "",
    pct: b.pct || 0,
    startDate: b.startDate || "",
    memo: b.memo || "",
  });
  return json({ ok });
}

async function notionTest(env: Env, request: Request): Promise<Response> {
  const b = (await request.json()) as {
    studentId?: string;
    date?: string;
    type?: string;
    round?: string;
    range?: string;
    score?: number;
    status?: string;
    memo?: string;
  };
  const meta = await studentNotionMeta(env, b.studentId || "");
  const classPageId = classPageIdForGrade(await fetchClassPageMap(env), meta.grade);
  const ok = await upsertTestRecord(env, {
    notionPageId: meta.pageId,
    classPageId,
    date: b.date || "",
    type: b.type || "",
    round: b.round || "",
    range: b.range || "",
    score: b.score || 0,
    status: b.status || "예정",
    memo: b.memo || "",
  });
  return json({ ok });
}

/* ---------------- Notion → 앱 기록 가져오기 (3월부터; 타입별, 서버 필터) ----------------
   ?type=homework|progress|attendance (분할 호출로 워커 시간/서브요청 한도 회피). */
async function buildIdByPage(env: Env): Promise<Record<string, string>> {
  const rows = await env.DB.prepare(
    "SELECT id, notion_page_id FROM students WHERE notion_page_id IS NOT NULL AND notion_page_id <> ''"
  ).all<{ id: number; notion_page_id: string }>();
  const map: Record<string, string> = {};
  for (const r of rows.results || []) map[r.notion_page_id] = String(r.id);
  return map;
}

/** 학생별 (최신) 수업 슬롯 — 기간 결석을 수업일별로 펼칠 때 사용. */
async function buildLessonsBySid(
  env: Env
): Promise<Record<string, { day: string; time: string; duration: number }[]>> {
  const rows = await env.DB.prepare(
    "SELECT student_id, day, time, duration FROM class_lessons ORDER BY student_id, sort_order"
  ).all<{ student_id: string; day: string; time: string; duration: number }>();
  const map: Record<string, { day: string; time: string; duration: number }[]> = {};
  for (const r of rows.results || [])
    (map[String(r.student_id)] ||= []).push({ day: String(r.day), time: String(r.time), duration: Number(r.duration) });
  return map;
}

const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"];
/** start~end(포함) 사이의 모든 날짜(YYYY-MM-DD). UTC 기준으로 tz 영향 제거. 최대 366일. */
function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  let t = Date.UTC(sy, sm - 1, sd);
  const te = Date.UTC(ey, em - 1, ed);
  let guard = 0;
  while (t <= te && guard++ < 366) {
    const d = new Date(t);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${d.getUTCFullYear()}-${mm}-${dd}`);
    t += 86400000;
  }
  return out;
}
/** 'YYYY-MM-DD' → 요일('월'..'일'). */
function dowOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return DOW_KR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
async function runChunked(env: Env, stmts: D1PreparedStatement[]) {
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

async function importRecords(env: Env, url: URL): Promise<Response> {
  const since = url.searchParams.get("since") || NOTION_CFG.importSince;
  const type = url.searchParams.get("type") || "all";
  const res = { homework: 0, progress: 0, attendance: 0, test: 0 };
  try {
    await ensureSchedulesTable(env); // class_tests 보장
    const idByPage = await buildIdByPage(env);
    const dismissedSet = await readDismissedMakeups(env);
    if (type === "homework" || type === "all") {
      const stmts: D1PreparedStatement[] = [];
      for (const r of await fetchHomeworkRecords(env, since)) {
        const sid = idByPage[r.studentPageId];
        if (!sid) continue;
        stmts.push(
          env.DB
            .prepare(
              "INSERT OR REPLACE INTO class_homework(id,student_id,date,book,tags,completion,status,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?)"
            )
            .bind("nh_" + r.srcId, sid, r.date, r.book, r.tags.join(","), r.completion, r.done ? "done" : "pending", r.memo, Date.now())
        );
        res.homework++;
      }
      await runChunked(env, stmts);
    }
    if (type === "progress" || type === "all") {
      const stmts: D1PreparedStatement[] = [];
      for (const r of await fetchProgressRecords(env, since)) {
        const sid = idByPage[r.studentPageId];
        if (!sid) continue;
        stmts.push(
          env.DB
            .prepare(
              "INSERT OR REPLACE INTO class_progress(id,student_id,date,unit,area,pct,start_date,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?)"
            )
            .bind("np_" + r.srcId, sid, r.date || r.startDate, r.unit, r.area, r.pct, r.startDate, r.memo, Date.now())
        );
        res.progress++;
      }
      await runChunked(env, stmts);
    }
    if (type === "attendance" || type === "all") {
      // 노션에서 가져온 출결/보강을 먼저 모두 지우고 다시 넣는다(=교체).
      // 그래야 과목 필터(영어 제외)가 바뀌면 이전에 잘못 들어온 기록이 정리됨.
      // 식별: 가져온 출결 키는 시간자리가 'n…', 보강 id는 'nm_'/'nmr_'.
      const stmts: D1PreparedStatement[] = [
        env.DB.prepare("DELETE FROM class_attendance WHERE att_key LIKE '%|n%'"),
        env.DB.prepare(
          "DELETE FROM class_makeups WHERE id LIKE 'nm\\_%' ESCAPE '\\' OR id LIKE 'nmr\\_%' ESCAPE '\\'"
        ),
      ];
      const lessonsBySid = await buildLessonsBySid(env);
      // 사용자가 직접 잡아둔 보강 예약(날짜·시간·상태)은 재가져오기 때 보존한다.
      const prevMk = new Map<string, { status: string; makeup_date: string; makeup_time: string; makeup_duration: number; parent_contacted: number; memo: string }>();
      try {
        const pm = await env.DB
          .prepare("SELECT id,status,makeup_date,makeup_time,makeup_duration,parent_contacted,memo FROM class_makeups WHERE id LIKE 'nm\\_%' ESCAPE '\\' OR id LIKE 'nmr\\_%' ESCAPE '\\'")
          .all<{ id: string; status: string; makeup_date: string; makeup_time: string; makeup_duration: number; parent_contacted: number; memo: string }>();
        for (const r of pm.results || [])
          prevMk.set(String(r.id), { status: String(r.status || ""), makeup_date: String(r.makeup_date || ""), makeup_time: String(r.makeup_time || ""), makeup_duration: Number(r.makeup_duration || 0), parent_contacted: Number(r.parent_contacted || 0), memo: String(r.memo || "") });
      } catch {
        /* 없으면 보존할 것 없음 */
      }
      // 직접 일정을 잡았거나 진행/완료 처리한 보강이면 그 값을 그대로 유지.
      const keptSched = (id: string) => {
        const p = prevMk.get(id);
        return p && (p.status !== "pending" || p.makeup_date !== "") ? p : null;
      };
      for (const r of await fetchAttendanceRecords(env, since)) {
        const sid = idByPage[r.studentPageId];
        if (!sid) continue;
        const srcKey = r.srcId.replace(/-/g, "").slice(-8);

        // 기간(범위) 결석 → 학생의 수업일마다 '결석' + 보강 대기로 전개
        let expanded = false;
        if (r.dateEnd && r.dateEnd > r.date && r.status.includes("결석")) {
          const lessons = lessonsBySid[sid] || [];
          for (const dstr of eachDate(r.date, r.dateEnd)) {
            if (dstr < since) continue;
            if (isHoliday(dstr)) continue; // 공휴일은 수업 없음 → 결석/보강 만들지 않음
            const dow = dowOf(dstr);
            for (const l of lessons) {
              if (l.day !== dow) continue;
              // 시간자리를 'n…'로 시작하게 해 '가져온 기록'으로 식별/정리 가능하게.
              const attKey = `${dstr}|${sid}|n${srcKey}x${l.time.replace(":", "")}`;
              // 사용자가 직접 삭제한 보강이면 출결/보강 모두 되살리지 않는다.
              if (dismissedSet.has(attKey)) continue;
              stmts.push(
                env.DB
                  .prepare(
                    "INSERT OR REPLACE INTO class_attendance(att_key,status,late_minutes,attitude,note,points_awarded) VALUES(?,?,NULL,'',?,0)"
                  )
                  .bind(attKey, "결석", r.note || `기간결석(${r.date}~${r.dateEnd})`)
              );
              const mkId = `nmr_${srcKey}_${dstr}_${l.time.replace(":", "")}`;
              const kept = keptSched(mkId);
              stmts.push(
                env.DB
                  .prepare(
                    "INSERT OR REPLACE INTO class_makeups(id,student_id,absent_date,absent_time,absent_duration,att_key,status,makeup_date,makeup_time,makeup_duration,parent_contacted,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
                  )
                  .bind(
                    mkId,
                    sid,
                    dstr,
                    l.time,
                    l.duration,
                    attKey,
                    kept ? kept.status : "pending",
                    kept ? kept.makeup_date : "",
                    kept ? kept.makeup_time : "",
                    kept ? kept.makeup_duration : l.duration,
                    kept ? kept.parent_contacted : 0,
                    kept ? kept.memo : r.note || `기간결석(${r.date}~${r.dateEnd})`,
                    Date.now()
                  )
              );
              res.attendance++;
              expanded = true;
            }
          }
        }
        if (expanded) continue;

        // 단일 날짜 기록 (또는 수업일을 찾지 못한 기간 기록)
        const attKey = `${r.date}|${sid}|n${srcKey}`;
        stmts.push(
          env.DB
            .prepare(
              "INSERT OR REPLACE INTO class_attendance(att_key,status,late_minutes,attitude,note,points_awarded) VALUES(?,?,?,?,?,0)"
            )
            .bind(attKey, r.status, r.lateMinutes || null, r.attitude || "", r.note || "")
        );
        // 출결='보강'은 보강 관리(makeups)에도 등록 (보강 진행/완료로 표시)
        if (r.status === "보강") {
          const mkId = "nm_" + r.srcId;
          const kept = keptSched(mkId);
          stmts.push(
            env.DB
              .prepare(
                "INSERT OR REPLACE INTO class_makeups(id,student_id,absent_date,absent_time,absent_duration,att_key,status,makeup_date,makeup_time,makeup_duration,parent_contacted,memo,created_at) VALUES(?,?,'','',0,'',?,?,?,?,?,?,?)"
              )
              .bind(
                mkId,
                sid,
                kept ? kept.status : "scheduled",
                kept ? kept.makeup_date : r.date,
                kept ? kept.makeup_time : "",
                kept ? kept.makeup_duration : 0,
                kept ? kept.parent_contacted : 0,
                kept ? kept.memo : r.note || "",
                Date.now()
              )
          );
        }
        res.attendance++;
      }
      await runChunked(env, stmts);
    }
    if (type === "test" || type === "all") {
      const stmts: D1PreparedStatement[] = [];
      for (const r of await fetchTestRecords(env, since)) {
        const sid = idByPage[r.studentPageId];
        if (!sid) continue;
        stmts.push(
          env.DB
            .prepare(
              "INSERT OR REPLACE INTO class_tests(id,student_id,date,type,round,range_,score,status,memo,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
            )
            .bind(
              "nt_" + r.srcId,
              sid,
              r.date,
              r.type,
              r.round,
              r.range,
              r.score || 0,
              r.status === "완료" ? "완료" : "예정",
              r.memo,
              Date.now()
            )
        );
        res.test++;
      }
      await runChunked(env, stmts);
    }
  } catch (e) {
    return json({ ...res, error: String(e) }, 500);
  }
  return json(res);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// HTML 엔티티 일부 디코드(링크 메타 제목·설명용).
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#x27;/gi, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}
