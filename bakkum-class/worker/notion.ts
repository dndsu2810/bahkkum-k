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
  // 이 수업(수업선택)에 해당하는 학생만 동기화
  studentClassFilter: ["초등수학", "중고등수학", "고백클래스"],
  // 출결 DB (실제 속성)
  attendance: { student: "이름", date: "날짜", status: "출결", attitude: "수업태도", late: "지각(숫자만)", note: "특이사항" },
  // 숙제 DB (실제 속성)
  homework: {
    student: "학생 선택",
    due: "숙제 마감일",
    book: "숙제 교재",
    area: "영역",
    completion: "완성도(입력)",
    done: "확인완료",
    content: "숙제 내용",
    note: "특이사항",
  },
  // 진도 DB (실제 속성)
  progress: { student: "학생 선택", unit: "진도 현황", area: "영역", pct: "진행률", start: "시작일", note: "특이사항" },
  // 3월부터 import 기준일
  importSince: "2026-03-01",
};

interface NotionEnv {
  NOTION_TOKEN?: string;
}

async function notionReq(env: NotionEnv, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch("https://api.notion.com" + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
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

// 숙제 기록 → 노션 숙제 DB (새 행). 교재/영역=multi_select, 완성도=number, 확인완료=checkbox.
export function createHomeworkRecord(
  env: NotionEnv,
  h: { notionPageId?: string; date: string; book: string; tags: string[]; completion: number; done: boolean; memo: string }
): Promise<boolean> {
  const P = NOTION_CFG.homework;
  const props: Record<string, unknown> = {
    [P.due]: { date: { start: h.date } },
    [P.completion]: { number: h.completion || 0 },
    [P.done]: { checkbox: !!h.done },
  };
  if (h.book) props[P.book] = multi([h.book]);
  if (h.tags && h.tags.length) props[P.area] = multi(h.tags);
  if (h.memo) props[P.note] = { rich_text: richText(h.memo) };
  if (h.notionPageId) props[P.student] = { relation: relation(h.notionPageId) };
  return createPage(env, NOTION_CFG.homeworkDb, props);
}

// 진도 기록 → 노션 진도 DB. 진도 현황/영역=multi_select, 진행률=number, 시작일=date.
export function createProgressRecord(
  env: NotionEnv,
  pr: { notionPageId?: string; unit: string; area: string; pct: number; startDate: string; memo: string }
): Promise<boolean> {
  const P = NOTION_CFG.progress;
  const props: Record<string, unknown> = {
    [P.pct]: { number: pr.pct || 0 },
  };
  if (pr.unit) props[P.unit] = multi([pr.unit]);
  if (pr.area) props[P.area] = multi(pr.area.split(/[,·]/).map((s) => s.trim()));
  if (pr.startDate) props[P.start] = { date: { start: pr.startDate } };
  if (pr.memo) props[P.note] = { rich_text: richText(pr.memo) };
  if (pr.notionPageId) props[P.student] = { relation: relation(pr.notionPageId) };
  return createPage(env, NOTION_CFG.progressDb, props);
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
      book: propValues(p[H.book]).join(", "),
      tags: propValues(p[H.area]),
      completion: numberVal(p[H.completion]),
      done: checkboxVal(p[H.done]),
      memo: propText(p[H.note]) || propText(p[H.content]),
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
export async function fetchProgressRecords(env: NotionEnv, since: string): Promise<ImportProg[]> {
  const P = NOTION_CFG.progress;
  const out: ImportProg[] = [];
  for (const pg of await queryAll(env, NOTION_CFG.progressDb, dateFilter(P.start, since))) {
    const p = (pg.properties || {}) as Record<string, Prop>;
    const studentPageId = relFirst(p[P.student]);
    const start = propText(p[P.start]);
    if (!studentPageId) continue;
    if (start && start < since) continue;
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

export interface ImportAtt {
  srcId: string;
  studentPageId: string;
  date: string;
  status: string;
  attitude: string;
  lateMinutes: number;
  note: string;
}
export async function fetchAttendanceRecords(env: NotionEnv, since: string): Promise<ImportAtt[]> {
  const A = NOTION_CFG.attendance;
  const out: ImportAtt[] = [];
  for (const pg of await queryAll(env, NOTION_CFG.attendanceDb, dateFilter(A.date, since))) {
    const p = (pg.properties || {}) as Record<string, Prop>;
    const studentPageId = relFirst(p[A.student]);
    const date = propText(p[A.date]);
    const status = propText(p[A.status]);
    if (!studentPageId || !date || date < since) continue;
    if (!status || status === "등원전" || status === "시작 전") continue;
    out.push({
      srcId: pg.id,
      studentPageId,
      date,
      status,
      attitude: propText(p[A.attitude]),
      lateMinutes: parseInt(propText(p[A.late]), 10) || 0,
      note: propText(p[A.note]),
    });
  }
  return out;
}
