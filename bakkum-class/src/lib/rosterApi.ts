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
  mathSlots: Slot[]; // 수학 수업 요일·시간(수학 앱과 공유)
  engSlots: Slot[]; // 영어 수업 요일·시간
}

/** 전체 로스터(수학·영어 공유). 백엔드 없으면 throw "no_backend". */
export async function getRoster(): Promise<RosterStudent[]> {
  let r: Response;
  try {
    r = await fetch("/api/roster", { cache: "no-store" });
  } catch {
    throw new Error("no_backend");
  }
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = (await r.json()) as { students?: RosterStudent[] };
  return j.students || [];
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
}
