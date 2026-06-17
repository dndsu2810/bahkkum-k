// 공통 학생 마스터 API — 로스터 조회 + 허브 전용 필드(수강과목·영어반·온라인ID) 저장.

export type Subject = "math" | "english";
export type EnglishBand = "elem" | "mid" | "";

export interface Slot {
  day: string; // 월~일
  time: string; // HH:MM
  duration: number; // 분
}

export interface RosterStudent {
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
  subjects: Subject[];
  englishBand: EnglishBand;
  attendDays: string[]; // 등원요일 ["월","수","금"]
  memo: string; // 메모/특이사항
  photo: string; // 프로필 사진 URL(선택)
  checkinNo: string; // 등하원 출석번호(학원이 부여)
  mathStart: string; // 수학 첫 등원일
  engStart: string; // 영어 첫 등원일
  mathSlots: Slot[]; // 수학 수업 요일·시간(수학 앱과 공유)
  engSlots: Slot[]; // 영어 수업 요일·시간
}

/** 전체 로스터(수학·영어 공유). 백엔드 없으면 throw "no_backend".
 *  여러 화면이 화면 전환마다 각각 호출 → 짧은 캐시 + 동시요청 합치기로 로딩·중복요청을 줄인다.
 *  명단을 수정하면 invalidateRoster()로 캐시를 비운다. */
let rosterCache: { at: number; data: RosterStudent[] } | null = null;
let rosterInflight: Promise<RosterStudent[]> | null = null;
const ROSTER_TTL = 30000;
export function invalidateRoster(): void { rosterCache = null; }
export async function getRoster(force = false): Promise<RosterStudent[]> {
  if (!force && rosterCache && Date.now() - rosterCache.at < ROSTER_TTL) return rosterCache.data;
  if (!force && rosterInflight) return rosterInflight;
  const p = (async () => {
    let r: Response;
    try {
      r = await fetch("/api/roster", { cache: "no-store" });
    } catch {
      throw new Error("no_backend");
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = (await r.json()) as { students?: RosterStudent[] };
    const list = j.students || [];
    rosterCache = { at: Date.now(), data: list };
    return list;
  })();
  rosterInflight = p.finally(() => { rosterInflight = null; });
  return rosterInflight;
}

/** 노션 → 앱 전체 학생 동기화(원장 전용). 수업 선택으로 과목 구분. */
export interface SyncRosterResult {
  willInsert: number;
  both: number;
  englishOnly: number;
  noClassCount: number;
  classKinds: Record<string, number>;
  error?: string;
}
export async function syncRosterFromNotion(dry = false): Promise<SyncRosterResult> {
  const r = await fetch("/api/sync/roster?dry=" + (dry ? "1" : "0"), { cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as Partial<SyncRosterResult>;
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return {
    willInsert: j.willInsert ?? 0,
    both: j.both ?? 0,
    englishOnly: j.englishOnly ?? 0,
    noClassCount: j.noClassCount ?? 0,
    classKinds: j.classKinds ?? {},
  };
}

/** 허브 전용 학생 필드 저장(원장 전용) — 온라인ID·수강과목·영어반·등원요일·메모. */
export async function saveStudentMeta(input: {
  studentId: string;
  onlineId: string;
  subjects: Subject[];
  englishBand: EnglishBand;
  attendDays?: string[];
  memo?: string;
  photo?: string;
  checkinNo?: string;
  mathStart?: string;
  engStart?: string;
}): Promise<void> {
  const r = await fetch("/api/roster/meta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "save_failed");
  }
  invalidateRoster();
}

/** 학생 과목별 수업 슬롯 저장(원장 전용) — 수학은 수학 앱과 공유, 영어는 영어 시간표. */
export async function saveStudentSlots(input: { studentId: string; math: Slot[]; english: Slot[] }): Promise<void> {
  const r = await fetch("/api/roster/slots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "save_failed");
  }
  invalidateRoster();
}

/** 공통 학생 핵심 필드 저장(원장 전용) — students에 기록 + 노션 동기화 보호(앱 소유). */
export async function saveStudentCore(input: {
  studentId: string;
  grade?: string;
  status?: string;
  school?: string;
  birthdate?: string;
  parentPhone?: string;
  studentPhone?: string;
  startDate?: string;
}): Promise<void> {
  const r = await fetch("/api/roster/core", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "save_failed");
  }
  invalidateRoster();
}

async function rosterPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error((j as { error?: string }).error || "HTTP " + r.status);
  return j;
}
/** 생년월일로 세부학년 1회 자동채움(원장). */
export const fillGrades = () => rosterPost<{ ok: boolean; filled: number }>("/api/roster/grade-fill", {});
export interface PromoteBefore { id: number; grade: string; status: string }
/** 전체 학년 +1 승급(고3→졸업). before 반환(되돌리기용). */
export const promoteGrades = (includeAll = false) =>
  rosterPost<{ ok: boolean; promoted: number; graduated: number; before: PromoteBefore[] }>("/api/roster/promote", { includeAll });
/** 일괄 학년/상태 복원(되돌리기). */
export const bulkGrades = (items: PromoteBefore[]) => rosterPost<{ ok: boolean }>("/api/roster/grade-bulk", { items });
