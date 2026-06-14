/// <reference types="@cloudflare/workers-types" />
// Notion API client (best-effort). Reads the student DB for sync, and creates
// rows in the attendance/homework/progress DBs.
//
// ⚠️ PROPERTY NAMES/TYPES below are guessed from the spec's Korean labels.
// If a Notion call fails (check `wrangler tail` logs), adjust the names/types
// in NOTION_CFG to match the real database schema. D1 is never affected by a
// Notion failure — Notion writes are fire-and-forget.

const NOTION_VERSION = "2022-06-28";

export const NOTION_CFG = {
  // 실제 database_id (노션 URL의 /p/ 뒤 32자리)
  studentDb: "2e766817e0618114a052f6cd6d0672f6", // 학생목록
  attendanceDb: "2e766817e0618131850bf4032cef1321", // 수업기록
  homeworkDb: "2e766817e0618149bbf1d2c13f7fc0a8", // 수학숙제
  progressDb: "2e766817e06181818459d59a19fa7e0e", // 수학진도
  testDb: "2e766817e0618157815ef11fcf5523dd", // 수학 테스트
  // 학생 DB 읽기용 속성명 (이름은 title 속성에서 자동 추출)
  student: {
    status: "상태",
    classSelect: "수업 선택", // relation → 수업 DB (제목으로 필터)
    school: "학교",
    birth: "생년월일",
    parentPhone: "학부모 연락처",
    studentPhone: "학생 연락처",
    start: "첫수업일",
  },
  // 이 수업(수업선택)에 해당하는 학생/출결만 동기화 (고백클래스 제외 — 혼선 방지)
  studentClassFilter: ["초등수학", "중고등수학"],
  // 출결 DB (실제 속성). classSelect=수업 선택(relation) → 초등수학/중고등수학만 가져오는 기준
  attendance: { student: "이름", date: "날짜", status: "출결", attitude: "수업태도", late: "지각(숫자만)", note: "특이사항", classSelect: "수업 선택" },
  // 숙제 DB (실제 속성). classSelect=수업 선택(relation), title=제목(title)
  homework: {
    student: "학생 선택",
    classSelect: "수업 선택",
    title: "수학숙제(자동)",
    due: "숙제 마감일",
    book: "숙제 교재",
    area: "영역",
    completion: "완성도(입력)",
    done: "확인완료",
    content: "숙제 내용",
    note: "특이사항",
    delay: "숙제 현황", // multi_select: 1~5차 밀림 등
  },
  // 진도 DB (실제 속성). classSelect=수업 선택(relation), title=제목(title)
  progress: {
    student: "학생 선택",
    classSelect: "수업 선택",
    title: "수학진도(자동)",
    unit: "진도 현황",
    area: "영역",
    pct: "진행률",
    start: "시작일",
    note: "특이사항",
  },
  // 테스트 DB (수학 테스트). classSelect=수업선택(공백 없음), title=수학 test
  test: {
    student: "학생 선택",
    classSelect: "수업선택",
    title: "수학 test",
    date: "시험일",
    type: "시험 유형",
    round: "회차",
    range: "시험 범위",
    score: "점수",
    status: "평가",
    note: "특이사항",
  },
  // 수업(과목) DB — 수업 선택 relation의 연결 대상(초등수학/중고등수학 페이지가 여기 있음)
  classDb: "2e766817-e061-8132-bef1-eba8f92c1633",
  // 학원 일정 DB (읽기 전용 표시용). 일정명=title, 날짜=date(범위 가능), 구분=select, 상태=status
  scheduleDb: "2e766817e061814993deffb437a7ed6a",
  schedule: { title: "일정명", date: "날짜", category: "구분", status: "상태" },
  // 3월부터 import 기준일
  importSince: "2026-03-01",
};

interface NotionEnv {
  NOTION_TOKEN?: string;
}

async function notionReq(env: NotionEnv, method: string, path: string, body?: unknown, attempt = 0): Promise<Response> {
  const res = await fetch("https://api.notion.com" + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // 노션 속도 제한(429)·일시 오류(5xx)는 백오프 후 재시도 — 여러 명 동시 푸시 시 일부 누락 방지.
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const ra = parseFloat(res.headers.get("Retry-After") || "");
    const waitMs = Math.min(8000, (ra > 0 ? ra * 1000 : 0) || 400 * Math.pow(2, attempt));
    await new Promise((r) => setTimeout(r, waitMs));
    return notionReq(env, method, path, body, attempt + 1);
  }
  return res;
}

/* ---------- read helpers ---------- */
type Prop = Record<string, unknown> & { type?: string };

function propText(p: Prop | undefined): string {
  if (!p || !p.type) return "";
  const any = p as Record<string, any>;
  switch (p.type) {
    case "title":
      return (any.title || []).map((t: any) => t.plain_text).join("");
    case "rich_text":
      return (any.rich_text || []).map((t: any) => t.plain_text).join("");
    case "select":
      return any.select?.name || "";
    case "status":
      return any.status?.name || "";
    case "date":
      return any.date?.start || "";
    case "phone_number":
      return any.phone_number || "";
    case "email":
      return any.email || "";
    case "number":
      return any.number == null ? "" : String(any.number);
    case "multi_select":
      return (any.multi_select || []).map((s: any) => s.name).join(", ");
    case "formula":
      return any.formula ? String(any.formula.string ?? any.formula.number ?? "") : "";
    default:
      return "";
  }
}

function findTitle(props: Record<string, Prop>): string {
  for (const k of Object.keys(props)) if (props[k]?.type === "title") return propText(props[k]);
  return "";
}

function relationIds(p: Prop | undefined): string[] {
  const any = p as Record<string, any> | undefined;
  return p && p.type === "relation" && Array.isArray(any!.relation) ? any!.relation.map((r: any) => r.id) : [];
}

/** Resolve the "수업 선택" relation → set of related-page ids whose title is one
 *  of studentClassFilter (초등수학/중고등수학/고백클래스). */
async function resolveAllowedClassIds(env: NotionEnv): Promise<Set<string>> {
  const allowed = new Set<string>();
  try {
    const meta = await notionReq(env, "GET", `/v1/databases/${NOTION_CFG.studentDb}`);
    if (!meta.ok) return allowed;
    const mj = (await meta.json()) as { properties?: Record<string, any> };
    const classDbId = mj.properties?.[NOTION_CFG.student.classSelect]?.relation?.database_id;
    if (!classDbId) return allowed;
    let cursor: string | undefined;
    do {
      const res = await notionReq(env, "POST", `/v1/databases/${classDbId}/query`, {
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      if (!res.ok) break;
      const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
      for (const pg of j.results) {
        const title = findTitle((pg.properties || {}) as Record<string, Prop>);
        if (NOTION_CFG.studentClassFilter.includes(title)) allowed.add(pg.id);
      }
      cursor = j.has_more ? j.next_cursor : undefined;
    } while (cursor);
  } catch {
    /* fall back to no class filter */
  }
  return allowed;
}

/** select/multi_select/status values as an array (for filtering). */
function propValues(p: Prop | undefined): string[] {
  if (!p || !p.type) return [];
  const any = p as Record<string, any>;
  if (p.type === "multi_select") return (any.multi_select || []).map((s: any) => s.name);
  if (p.type === "select") return any.select ? [any.select.name] : [];
  if (p.type === "status") return any.status ? [any.status.name] : [];
  const t = propText(p);
  return t ? [t] : [];
}

function numberVal(p: Prop | undefined): number {
  const any = p as Record<string, any> | undefined;
  if (p && p.type === "number" && typeof any!.number === "number") return any!.number;
  return p ? parseFloat(propText(p)) || 0 : 0;
}
function checkboxVal(p: Prop | undefined): boolean {
  const any = p as Record<string, any> | undefined;
  return !!(p && p.type === "checkbox" && any!.checkbox);
}

export interface NotionStudent {
  notionPageId: string;
  name: string;
  status: string;
  school: string;
  birth: string;
  parentPhone: string;
  studentPhone: string;
  start: string;
}

/** Read all 재원 students from the Notion student DB (paginated). */
export async function fetchNotionStudents(env: NotionEnv): Promise<NotionStudent[]> {
  if (!env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set");
  const allowedClassIds = await resolveAllowedClassIds(env);
  const out: NotionStudent[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionReq(env, "POST", `/v1/databases/${NOTION_CFG.studentDb}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    if (!res.ok) throw new Error(`query ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
    for (const pg of j.results) {
      const props = (pg.properties || {}) as Record<string, Prop>;
      const name = findTitle(props);
      if (!name) continue;
      const status = propText(props[NOTION_CFG.student.status]) || "재원";
      if (status !== "재원") continue; // 재원만 동기화
      // 수업 선택(relation)이 초등수학/중고등수학/고백클래스 중 하나인 학생만.
      // (allowed 해석 실패 시에는 필터를 건너뛰어 0건이 되지 않게 함)
      if (allowedClassIds.size > 0) {
        const rel = relationIds(props[NOTION_CFG.student.classSelect]);
        if (!rel.some((id) => allowedClassIds.has(id))) continue;
      }
      out.push({
        notionPageId: pg.id,
        name,
        status,
        school: propText(props[NOTION_CFG.student.school]),
        birth: propText(props[NOTION_CFG.student.birth]),
        parentPhone: propText(props[NOTION_CFG.student.parentPhone]),
        studentPhone: propText(props[NOTION_CFG.student.studentPhone]),
        start: propText(props[NOTION_CFG.student.start]),
      });
    }
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

/** 수업(과목) DB의 page id → 제목 맵 (예: id → "초등영어"). */
export async function fetchClassTitleMap(env: NotionEnv): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (!env.NOTION_TOKEN) return map;
  let cursor: string | undefined;
  try {
    do {
      const res = await notionReq(env, "POST", `/v1/databases/${NOTION_CFG.classDb}/query`, {
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      if (!res.ok) break;
      const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
      for (const pg of j.results) {
        const title = findTitle((pg.properties || {}) as Record<string, Prop>);
        if (title) map[pg.id] = title;
      }
      cursor = j.has_more ? j.next_cursor : undefined;
    } while (cursor);
  } catch {
    /* 권한/공유 문제면 빈 맵 */
  }
  return map;
}

export interface NotionFullStudent {
  notionPageId: string;
  name: string;
  status: string;
  school: string;
  birth: string;
  parentPhone: string;
  studentPhone: string;
  start: string;
  onlineId: string;
  classIds: string[]; // 수업 선택 relation page ids
}

/** 모든 재원 학생을 수업 선택(relation) 포함해 읽는다(과목 필터 없음). */
export async function fetchAllStudentsFull(env: NotionEnv): Promise<NotionFullStudent[]> {
  if (!env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set");
  const out: NotionFullStudent[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionReq(env, "POST", `/v1/databases/${NOTION_CFG.studentDb}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    if (!res.ok) throw new Error(`query ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
    for (const pg of j.results) {
      const props = (pg.properties || {}) as Record<string, Prop>;
      const name = findTitle(props);
      if (!name) continue;
      const status = propText(props[NOTION_CFG.student.status]) || "재원";
      if (status !== "재원") continue;
      out.push({
        notionPageId: pg.id,
        name,
        status,
        school: propText(props[NOTION_CFG.student.school]),
        birth: propText(props[NOTION_CFG.student.birth]),
        parentPhone: propText(props[NOTION_CFG.student.parentPhone]),
        studentPhone: propText(props[NOTION_CFG.student.studentPhone]),
        start: propText(props[NOTION_CFG.student.start]),
        onlineId: propText(props["ID"]),
        classIds: relationIds(props[NOTION_CFG.student.classSelect]),
      });
    }
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

export interface NotionEnglishMeta {
  notionPageId: string;
  name: string;
  onlineId: string; // "ID" rich_text
  englishDays: string; // "영어수업요일" multi_select (비어있지 않으면 영어 수강)
  englishCurri: string; // "영어 커리" rich_text
}

/** 학생 DB에서 영어 관련 메타(온라인ID·영어수업요일·영어커리)를 모든 재원 학생에 대해 읽는다.
 *  수업 선택 필터를 적용하지 않아 영어만 듣는 학생도 포함. */
export async function fetchStudentEnglishMeta(env: NotionEnv): Promise<NotionEnglishMeta[]> {
  if (!env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set");
  const out: NotionEnglishMeta[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionReq(env, "POST", `/v1/databases/${NOTION_CFG.studentDb}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    if (!res.ok) throw new Error(`query ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
    for (const pg of j.results) {
      const props = (pg.properties || {}) as Record<string, Prop>;
      const name = findTitle(props);
      if (!name) continue;
      const status = propText(props[NOTION_CFG.student.status]) || "재원";
      if (status !== "재원") continue;
      out.push({
        notionPageId: pg.id,
        name,
        onlineId: propText(props["ID"]),
        englishDays: propText(props["영어수업요일"]),
        englishCurri: propText(props["영어 커리"]),
      });
    }
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

/* ---------------- 노션 페이지 본문 → 평문 + 매뉴얼/SNS 가져오기 ---------------- */
const MANUAL_DB = "2e766817-e061-811e-9250-c3a5f6e56899"; // 바꿈 매뉴얼
const BLOG_DB = "32766817-e061-8074-9879-fa229ae1b3ea"; // SNS 관리(블로그)

function blockText(b: Record<string, any>): string {
  const t = b.type as string;
  const o = b[t];
  if (!o) return "";
  if (t === "table_row") return (o.cells || []).map((cell: any[]) => (cell || []).map((x) => x.plain_text || "").join("")).join(" | ");
  const rt = (o.rich_text || o.text || []) as any[];
  let s = Array.isArray(rt) ? rt.map((x) => x.plain_text || "").join("") : "";
  if (t === "to_do") s = (o.checked ? "[x] " : "[ ] ") + s;
  else if (t.startsWith("heading")) s = (s ? "\n" + s : s);
  else if (t === "bulleted_list_item" || t === "numbered_list_item") s = "- " + s;
  return s;
}

// 하위 페이지·하위 데이터베이스까지 펼치다 보면 깊어질 수 있어 깊이 상한만 둔다.
const MAX_BLOCK_DEPTH = 5;

/** 페이지(블록) 본문을 평문으로. 토글/리스트는 들여쓰기로, 하위 페이지·하위 DB는 통째로 펼친다. */
export async function fetchPageText(env: NotionEnv, pageId: string, depth = 0): Promise<string> {
  if (depth > MAX_BLOCK_DEPTH) return "";
  const out: string[] = [];
  let cursor: string | undefined;
  try {
    do {
      const path = `/v1/blocks/${pageId}/children?page_size=100` + (cursor ? `&start_cursor=${cursor}` : "");
      const res = await notionReq(env, "GET", path);
      if (!res.ok) break;
      const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
      for (const b of j.results || []) {
        // 하위 데이터베이스(예: 매뉴얼 페이지 안에 박힌 표/DB) — 행을 모두 펼쳐 빠짐없이 가져온다.
        if (b.type === "child_database") {
          const sub = await fetchChildDatabase(env, b.id, b.child_database?.title || "", depth + 1);
          if (sub) out.push(sub);
          continue;
        }
        // 하위 페이지 — 제목 + 본문 펼치기.
        if (b.type === "child_page") {
          const t = b.child_page?.title || "";
          if (t) out.push("\n■ " + t);
          const sub = await fetchPageText(env, b.id, depth + 1);
          if (sub) out.push(sub);
          continue;
        }
        const txt = blockText(b);
        if (txt) out.push(depth ? "  " + txt : txt);
        if (
          b.has_children &&
          ["toggle", "bulleted_list_item", "numbered_list_item", "callout", "quote", "column_list", "column", "table", "synced_block"].includes(b.type)
        ) {
          const sub = await fetchPageText(env, b.id, depth + 1);
          if (sub) out.push(sub);
        }
      }
      cursor = j.has_more ? j.next_cursor : undefined;
    } while (cursor);
  } catch {
    /* ignore */
  }
  return out.join("\n").trim();
}

/** 하위 데이터베이스의 모든 행(페이지)을 컬럼 전체가 담긴 파이프 표로 펼친다.
 *  예) "강사용 아이디 비번"처럼 site·ID·PW·비고 같은 속성값을 빠짐없이 가져온다.
 *  본문은 `헤더 | 헤더` + 행별 `값 | 값` 형태 — 앱(위키)에서 표 + 셀 복사로 렌더링. */
async function fetchChildDatabase(env: NotionEnv, dbId: string, title: string, depth: number): Promise<string> {
  if (depth > MAX_BLOCK_DEPTH) return "";
  const out: string[] = [];
  if (title) out.push("\n【" + title.trim() + "】");

  // 컬럼 순서 — DB 메타에서 가져오고 제목(title) 컬럼을 맨 앞으로. 실패 시 첫 행 키로 폴백.
  let cols: string[] = [];
  try {
    const meta = await notionReq(env, "GET", `/v1/databases/${dbId}`);
    if (meta.ok) {
      const mj = (await meta.json()) as { properties?: Record<string, { type?: string }> };
      const props = mj.properties || {};
      const keys = Object.keys(props);
      const titleKey = keys.find((k) => props[k]?.type === "title");
      cols = [...(titleKey ? [titleKey] : []), ...keys.filter((k) => k !== titleKey)];
    }
  } catch {
    /* 폴백은 아래에서 */
  }
  const cell = (v: string) => v.replace(/\s*\|\s*/g, "/").replace(/\s*\n\s*/g, " ").trim();

  let cursor: string | undefined;
  let headerDone = false;
  let rows = 0;
  try {
    do {
      const res = await notionReq(env, "POST", `/v1/databases/${dbId}/query`, {
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      if (!res.ok) break;
      const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
      for (const pg of j.results || []) {
        const props = (pg.properties || {}) as Record<string, Prop>;
        if (!cols.length) cols = Object.keys(props);
        if (!headerDone) {
          out.push(cols.join(" | "));
          headerDone = true;
        }
        out.push(cols.map((c) => cell(propText(props[c]))).join(" | "));
        rows++;
      }
      cursor = j.has_more ? j.next_cursor : undefined;
    } while (cursor);
  } catch {
    /* ignore */
  }
  if (!rows) out.push("(비어 있음)");
  return out.join("\n").trim();
}

export interface NotionManual {
  pageId: string;
  title: string;
  importance: string; // 낮음/보통/높음/매우 높음/핵심
  status: string; // 초안/작성중/검토중/최신/업데이트 필요
  body: string;
}
export async function fetchManualPages(env: NotionEnv): Promise<NotionManual[]> {
  if (!env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set");
  const out: NotionManual[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionReq(env, "POST", `/v1/databases/${MANUAL_DB}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    if (!res.ok) throw new Error(`manual ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
    for (const pg of j.results) {
      const props = (pg.properties || {}) as Record<string, Prop>;
      const title = findTitle(props);
      if (!title) continue;
      out.push({
        pageId: pg.id,
        title,
        importance: propText(props["중요도"]),
        status: propText(props["상태"]),
        body: await fetchPageText(env, pg.id),
      });
    }
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

export interface NotionSns {
  pageId: string;
  title: string;
  status: string; // 업로드 유무
  link: string;
  body: string;
}
export async function fetchSnsPages(env: NotionEnv): Promise<NotionSns[]> {
  if (!env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set");
  const out: NotionSns[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionReq(env, "POST", `/v1/databases/${BLOG_DB}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    if (!res.ok) throw new Error(`blog ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
    for (const pg of j.results) {
      const props = (pg.properties || {}) as Record<string, Prop>;
      const title = findTitle(props);
      if (!title) continue;
      const linkProp = props["업로드 링크"] as Record<string, any> | undefined;
      out.push({
        pageId: pg.id,
        title,
        status: propText(props["업로드 유무"]),
        link: (linkProp && linkProp.url) || "",
        body: await fetchPageText(env, pg.id),
      });
    }
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

// 중고등영어 DB — 데이터소스(소스) id를 써야 쿼리됨(뷰 id 아님).
const ENG_HOMEWORK_DB = "2e766817e061811180a0000ba707cf4f"; // 과제 기록DB(소스)
const ENG_ATTENDANCE_DB = "2e766817e06181ad92d8000bf18c1be3"; // 수업 기록 및 출결+포인트DB(소스)

// relation 페이지id → 학생 이름(제목) 해석기(캐시).
function makeNameResolver(env: NotionEnv) {
  const cache = new Map<string, string>();
  return async function nameOf(pageId: string): Promise<string> {
    if (cache.has(pageId)) return cache.get(pageId)!;
    let nm = "";
    try {
      const res = await notionReq(env, "GET", `/v1/pages/${pageId}`);
      if (res.ok) {
        const j = (await res.json()) as { properties?: Record<string, Prop> };
        nm = findTitle((j.properties || {}) as Record<string, Prop>).trim();
      }
    } catch {
      /* ignore */
    }
    cache.set(pageId, nm);
    return nm;
  };
}

export interface NotionEngHw {
  studentName: string;
  date: string; // YYYY-MM-DD
  word: string; // 완료|미흡|안함|없음|""
  reading: string;
  grammar: string;
  wrongCheck: boolean;
}
/** 과제기록 DB의 모든 행(이름·날짜·숙제 3분류·틀단확인). 학생은 relation→페이지 제목으로 이름 해석. */
export async function fetchEngHomework(env: NotionEnv): Promise<NotionEngHw[]> {
  if (!env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set");
  const norm = (v: string) => (v === "안 함" ? "안함" : v); // 옵션 중복 정리
  const valid = new Set(["완료", "미흡", "안함", "없음"]);
  const nameOf = makeNameResolver(env);
  const out: NotionEngHw[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionReq(env, "POST", `/v1/databases/${ENG_HOMEWORK_DB}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    if (!res.ok) throw new Error("notion query failed: " + res.status);
    const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
    for (const pg of j.results) {
      const props = (pg.properties || {}) as Record<string, Prop>;
      const date = propText(props["날짜"]).slice(0, 10);
      const sid = relationIds(props["학생 선택"])[0];
      if (!date || !sid) continue;
      const name = await nameOf(sid);
      if (!name) continue;
      const pick = (k: string) => {
        const v = norm(propText(props[k]));
        return valid.has(v) ? v : "";
      };
      out.push({
        studentName: name,
        date,
        word: pick("단어숙제"),
        reading: pick("리딩숙제"),
        grammar: pick("문법숙제"),
        wrongCheck: checkboxVal(props["틀단확인"]),
      });
    }
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

export interface NotionEngAtt {
  studentName: string;
  date: string;
  attStatus: string; // 출석|지각|결석|"" (우리 모델로 매핑)
  lateMin: number;
  attitude: string; // 매우좋음|보통|미흡|매우나쁨|""
  reasons: string[]; // 적립이나 차감사유 라벨들
  points: number; // 라벨 끝 숫자 합
  note: string; // 특이사항
}
/** 수업기록(출결+포인트) DB의 영어 행. 출결·지각분·수업태도·적립차감사유·포인트·특이사항. */
export async function fetchEngAttendance(env: NotionEnv): Promise<NotionEngAtt[]> {
  if (!env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set");
  // 노션 출결 → 우리 attStatus(출석/지각/결석). 조퇴·보강=출석류, 무단결석=결석, 등원전="".
  const mapAtt = (v: string) =>
    v === "출석" || v === "조퇴" || v === "보강" ? "출석" : v === "지각" ? "지각" : v === "결석" || v === "무단결석" ? "결석" : "";
  const nameOf = makeNameResolver(env);
  const out: NotionEngAtt[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionReq(env, "POST", `/v1/databases/${ENG_ATTENDANCE_DB}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    if (!res.ok) throw new Error("notion query failed: " + res.status);
    const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
    for (const pg of j.results) {
      const props = (pg.properties || {}) as Record<string, Prop>;
      const title = findTitle(props); // 수업(자동): '영어…'만
      if (!title.includes("영어")) continue;
      const date = propText(props["날짜"]).slice(0, 10);
      const sid = relationIds(props["이름"])[0];
      if (!date || !sid) continue;
      const name = await nameOf(sid);
      if (!name) continue;
      const reasons = propValues(props["적립이나 차감사유"]);
      const points = reasons.reduce((n, r) => { const m = /(-?\d+)\s*$/.exec(r); return n + (m ? parseInt(m[1], 10) : 0); }, 0);
      const lateRaw = propText(props["지각(숫자만)"]);
      out.push({
        studentName: name,
        date,
        attStatus: mapAtt(propText(props["출결"])),
        lateMin: parseInt(lateRaw.replace(/[^0-9]/g, ""), 10) || 0,
        attitude: propText(props["수업태도"]),
        reasons,
        points,
        note: propText(props["특이사항"]),
      });
    }
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

/** TEMP inspect: schema(속성명/타입) + 샘플 of a Notion DB (구현 점검용). */
export async function inspectDb(env: NotionEnv, which: string): Promise<unknown> {
  if (!env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set");
  const dbId =
    which === "homework"
      ? NOTION_CFG.homeworkDb
      : which === "progress"
        ? NOTION_CFG.progressDb
        : which === "attendance"
          ? NOTION_CFG.attendanceDb
          : which === "test"
            ? NOTION_CFG.testDb
            : NOTION_CFG.studentDb;

  const meta = await notionReq(env, "GET", `/v1/databases/${dbId}`);
  if (!meta.ok) throw new Error(`db ${meta.status}: ${await meta.text()}`);
  const mj = (await meta.json()) as { properties?: Record<string, any> };
  const props = mj.properties || {};
  const schema = Object.keys(props).map((k) => ({
    name: k,
    type: props[k].type,
    ...(props[k].type === "relation" ? { relationDb: props[k].relation?.database_id } : {}),
  }));

  const q = await notionReq(env, "POST", `/v1/databases/${dbId}/query`, { page_size: 3 });
  const qj = q.ok ? ((await q.json()) as { results: any[] }) : { results: [] };
  const samples = (qj.results || []).map((pg) => {
    const p = (pg.properties || {}) as Record<string, Prop>;
    const f: Record<string, string> = {};
    for (const k of Object.keys(p)) {
      const t = p[k].type;
      f[k] = t === "relation" ? `[rel:${((p[k] as any).relation || []).length}]` : propText(p[k]);
    }
    return { title: findTitle(p), fields: f };
  });
  return { which, dbId, schema, samples };
}

/* ---------- write helpers (best-effort) ---------- */
async function createPage(env: NotionEnv, databaseId: string, properties: Record<string, unknown>): Promise<boolean> {
  if (!env.NOTION_TOKEN) return false;
  try {
    const r = await notionReq(env, "POST", "/v1/pages", { parent: { database_id: databaseId }, properties });
    if (!r.ok) console.log("notion createPage failed", databaseId, r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.log("notion createPage error", String(e));
    return false;
  }
}

const relation = (pageId?: string) => (pageId ? [{ id: pageId }] : []);
const richText = (s: string) => [{ text: { content: s } }];
const multi = (names: string[]) => ({ multi_select: names.filter(Boolean).map((n) => ({ name: n })) });
const titleProp = (s: string) => ({ title: s ? [{ text: { content: s } }] : [] });

/** 노션 기록 제목(자동화 라벨과 동일하게 고정 입력). */
const TITLE_HOMEWORK = "수학숙제";
const TITLE_PROGRESS = "수업진도";
const TITLE_TEST = "수학Test";

/** 수업(과목) DB의 페이지들 → { 제목: pageId } 맵. 수업 선택 relation 채울 때 사용.
 *  초등수학/중고등수학은 거의 안 바뀌므로 isolate 단위로 캐시해 매 푸시마다의 조회를 없앤다. */
let _classMapCache: Record<string, string> | null = null;
export async function fetchClassPageMap(env: NotionEnv): Promise<Record<string, string>> {
  if (_classMapCache) return _classMapCache;
  const map: Record<string, string> = {};
  try {
    let cursor: string | undefined;
    do {
      const res = await notionReq(env, "POST", `/v1/databases/${NOTION_CFG.classDb}/query`, {
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      if (!res.ok) break;
      const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
      for (const pg of j.results) {
        const title = findTitle((pg.properties || {}) as Record<string, Prop>);
        if (title) map[title] = pg.id;
      }
      cursor = j.has_more ? j.next_cursor : undefined;
    } while (cursor);
  } catch {
    /* ignore */
  }
  if (map["초등수학"] || map["중고등수학"]) _classMapCache = map; // 정상 조회 시에만 캐시
  return map;
}

// 수업(과목) 페이지 id (실측 확인값). 수업 DB가 연동에 공유 안 돼 fetchClassPageMap이
// 비어도 출결/숙제 행을 과목으로 특정할 수 있게 폴백으로 사용한다.
const CLASS_PAGE_ID: Record<string, string> = {
  초등수학: "2e766817-e061-8194-a7fc-ce8db36089cc",
  중고등수학: "2e766817-e061-8187-9bae-c2460a579bb9",
};

/** 학생 학년('초등'/'중등'...) → 수업 선택 페이지 id (초등→초등수학, 그 외→중고등수학). */
export function classPageIdForGrade(map: Record<string, string>, grade: string): string | undefined {
  const wanted = (grade || "").startsWith("초") ? "초등수학" : "중고등수학";
  return map[wanted] || CLASS_PAGE_ID[wanted];
}

// 숙제 기록 → 노션 숙제 DB. 같은 학생·같은 마감일 행이 있으면 갱신(중복 행 방지).
//  - 숙제 내용(text) = 교재/내용 텍스트   - 영역(multi_select) = 태그
//  - 완성도(number) · 확인완료(checkbox) · 특이사항(text) = 메모(분리)
//  - '숙제 교재'(multi_select)는 자유 텍스트로 더럽히지 않도록 건드리지 않는다.
export async function upsertHomeworkRecord(
  env: NotionEnv,
  h: {
    notionPageId?: string;
    classPageId?: string;
    date: string;
    book: string;
    tags: string[];
    completion: number;
    done: boolean;
    memo: string;
    /** 지연 횟수 — 노션 '숙제 현황'에 'N차 밀림'으로 반영(>0일 때). */
    delayCount?: number;
    /** 검사완료/지연 토글만: 기존 행이 있으면 확인완료·완성도·숙제현황만 갱신하고
     *  숙제 내용·특이사항·영역 등 직접 입력분은 건드리지 않는다. */
    checkOnly?: boolean;
  }
): Promise<boolean> {
  if (!env.NOTION_TOKEN || !h.notionPageId || !h.date) return false;
  const P = NOTION_CFG.homework;
  const fullProps: Record<string, unknown> = {
    [P.title]: titleProp(TITLE_HOMEWORK),
    [P.due]: { date: { start: h.date } },
    [P.completion]: { number: h.completion || 0 },
    [P.done]: { checkbox: !!h.done },
    [P.content]: { rich_text: richText(h.book || "") }, // 숙제 내용
    [P.note]: { rich_text: richText(h.memo || "") }, // 특이사항(메모만, 숙제 내용과 분리)
    [P.student]: { relation: relation(h.notionPageId) },
  };
  if (h.tags && h.tags.length) fullProps[P.area] = multi(h.tags);
  if (h.classPageId) fullProps[P.classSelect] = { relation: relation(h.classPageId) };
  try {
    // 같은 학생·마감일에 여러 숙제가 있을 수 있으므로 '숙제 내용'까지 맞춰 정확히 그 행만 잡는다.
    const existing = await findHomeworkPage(env, h.notionPageId, h.date, h.classPageId, h.book);
    if (existing) {
      // 검사완료/지연 토글: 확인완료 + 완성도(+숙제현황)만 갱신. 그 외엔 전체 갱신.
      let props: Record<string, unknown> = fullProps;
      if (h.checkOnly) {
        props = { [P.done]: { checkbox: !!h.done }, [P.completion]: { number: h.completion || 0 } };
        if (h.delayCount && h.delayCount > 0) props[P.delay] = multi([Math.min(h.delayCount, 5) + "차 밀림"]);
      }
      const r = await notionReq(env, "PATCH", `/v1/pages/${existing}`, { properties: props });
      if (!r.ok) console.log("notion hw update failed", r.status, await r.text());
      return r.ok;
    }
    return await createPage(env, NOTION_CFG.homeworkDb, fullProps);
  } catch (e) {
    console.log("notion hw upsert error", String(e));
    return false;
  }
}

/** 같은 학생·마감일·수업(+숙제 내용)의 기존 숙제 페이지 id (없으면 null). */
async function findHomeworkPage(env: NotionEnv, studentPageId: string, date: string, classPageId?: string, content?: string): Promise<string | null> {
  const P = NOTION_CFG.homework;
  const and: unknown[] = [
    { property: P.student, relation: { contains: studentPageId } },
    { property: P.due, date: { equals: date } },
  ];
  if (classPageId) and.push({ property: P.classSelect, relation: { contains: classPageId } });
  if (content) and.push({ property: P.content, rich_text: { equals: content } });
  try {
    const r = await notionReq(env, "POST", `/v1/databases/${NOTION_CFG.homeworkDb}/query`, {
      page_size: 1,
      filter: { and },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { results: { id: string }[] };
    return j.results[0]?.id || null;
  } catch {
    return null;
  }
}

// 진도 기록 → 노션 진도 DB. 진도 현황/영역=multi_select, 진행률=number, 시작일=date.
// 같은 학생·같은 단원(진도 현황) 행이 있으면 갱신(중복 행 방지). 없으면 새로 생성.
export async function upsertProgressRecord(
  env: NotionEnv,
  pr: {
    notionPageId?: string;
    classPageId?: string;
    unit: string;
    area: string;
    pct: number;
    startDate: string;
    memo: string;
  }
): Promise<boolean> {
  if (!env.NOTION_TOKEN || !pr.notionPageId) return false;
  const P = NOTION_CFG.progress;
  const props: Record<string, unknown> = {
    [P.title]: titleProp(TITLE_PROGRESS),
    [P.pct]: { number: pr.pct || 0 },
    [P.note]: { rich_text: richText(pr.memo || "") },
    [P.student]: { relation: relation(pr.notionPageId) },
  };
  if (pr.unit) props[P.unit] = multi([pr.unit]);
  if (pr.area) props[P.area] = multi(pr.area.split(/[,·]/).map((s) => s.trim()));
  if (pr.startDate) props[P.start] = { date: { start: pr.startDate } };
  if (pr.classPageId) props[P.classSelect] = { relation: relation(pr.classPageId) };
  try {
    const existing = await findProgressPage(env, pr.notionPageId, pr.unit);
    if (existing) {
      const r = await notionReq(env, "PATCH", `/v1/pages/${existing}`, { properties: props });
      if (!r.ok) console.log("notion prog update failed", r.status, await r.text());
      return r.ok;
    }
    return await createPage(env, NOTION_CFG.progressDb, props);
  } catch (e) {
    console.log("notion prog upsert error", String(e));
    return false;
  }
}

/** 같은 학생(relation)·같은 단원(진도 현황 contains)의 기존 진도 페이지 id (단원 없으면 null→새로). */
async function findProgressPage(env: NotionEnv, studentPageId: string, unit: string): Promise<string | null> {
  if (!unit) return null;
  const P = NOTION_CFG.progress;
  try {
    const r = await notionReq(env, "POST", `/v1/databases/${NOTION_CFG.progressDb}/query`, {
      page_size: 1,
      filter: {
        and: [
          { property: P.student, relation: { contains: studentPageId } },
          { property: P.unit, multi_select: { contains: unit } },
        ],
      },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { results: { id: string }[] };
    return j.results[0]?.id || null;
  } catch {
    return null;
  }
}

// 테스트 기록 → 노션 테스트 DB. 시험 유형/회차=multi_select, 점수=number, 평가=select.
// 같은 학생·같은 시험일·같은 유형 행이 있으면 갱신(중복 행 방지). 제목/학생/수업선택도 채움.
export async function upsertTestRecord(
  env: NotionEnv,
  t: {
    notionPageId?: string;
    classPageId?: string;
    date: string;
    type: string;
    round: string;
    range: string;
    score: number;
    status: string;
    memo: string;
  }
): Promise<boolean> {
  if (!env.NOTION_TOKEN || !t.notionPageId || !t.date) return false;
  const P = NOTION_CFG.test;
  const props: Record<string, unknown> = {
    [P.title]: titleProp(TITLE_TEST),
    [P.status]: { select: { name: t.status || "예정" } },
    [P.date]: { date: { start: t.date } },
    [P.score]: { number: t.score || 0 },
    [P.range]: { rich_text: richText(t.range || "") },
    [P.note]: { rich_text: richText(t.memo || "") },
    [P.student]: { relation: relation(t.notionPageId) },
  };
  if (t.type) props[P.type] = multi([t.type]);
  if (t.round) props[P.round] = multi([t.round]);
  if (t.classPageId) props[P.classSelect] = { relation: relation(t.classPageId) };
  try {
    const existing = await findTestPage(env, t.notionPageId, t.date, t.type);
    if (existing) {
      const r = await notionReq(env, "PATCH", `/v1/pages/${existing}`, { properties: props });
      if (!r.ok) console.log("notion test update failed", r.status, await r.text());
      return r.ok;
    }
    return await createPage(env, NOTION_CFG.testDb, props);
  } catch (e) {
    console.log("notion test upsert error", String(e));
    return false;
  }
}

/** 같은 학생(relation)·같은 시험일·같은 시험유형의 기존 테스트 페이지 id (없으면 null). */
async function findTestPage(env: NotionEnv, studentPageId: string, date: string, type: string): Promise<string | null> {
  const P = NOTION_CFG.test;
  const and: unknown[] = [
    { property: P.student, relation: { contains: studentPageId } },
    { property: P.date, date: { equals: date } },
  ];
  if (type) and.push({ property: P.type, multi_select: { contains: type } });
  try {
    const r = await notionReq(env, "POST", `/v1/databases/${NOTION_CFG.testDb}/query`, { page_size: 1, filter: { and } });
    if (!r.ok) return null;
    const j = (await r.json()) as { results: { id: string }[] };
    return j.results[0]?.id || null;
  } catch {
    return null;
  }
}

// 출결 기록 → 노션 수업기록 DB. 출결=select, 수업태도=select, 지각(숫자만)=text(숫자 문자열),
// 이름/수업 선택=relation, 날짜=date. 같은 학생·같은 날짜 행이 있으면 갱신(중복 행 방지).
export async function upsertAttendanceRecord(
  env: NotionEnv,
  a: {
    notionPageId?: string;
    classPageId?: string;
    date: string;
    status: string;
    attitude: string;
    lateMinutes: number;
    note: string;
  }
): Promise<boolean> {
  if (!env.NOTION_TOKEN || !a.notionPageId || !a.date || !a.status) return false;
  const A = NOTION_CFG.attendance;
  const props: Record<string, unknown> = {
    [A.date]: { date: { start: a.date } },
    [A.status]: { select: { name: a.status } },
    [A.student]: { relation: relation(a.notionPageId) },
  };
  // 수업태도는 앱이 소유 → 값 있으면 설정, 비우면 노션도 해제(null).
  props[A.attitude] = a.attitude ? { select: { name: a.attitude } } : { select: null };
  // 지각(숫자만)은 노션에서 '텍스트' 속성 → 숫자 문자열로 보낸다(숫자로 보내면 400으로 전체 거부됨).
  if (a.status === "지각" && a.lateMinutes) props[A.late] = { rich_text: richText(String(a.lateMinutes)) };
  if (a.note) props[A.note] = { rich_text: richText(a.note) };
  if (a.classPageId) props[A.classSelect] = { relation: relation(a.classPageId) };
  try {
    const existing = await findAttendancePage(env, a.notionPageId, a.date, a.classPageId);
    if (existing) {
      const r = await notionReq(env, "PATCH", `/v1/pages/${existing}`, { properties: props });
      if (!r.ok) console.log("notion att update failed", r.status, await r.text());
      return r.ok;
    }
    return await createPage(env, NOTION_CFG.attendanceDb, props);
  } catch (e) {
    console.log("notion att upsert error", String(e));
    return false;
  }
}

/** 같은 학생(relation)·같은 날짜·같은 수업(수업 선택)의 기존 출결 페이지 id (없으면 null).
 *  수업 선택까지 맞춰야 한 학생이 같은 날 수학/영어 행을 둘 다 가질 때 엉뚱한 행을 안 잡는다. */
async function findAttendancePage(
  env: NotionEnv,
  studentPageId: string,
  date: string,
  classPageId?: string
): Promise<string | null> {
  const A = NOTION_CFG.attendance;
  const and: unknown[] = [
    { property: A.student, relation: { contains: studentPageId } },
    { property: A.date, date: { equals: date } },
  ];
  if (classPageId) and.push({ property: A.classSelect, relation: { contains: classPageId } });
  try {
    const r = await notionReq(env, "POST", `/v1/databases/${NOTION_CFG.attendanceDb}/query`, {
      page_size: 1,
      filter: { and },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { results: { id: string }[] };
    return j.results[0]?.id || null;
  } catch {
    return null;
  }
}

/* ---------- import: 노션 기록 → 앱 (read; 3월부터, 서버 필터) ---------- */
async function queryAll(env: NotionEnv, dbId: string, filter?: unknown): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionReq(env, "POST", `/v1/databases/${dbId}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
      ...(filter ? { filter } : {}),
    });
    if (!res.ok) throw new Error(`query ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string };
    out.push(...j.results);
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}
const dateFilter = (prop: string, since: string) => ({ property: prop, date: { on_or_after: since } });
const relFirst = (p: Prop | undefined) => relationIds(p)[0] || "";

export interface ImportHw {
  srcId: string;
  studentPageId: string;
  date: string;
  book: string;
  tags: string[];
  completion: number;
  done: boolean;
  memo: string;
}
export async function fetchHomeworkRecords(env: NotionEnv, since: string): Promise<ImportHw[]> {
  const H = NOTION_CFG.homework;
  const out: ImportHw[] = [];
  for (const pg of await queryAll(env, NOTION_CFG.homeworkDb, dateFilter(H.due, since))) {
    const p = (pg.properties || {}) as Record<string, Prop>;
    const studentPageId = relFirst(p[H.student]);
    const date = propText(p[H.due]);
    if (!studentPageId || !date || date < since) continue;
    out.push({
      srcId: pg.id,
      studentPageId,
      date,
      // 쓰기와 대칭: 앱 '교재/내용' ← 노션 '숙제 내용'(content), '메모' ← '특이사항'(note).
      // (노션 '숙제 교재' multi_select는 쓰기와 동일하게 import에서도 건드리지 않음)
      book: propText(p[H.content]),
      tags: propValues(p[H.area]),
      completion: numberVal(p[H.completion]),
      done: checkboxVal(p[H.done]),
      memo: propText(p[H.note]),
    });
  }
  return out;
}

export interface ImportProg {
  srcId: string;
  studentPageId: string;
  date: string;
  unit: string;
  area: string;
  pct: number;
  startDate: string;
  memo: string;
}
export async function fetchProgressRecords(env: NotionEnv, _since: string): Promise<ImportProg[]> {
  const P = NOTION_CFG.progress;
  const out: ImportProg[] = [];
  // 진도는 '시작일'이 사건 날짜가 아니라 '단원 시작일'이라 몇 달 전이어도 현재 진도일 수 있다.
  // 따라서 날짜로 거르지 않고 전체를 가져온다(예: 시작일이 3월 이전인 학생 진도도 포함).
  for (const pg of await queryAll(env, NOTION_CFG.progressDb)) {
    const p = (pg.properties || {}) as Record<string, Prop>;
    const studentPageId = relFirst(p[P.student]);
    const start = propText(p[P.start]);
    if (!studentPageId) continue;
    out.push({
      srcId: pg.id,
      studentPageId,
      date: start,
      unit: propValues(p[P.unit]).join(", "),
      area: propValues(p[P.area]).join(", "),
      pct: numberVal(p[P.pct]),
      startDate: start,
      memo: propText(p[P.note]),
    });
  }
  return out;
}

/** 날짜 속성의 종료일(date.end) — 기간(범위) 결석 판별용. 없으면 ''. */
function propDateEnd(p: Prop | undefined): string {
  const any = p as Record<string, any> | undefined;
  return p && p.type === "date" ? any!.date?.end || "" : "";
}

export interface ImportAtt {
  srcId: string;
  studentPageId: string;
  date: string;
  /** 기간 결석이면 종료일(YYYY-MM-DD), 단일 날짜면 ''. */
  dateEnd: string;
  status: string;
  attitude: string;
  lateMinutes: number;
  note: string;
}
export async function fetchAttendanceRecords(env: NotionEnv, since: string): Promise<ImportAtt[]> {
  const A = NOTION_CFG.attendance;
  // 학생 동기화와 동일하게 '수업 선택'(relation)이 초등수학/중고등수학인 출결만.
  // (영어·고백클래스 등 다른 수업 제외) 해석 실패로 비면 import 0 → 잘못 들어오는 것보다 안전.
  const allowedClassIds = await resolveAllowedClassIds(env);
  const out: ImportAtt[] = [];
  for (const pg of await queryAll(env, NOTION_CFG.attendanceDb, dateFilter(A.date, since))) {
    const p = (pg.properties || {}) as Record<string, Prop>;
    const classRel = relationIds(p[A.classSelect]);
    if (!classRel.some((id) => allowedClassIds.has(id))) continue;
    const studentPageId = relFirst(p[A.student]);
    const date = propText(p[A.date]);
    const status = propText(p[A.status]);
    if (!studentPageId || !date || date < since) continue;
    if (!status || status === "등원전" || status === "시작 전") continue;
    out.push({
      srcId: pg.id,
      studentPageId,
      date,
      dateEnd: propDateEnd(p[A.date]),
      status,
      attitude: propText(p[A.attitude]),
      lateMinutes: parseInt(propText(p[A.late]), 10) || 0,
      note: propText(p[A.note]),
    });
  }
  return out;
}

export interface ImportTest {
  srcId: string;
  studentPageId: string;
  date: string;
  type: string;
  round: string;
  range: string;
  score: number;
  status: string;
  memo: string;
}
export async function fetchTestRecords(env: NotionEnv, since: string): Promise<ImportTest[]> {
  const T = NOTION_CFG.test;
  // 수업선택이 초등수학/중고등수학인 테스트만(영어·고백 제외).
  const allowedClassIds = await resolveAllowedClassIds(env);
  const out: ImportTest[] = [];
  for (const pg of await queryAll(env, NOTION_CFG.testDb, dateFilter(T.date, since))) {
    const p = (pg.properties || {}) as Record<string, Prop>;
    const classRel = relationIds(p[T.classSelect]);
    if (!classRel.some((id) => allowedClassIds.has(id))) continue;
    const studentPageId = relFirst(p[T.student]);
    const date = propText(p[T.date]);
    if (!studentPageId || !date || date < since) continue;
    out.push({
      srcId: pg.id,
      studentPageId,
      date,
      type: propValues(p[T.type]).join(", "),
      round: propValues(p[T.round]).join(", "),
      range: propText(p[T.range]),
      score: numberVal(p[T.score]),
      status: propText(p[T.status]) || "예정",
      memo: propText(p[T.note]),
    });
  }
  return out;
}

/* ---------- 학원 일정 (읽기 전용 표시) ---------- */
export interface ScheduleItem {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD (시작)
  dateEnd: string; // 범위면 종료일, 아니면 ''
  isDatetime: boolean;
  category: string; // 구분 (학원 일정/학교 일정/할일/강사 일정/공휴일…)
  status: string; // 예정/진행 중/완료/취소
}
/** 학원 일정 DB에서 since(YYYY-MM-DD) 이후 일정을 읽어온다(읽기 전용). */
export async function fetchScheduleItems(env: NotionEnv, since: string): Promise<ScheduleItem[]> {
  const S = NOTION_CFG.schedule;
  const out: ScheduleItem[] = [];
  for (const pg of await queryAll(env, NOTION_CFG.scheduleDb, dateFilter(S.date, since))) {
    const p = (pg.properties || {}) as Record<string, Prop>;
    const dp = p[S.date] as Record<string, any> | undefined;
    const startRaw = dp && dp.type === "date" ? dp.date?.start || "" : "";
    if (!startRaw) continue;
    const date = String(startRaw).slice(0, 10);
    const endRaw = propDateEnd(p[S.date]);
    out.push({
      id: pg.id,
      title: findTitle(p) || "(제목 없음)",
      date,
      dateEnd: endRaw ? String(endRaw).slice(0, 10) : "",
      isDatetime: String(startRaw).length > 10,
      category: propText(p[S.category]),
      status: propText(p[S.status]),
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}
