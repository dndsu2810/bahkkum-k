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
  // 출결 DB 쓰기용 속성명 + 타입
  attendance: { date: "날짜", student: "이름", status: "출결", teacher: "담당T" },
  // 숙제 DB
  homework: { date: "날짜", student: "학생", content: "숙제", done: "완료" },
  // 진도 DB
  progress: { date: "날짜", student: "학생", content: "진도" },
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

/** TEMP debug: raw property names/types/values of the first few student rows. */
export async function debugStudents(env: NotionEnv): Promise<unknown> {
  if (!env.NOTION_TOKEN) throw new Error("NOTION_TOKEN not set");
  const res = await notionReq(env, "POST", `/v1/databases/${NOTION_CFG.studentDb}/query`, { page_size: 5 });
  if (!res.ok) throw new Error(`query ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { results: any[]; has_more: boolean };
  return {
    rawCount: j.results.length,
    has_more: j.has_more,
    samples: j.results.map((pg) => {
      const props = (pg.properties || {}) as Record<string, Prop>;
      const fields: Record<string, { type: string; value: string }> = {};
      for (const k of Object.keys(props)) {
        const v = propText(props[k]) || propValues(props[k]).join(" | ");
        fields[k] = { type: props[k].type || "?", value: v };
      }
      return { title: findTitle(props), fields };
    }),
  };
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

export function createAttendanceRecord(
  env: NotionEnv,
  a: { notionPageId?: string; date: string; status: string; teacher: string }
): Promise<boolean> {
  const P = NOTION_CFG.attendance;
  const props: Record<string, unknown> = {
    [P.date]: { date: { start: a.date } },
    [P.status]: { select: { name: a.status } },
    [P.teacher]: { rich_text: richText(a.teacher) },
  };
  if (a.notionPageId) props[P.student] = { relation: relation(a.notionPageId) };
  return createPage(env, NOTION_CFG.attendanceDb, props);
}

export function createHomeworkRecord(
  env: NotionEnv,
  h: { notionPageId?: string; date: string; content: string; done: boolean }
): Promise<boolean> {
  const P = NOTION_CFG.homework;
  const props: Record<string, unknown> = {
    [P.date]: { date: { start: h.date } },
    [P.content]: { rich_text: richText(h.content) },
    [P.done]: { checkbox: h.done },
  };
  if (h.notionPageId) props[P.student] = { relation: relation(h.notionPageId) };
  return createPage(env, NOTION_CFG.homeworkDb, props);
}

export function createProgressRecord(
  env: NotionEnv,
  p: { notionPageId?: string; date: string; content: string }
): Promise<boolean> {
  const P = NOTION_CFG.progress;
  const props: Record<string, unknown> = {
    [P.date]: { date: { start: p.date } },
    [P.content]: { rich_text: richText(p.content) },
  };
  if (p.notionPageId) props[P.student] = { relation: relation(p.notionPageId) };
  return createPage(env, NOTION_CFG.progressDb, props);
}
