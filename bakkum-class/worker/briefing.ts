// 카카오워크 일일 브리핑(낮/밤) 메시지 조립 — 데이터는 만들지 않고 오늘자 스냅샷을 읽어 요약만 한다.
import type { DataSnapshot, Lesson, Student } from "../src/types";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** KST 기준 '오늘' 정보 (워커는 UTC라 +9h 보정). */
export function kstToday(): { date: string; M: number; D: number; dow: string; mmdd: string } {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  const d = kst.getUTCDate();
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  return { date: `${y}-${p(m)}-${p(d)}`, M: m, D: d, dow: DOW[kst.getUTCDay()], mmdd: `${p(m)}-${p(d)}` };
}

/* ---- 포팅한 순수 로직 (src/lib/logic.ts와 동일 규칙) ---- */
function effectiveLessons(s: Student, dateStr: string): Lesson[] {
  const hist = s.schedule;
  if (!hist || !hist.length) return s.lessons || [];
  let chosen: { from: string; lessons: Lesson[] } | null = null;
  for (const v of hist) if (v.from <= dateStr && (!chosen || v.from > chosen.from)) chosen = v;
  return chosen ? chosen.lessons : [];
}
function attendsOn(s: Student, dateStr: string): boolean {
  return !(s.startDate && dateStr < s.startDate);
}
function isActive(s: Student): boolean {
  return (s.status ?? "재원") === "재원";
}

interface Att {
  student: Student;
  time: string;
}

/** 그 날 정규 등원(휴일 가드는 호출부에서) — 시간순 정렬. */
function regularAttendees(snap: DataSnapshot, date: string, dow: string): Att[] {
  const list: Att[] = [];
  for (const s of snap.students) {
    if (!isActive(s) || !attendsOn(s, date)) continue;
    for (const l of effectiveLessons(s, date)) if (l.day === dow) list.push({ student: s, time: l.time });
  }
  list.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return list;
}

function studentById(snap: DataSnapshot, id: string): Student | undefined {
  return snap.students.find((s) => s.id === id);
}

/** 시간별로 묶어 한 줄씩: ["15:00  최다연", "16:30  민서준, 정시우"]. */
function attendLines(list: Att[]): string[] {
  const byTime: Record<string, string[]> = {};
  const order: string[] = [];
  for (const a of list) {
    if (!byTime[a.time]) { byTime[a.time] = []; order.push(a.time); }
    byTime[a.time].push(a.student.name);
  }
  return order.map((t) => `${t}  ${byTime[t].join(", ")}`);
}

function fmtMD(date: string): string {
  const p = date.split("-");
  return `${+p[1]}/${+p[2]}`;
}

/** 결과: 오늘 발송 대상 여부 + 낮/밤 메시지. */
export interface Briefing {
  hasClass: boolean;
  holiday: string | null;
  noon: string;
  night: string;
}

export function buildBriefing(snap: DataSnapshot, holiday: string | null): Briefing {
  const { date, M, D, dow } = kstToday();
  const reg = holiday ? [] : regularAttendees(snap, date, dow);
  const mkToday = snap.makeups.filter((k) => (k.status === "scheduled" || k.status === "done") && k.makeupDate === date);
  const hasClass = !holiday && (reg.length > 0 || mkToday.length > 0);

  /* ===== 낮 13:00 — 오늘 브리핑 ===== */
  const bdays = snap.students
    .filter((s) => isActive(s) && s.birthdate && s.birthdate.slice(5) === date.slice(5))
    .map((s) => s.name);
  // 숙제 검사 — 이름만 (학생 단위로 중복 제거)
  const checkHws = snap.homeworkLog.filter((h) => (h.recheckDate || h.date) === date && h.status !== "done");
  const checkSids = [...new Set(checkHws.map((h) => h.studentId))];
  const checkNames = checkSids.map((id) => studentById(snap, id)?.name || "?");
  // 오늘 보강
  const mkScheduled = mkToday.filter((k) => k.status === "scheduled");
  const mkLines = mkScheduled.length
    ? mkScheduled.map((k) => `${studentById(snap, k.studentId)?.name || "?"} ${k.makeupTime || ""}`.trim())
    : ["없음"];
  // 특이사항
  const special = noonSpecial(snap, date);

  const noon: string[] = [`[오늘 브리핑] ${M}월 ${D}일 (${dow})`, ""];
  if (bdays.length) noon.push(`생일 · ${bdays.join(", ")} (등원할 때 축하해 주세요)`, "");
  noon.push(`등원 ${reg.length}명`, ...(reg.length ? attendLines(reg) : ["없음"]), "");
  noon.push(`숙제 검사 ${checkSids.length}명`, checkSids.length ? checkNames.join(", ") : "없음", "");
  noon.push(`보강 예정`, ...mkLines, "");
  noon.push(`특이사항`, ...special);

  /* ===== 밤 21:00 — 오늘 수업 요약 ===== */
  // 출결을 인원수가 아니라 '누가'로 — 지각은 몇 분까지 표기
  const presentN: string[] = [];
  const lateN: string[] = [];
  const absentN: string[] = [];
  const absentIds = new Set<string>(); // 오늘 결석 학생 — 숙제 미흡 집계에서 제외용
  let unchecked = 0;
  for (const a of reg) {
    const rec = snap.attendance[`${date}|${a.student.id}|${a.time}`];
    if (!rec || !rec.status) { unchecked++; continue; }
    const nm = a.student.name;
    if (rec.status === "출석") presentN.push(nm);
    else if (rec.status === "지각") lateN.push(rec.lateMinutes ? `${nm} (${rec.lateMinutes}분)` : nm);
    else if (rec.status === "결석" || rec.status === "무단결석" || rec.status === "조퇴") {
      absentN.push(nm);
      absentIds.add(a.student.id);
    }
  }
  const pendingMk = snap.makeups.filter((k) => k.status === "pending");
  const mkTodoLines = pendingMk.length
    ? pendingMk.map((k) => `${studentById(snap, k.studentId)?.name || "?"} (${fmtMD(k.absentDate)} 결석)`)
    : ["없음"];
  // 숙제 미흡 — 오늘 검사 대상 중 완성도 50% 이하(또는 지연=안 해옴). 이름만, 학생당 1번.
  // 단, 오늘 결석한 학생은 검사 자체가 안 됐고 숙제가 자동으로 밀린 것이라 제외.
  const undoneByStu: Record<string, string> = {};
  for (const h of snap.homeworkLog) {
    if ((h.recheckDate || h.date) !== date) continue;
    if (absentIds.has(h.studentId)) continue;
    const bad = h.status === "late" || (h.completion ?? 0) <= 50;
    if (!bad) continue;
    if (undoneByStu[h.studentId]) continue;
    undoneByStu[h.studentId] = studentById(snap, h.studentId)?.name || "?";
  }
  const undoneN = Object.values(undoneByStu);

  // 오늘 보강 출석한 학생 (보강 완료 = done)
  const mkDoneN = mkToday
    .filter((k) => k.status === "done")
    .map((k) => studentById(snap, k.studentId)?.name || "?");

  const night: string[] = [`[오늘 수업 요약] ${M}월 ${D}일 (${dow})`, ""];
  night.push(`출결`);
  night.push(`출석  ${presentN.length ? presentN.join(", ") : "없음"}`);
  night.push(`지각  ${lateN.length ? lateN.join(", ") : "없음"}`);
  night.push(`결석  ${absentN.length ? absentN.join(", ") : "없음"}`);
  if (mkDoneN.length) night.push(`보강출석  ${mkDoneN.join(", ")}`);
  if (unchecked > 0) night.push(`미체크 ${unchecked}명 — 확인 필요`);
  if (undoneN.length) night.push("", `숙제 미흡`, undoneN.join(", "));
  night.push("", `보강 잡을 학생`, ...mkTodoLines);

  return { hasClass, holiday, noon: noon.join("\n").trimEnd(), night: night.join("\n").trimEnd() };
}

function noonSpecial(snap: DataSnapshot, date: string): string[] {
  const lines: string[] = [];
  const tests = snap.testLog.filter((t) => t.date === date);
  if (tests.length) {
    const byType: Record<string, number> = {};
    for (const t of tests) byType[t.type || "테스트"] = (byType[t.type || "테스트"] || 0) + 1;
    for (const [ty, n] of Object.entries(byType)) lines.push(`${ty} 테스트 ${n}명`);
  }
  const newbies = snap.students.filter((s) => {
    if ((s.status ?? "재원") !== "재원" || !s.startDate || s.startDate > date) return false;
    const diff = (Date.parse(date) - Date.parse(s.startDate)) / 86400000;
    return diff >= 0 && diff < 7;
  });
  if (newbies.length) lines.push(`신규 ${newbies.map((s) => s.name).join(", ")} 첫 주`);
  return lines.length ? lines : ["없음"];
}
