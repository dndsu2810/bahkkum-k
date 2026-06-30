// 수학 주간 테스트 자동 예약 — 매주 수/목 중 학생이 먼저 오는 날에 '주간test' 예약.
// 그 달의 2번째 수/목(= KTC 전국수학경시대회 일정)엔 'KTC수학경시대회'로, 단원은 학년·월 표에서 자동 채움.
import type { Student, TestLog } from "../types";
import { parseD, ymd, todayStr, weekOfMonthLabel, uid } from "./dates";
import { effectiveLessons } from "./logic";
import { parseGrade } from "./grade";

export const WEEKLY_TYPE = "주간test";
export const KTC_TYPE = "KTC수학경시대회";

// KTC 전국수학경시대회 월별·학년별 시험 범위(2026 연간 일정표). 열: 초1~초6, 중1~중3.
// 월(1~12) → 학년키(초1..초6,중1..중3) → 범위. (2027 1·2월도 동일 범위라 월 기준으로 충분.)
const G = ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3"] as const;
type GKey = (typeof G)[number];
// 같은 값이 반복되는 행은 헬퍼로 채움.
const row = (vals: [string, string, string, string, string, string, string, string, string]): Record<GKey, string> =>
  Object.fromEntries(G.map((g, i) => [g, vals[i]])) as Record<GKey, string>;
const elemAll = (e: string, m1: string, m2: string, m3: string): [string, string, string, string, string, string, string, string, string] =>
  [e, e, e, e, e, e, m1, m2, m3];

const KTC_TABLE: Record<number, Record<GKey, string>> = {
  1: row(elemAll("2학기 6단원", "2학기 8단원", "2학기 8단원", "2학기 5~7단원")),
  2: row(elemAll("2학기 1~6단원", "2학기 5~8단원", "2학기 5~8단원", "1,2학기 전 단원")),
  3: row(["-", "초1학년 1,2학기 전 단원", "초2학년 1,2학기 전 단원", "초3학년 1,2학기 전 단원", "초4학년 1,2학기 전 단원", "초5학년 1,2학기 전 단원", "초6학년 1,2학기 전 단원", "중1학년 1,2학기 전 단원", "중2학년 1,2학기 전 단원"]),
  4: row(elemAll("1학기 1~2단원", "1학기 1단원", "1학기 1단원", "1학기 1단원")),
  5: row(elemAll("1학기 3단원", "1학기 2단원", "1학기 2단원", "1학기 2단원")),
  6: row(elemAll("1학기 1~3단원", "1학기 1~2단원", "1학기 1~2단원", "1학기 1~2단원")),
  7: row(["1학기 4단원", "1학기 4~5단원", "1학기 4~5단원", "1학기 4~5단원", "1학기 4~5단원", "1학기 4~5단원", "1학기 3단원", "1학기 3단원", "1학기 3단원"]),
  8: row(["1학기 5단원", "1학기 6단원", "1학기 6단원", "1학기 6단원", "1학기 6단원", "1학기 6단원", "1학기 4단원", "1학기 4단원", "1학기 4단원"]),
  9: row(["1학기 1~5단원", "1학기 1~6단원", "1학기 1~6단원", "1학기 1~6단원", "1학기 1~6단원", "1학기 1~6단원", "1학기 3~4단원", "1학기 3~4단원", "1학기 3~4단원"]),
  10: row(elemAll("2학기 1단원", "2학기 5단원", "2학기 5단원", "2학기 5단원")),
  11: row(elemAll("2학기 2~3단원", "2학기 6단원", "2학기 6단원", "2학기 6단원")),
  12: row(elemAll("2학기 4~5단원", "2학기 7단원", "2학기 7단원", "2학기 7단원")),
};

/** 학년 문자열 → KTC 표 학년키(초1~중3). 못 읽거나 범위 밖(고등 등)이면 null. */
function gradeKey(grade: string): GKey | null {
  const p = parseGrade(grade);
  if (!p || p.n < 1) return null;
  if (p.div === "초" && p.n <= 6) return (`초${p.n}` as GKey);
  if (p.div === "중" && p.n <= 3) return (`중${p.n}` as GKey);
  return null; // 고등은 KTC 표에 없음
}

/** 시험일·학년 → KTC 경시 범위(없으면 ''). */
export function ktcRange(grade: string, dateStr: string): string {
  const gk = gradeKey(grade);
  if (!gk) return "";
  const month = parseD(dateStr).getMonth() + 1;
  const r = KTC_TABLE[month]?.[gk] ?? "";
  return r === "-" ? "" : r;
}

/** 그 달에서 같은 요일의 2번째 날 = KTC 경시일(예: 2번째 수요일). */
function isCompetitionDate(dateStr: string): boolean {
  const day = parseD(dateStr).getDate();
  return Math.floor((day - 1) / 7) + 1 === 2;
}

/** 이번 주 월요일(로컬). */
function mondayOfWeek(dateStr: string): Date {
  const d = parseD(dateStr);
  const offset = (d.getDay() + 6) % 7; // 월=0
  d.setDate(d.getDate() - offset);
  return d;
}

/** 학생의 시험요일 — 수/목 중 먼저 오는 날(수 우선). 둘 다 안 다니면 null. */
export function testDayOf(s: Student, dateStr: string): "수" | "목" | null {
  const ls = effectiveLessons(s, dateStr);
  if (ls.some((l) => l.day === "수")) return "수";
  if (ls.some((l) => l.day === "목")) return "목";
  return null;
}

/** 반복 시험 예약 규칙. weekly=매주(요일 auto=학생 등원 수/목, 또는 고정 요일), ktc=그 달 2번째 수/목(경시·단원 자동). */
export interface TestRuleLite { id: string; name: string; kind: "weekly" | "ktc"; studentIds: string[]; active: boolean; day?: string; range?: string; until?: string; wom?: string; }

/** 그 달에서 같은 요일의 N번째 날인지(1~5). */
function nthOfWeekday(dateStr: string): number { return Math.floor((parseD(dateStr).getDate() - 1) / 7) + 1; }

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];
/** 규칙의 그 주 시험요일(0=일..6=토)과 학생 등원 여부 → 시험 날짜. 못 잡으면 null. */
function ruleDateOf(s: Student, weekMon: Date, rule: TestRuleLite): string | null {
  const day = rule.day && rule.day !== "auto" ? rule.day : testDayOf(s, ymd(weekMon)); // 고정 요일 또는 등원 수/목
  if (!day) return null;
  const idx = DOW_KO.indexOf(day);
  if (idx < 0) return null;
  const offset = (idx + 6) % 7; // 월=0 기준
  const date = ymd(addDays(weekMon, offset));
  // 고정 요일이면 그 요일에 실제 등원하는 학생만(시간표에 그 요일 있음).
  if (rule.day && rule.day !== "auto" && !effectiveLessons(s, date).some((l) => l.day === day)) return null;
  return date;
}

const resv = (studentId: string, date: string, type: string, range: string): TestLog => ({
  id: uid(), studentId, date, type, round: weekOfMonthLabel(date), range,
  score: 0, status: "예정", memo: "", scoreMode: "score", scoreNum: 0, scoreDen: 100,
});

/** 그 날짜가 속한 주(월요일) 키 — 멱등 비교용. */
function weekKey(studentId: string, date: string, type: string): string {
  return `${studentId}|${ymd(mondayOfWeek(date))}|${type}`;
}
/** 그 달 말일(yyyy-mm-dd) — 기본 생성 범위는 '이번 달'까지. */
function endOfMonthStr(dateStr: string): string {
  const d = parseD(dateStr);
  return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * 규칙대로 '이번 달(또는 throughDate)'까지의 테스트 예약(예정)을 계산. 학생은 등원 수/목 중 먼저 오는 날에 본다.
 *  - weekly 규칙: 매주 그 학생 시험요일에 규칙 이름으로 예약(경시 주에는 건너뜀 — 그 주는 KTC가 대신).
 *  - ktc 규칙: 그 달 2번째 수/목에만 'KTC수학경시대회'로 예약, 단원은 학년·월 표에서 자동.
 * 멱등은 **주 단위**(학생|그 주 월요일|종류) — 요일을 바꿔 날짜가 달라져도 한 주에 한 건만(중복 방지).
 */
export function planFromRules(rules: TestRuleLite[], studentsById: Map<string, Student>, existing: TestLog[], throughDate?: string): TestLog[] {
  const today = todayStr();
  const cutoff = throughDate || endOfMonthStr(today); // 기본: 이번 달 말일까지
  const weeksAhead = 6; // 한 달이면 충분
  const seen = new Set(existing.map((t) => weekKey(t.studentId, t.date, t.type)));
  const created: TestLog[] = [];
  const baseMon = mondayOfWeek(today);
  const add = (rec: TestLog) => { const k = weekKey(rec.studentId, rec.date, rec.type); if (!seen.has(k)) { seen.add(k); created.push(rec); } };
  for (const rule of rules) {
    if (!rule.active) continue;
    for (const sid of rule.studentIds) {
      const s = studentsById.get(sid);
      if (!s) continue;
      for (let w = 0; w < weeksAhead; w++) {
        const weekMon = addDays(baseMon, w * 7);
        if (rule.kind === "ktc") {
          // KTC는 학생 등원 수/목 기준(고정요일 무시) — 그 달 2번째 수/목에만.
          const day = testDayOf(s, ymd(weekMon));
          if (!day) continue;
          const testDate = ymd(addDays(weekMon, day === "수" ? 2 : 3));
          if (testDate < today || testDate > cutoff) continue;
          if (isCompetitionDate(testDate)) add(resv(sid, testDate, KTC_TYPE, ktcRange(s.grade, testDate)));
        } else {
          const testDate = ruleDateOf(s, weekMon, rule);
          if (!testDate || testDate < today || testDate > cutoff) continue;
          if (rule.until && testDate > rule.until) continue; // 반복 마감일 지나면 중단
          if (rule.wom && rule.wom !== "every" && nthOfWeekday(testDate) !== Number(rule.wom)) continue; // 특정 주차만
          if (!isCompetitionDate(testDate)) add(resv(sid, testDate, rule.name.trim() || WEEKLY_TYPE, (rule.range || "").trim())); // 경시 주는 KTC가 대신
        }
      }
    }
  }
  return created;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
