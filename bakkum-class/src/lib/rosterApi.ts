// 공통 학생 마스터 API — 로스터 조회 + 허브 전용 필드(수강과목·영어반·온라인ID) 저장.

export type Subject = "math" | "english";
// bridge = 초등 고학년이지만 중고등처럼 수업받는 학생. 중고등(mid)에서 함께 관리.
export type EnglishBand = "elem" | "mid" | "bridge" | "";
// 수학 반: "" = 학년으로 자동(초1~3 저학년 / 초4~6 고학년 / 중고등) · "low" 초등 저학년 · "high" 초등 고학년.
export type MathClass = "" | "low" | "high";

/** 학생 영어반(band)이 화면 band("elem"|"mid")에 속하는지. bridge는 중고등(mid)에 포함. */
export function inEngBand(studentBand: EnglishBand, screenBand: "elem" | "mid"): boolean {
  if (screenBand === "mid") return studentBand === "mid" || studentBand === "bridge";
  return studentBand === "elem";
}

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
  mathClass: MathClass; // 수학 반(저학년/고학년) — 비우면 학년으로 자동 분류
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
  mathClass?: MathClass;
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
export async function saveStudentSlots(input: {
  studentId: string;
  math: Slot[];
  english: Slot[];
  mathEffFrom?: string;
  engEffFrom?: string; // 영어 시간표 적용 시작일(미래면 그 날부터 교체, 오늘은 그대로)
  /** 과목 수강 여부(체크 상태). 꺼져 있으면 기본은 시간표 보존. */
  mathOn?: boolean;
  engOn?: boolean;
  /** 과목을 끄며 시간표 삭제를 사용자가 확인했을 때만 true. */
  clearMath?: boolean;
  clearEnglish?: boolean;
}): Promise<void> {
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

/** 시간표 전용 저장(학생 1명) — 전체저장(putData)이 시간표를 더 이상 안 건드리므로, 시간표 편집/생성 시 호출.
 *  lessons(현재 시간표) + schedule(다버전 이력)을 그 학생만 교체. 오래된 화면의 일반 저장이 되돌리지 못함. */
export async function saveStudentTimetable(input: {
  studentId: string;
  lessons: { day: string; time: string; duration: number }[];
  schedule?: { from: string; lessons: { day: string; time: string; duration: number }[] }[];
}): Promise<void> {
  const r = await fetch("/api/student-timetable", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error("timetable_save_failed");
}

/** 공통 학생 핵심 필드 저장(원장 전용) — students에 기록 + 노션 동기화 보호(앱 소유). */
export async function saveStudentCore(input: {
  studentId: string;
  name?: string;
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
