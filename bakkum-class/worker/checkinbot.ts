/// <reference types="@cloudflare/workers-types" />
// 등하원 알림봇 — 매분 크론으로 '오늘 유효 시간표'를 보고 등원/하원10분전/하원 시점에 카카오워크 발송.
// 봇: 수학(초·중고) / 초등영어 / 중고등영어(브릿지 포함) — 등원·하원10분전·하원 / 데스크 — 등원만(영수겹치면 가장 이른 시각, 이름에 학년).
// 유효 시간표 = 기본 슬롯(class_lessons·class_eng_lessons) ± 시간변경(class_change_reqs) + 보강(class_makeups·class_eng_makeup).
// 공통: 재원생만, 휴원일(class_events 휴원) 전체 스킵, 같은 봇·시점·시각이면 한 알림으로 묶음(중복 1일 1회).

import type { Env } from "./index";
import { sendKakao } from "./kakao";

type Bot = "math" | "eng_elem" | "eng_mid" | "desk";
const HOOK_KEY: Record<Bot, string> = { math: "secret_kakao_hook_math", eng_elem: "secret_kakao_hook_eng_elem", eng_mid: "secret_kakao_hook_eng_mid", desk: "secret_kakao_hook_desk" };
const BOT_LABEL: Record<Bot, string> = { math: "수학", eng_elem: "초등영어", eng_mid: "중고등영어", desk: "데스크" };
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function p2(n: number): string { return String(n).padStart(2, "0"); }
function kstNow() {
  const d = new Date(Date.now() + 9 * 3600000);
  return { date: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`, dow: DOW[d.getUTCDay()], minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function hmToMin(t: string): number { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; }
// "오후 5시 40분"(정시면 분 생략).
function koTime(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  const ap = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}시${m ? ` ${m}분` : ""}`;
}
async function cfg(env: Env, k: string): Promise<string> {
  try { const r = await env.DB.prepare("SELECT v FROM class_config WHERE k=?").bind(k).first<{ v: string }>(); return String(r?.v ?? ""); } catch { return ""; }
}
async function allRows<T = Record<string, unknown>>(env: Env, sql: string, ...bind: unknown[]): Promise<T[]> {
  try { const r = await env.DB.prepare(sql).bind(...bind).all<T>(); return r.results || []; } catch { return []; }
}

interface Eff { sid: string; subject: "math" | "english"; start: number; end: number; makeup: boolean }

export async function runCheckinAlerts(env: Env, opts?: { atMinutes?: number; dry?: boolean }): Promise<{ bot: Bot; kind: string; time: string; names: string[] }[]> {
  const now = kstNow();
  const date = now.date, dow = now.dow;
  const minutes = opts?.atMinutes ?? now.minutes;
  const dry = !!opts?.dry;
  const out: { bot: Bot; kind: string; time: string; names: string[] }[] = [];

  await env.DB.prepare("CREATE TABLE IF NOT EXISTS class_bot_sent (k TEXT PRIMARY KEY, at INTEGER NOT NULL DEFAULT 0)").run().catch(() => {});

  // 휴원일이면 전체 스킵.
  const hol = await env.DB.prepare("SELECT 1 AS x FROM class_events WHERE category='휴원' AND date<=? AND (CASE WHEN end_date='' THEN date ELSE end_date END)>=? LIMIT 1").bind(date, date).first().catch(() => null);
  if (hol) return out;

  // 학생: 재원생만. 이름·학년.
  const stuRows = await allRows<{ id: string | number; name: string; grade: string; status: string }>(env, "SELECT id, name, grade, status FROM students");
  const stu: Record<string, { name: string; grade: string }> = {};
  for (const s of stuRows) if (s.status === "재원") stu[String(s.id)] = { name: String(s.name || ""), grade: String(s.grade || "") };
  const metaRows = await allRows<{ student_id: string; english_band: string }>(env, "SELECT student_id, english_band FROM class_student_meta");
  const band: Record<string, string> = {};
  for (const m of metaRows) band[String(m.student_id)] = String(m.english_band || "");

  // 유효 슬롯(키: sid|subject|startMin). 재원생만.
  const slots = new Map<string, Eff>();
  const dur: Record<string, number> = {};
  const key = (sid: string, subj: string, start: number) => `${sid}|${subj}|${start}`;
  function add(sid: string, subject: "math" | "english", start: number, duration: number, makeup: boolean) {
    if (start < 0 || !stu[sid]) return;
    slots.set(key(sid, subject, start), { sid, subject, start, end: start + (duration > 0 ? duration : (subject === "math" ? 60 : 50)), makeup });
  }
  function remove(sid: string, subject: string, start: number) { slots.delete(key(sid, subject, start)); }

  // 1) 기본 시간표(오늘 요일).
  for (const r of await allRows<{ student_id: string; time: string; duration: number }>(env, "SELECT student_id, time, duration FROM class_lessons WHERE day=?", dow)) {
    const sid = String(r.student_id); dur[`${sid}|math`] ??= Number(r.duration) || 0;
    add(sid, "math", hmToMin(r.time), Number(r.duration) || 0, false);
  }
  for (const r of await allRows<{ student_id: string; time: string; duration: number }>(env, "SELECT student_id, time, duration FROM class_eng_lessons WHERE day=?", dow)) {
    const sid = String(r.student_id); dur[`${sid}|english`] ??= Number(r.duration) || 0;
    add(sid, "english", hmToMin(r.time), Number(r.duration) || 0, false);
  }

  // 2) 시간 변경(승인·즉시기록). to_date=오늘 → 추가, from_date=오늘 → 원래 시각 제거.
  for (const c of await allRows<{ student_id: string; subject: string; from_time: string; to_time: string; from_date: string; to_date: string }>(
    env, "SELECT student_id, subject, from_time, to_time, from_date, to_date FROM class_change_reqs WHERE (status='approved' OR status='logged') AND (from_date=? OR to_date=?)", date, date)) {
    const sid = String(c.student_id); const subject = c.subject === "english" ? "english" : "math";
    if (c.from_date === date) remove(sid, subject, hmToMin(c.from_time));
    if (c.to_date === date) add(sid, subject, hmToMin(c.to_time), dur[`${sid}|${subject}`] || 0, false);
  }

  // 3) 보강(오늘). 수학=scheduled, 영어=예정. makeup=true.
  for (const m of await allRows<{ student_id: string; makeup_time: string; makeup_duration: number }>(env, "SELECT student_id, makeup_time, makeup_duration FROM class_makeups WHERE makeup_date=? AND status='scheduled'", date))
    add(String(m.student_id), "math", hmToMin(m.makeup_time), Number(m.makeup_duration) || 0, true);
  for (const m of await allRows<{ student_id: string; makeup_time: string }>(env, "SELECT student_id, makeup_time FROM class_eng_makeup WHERE makeup_date=? AND status='예정'", date))
    add(String(m.student_id), "english", hmToMin(m.makeup_time), dur[`${String(m.student_id)}|english`] || 0, true);

  const botOf = (e: Eff): Bot => e.subject === "math" ? "math" : (band[e.sid] === "elem" ? "eng_elem" : "eng_mid");

  // 그룹(키: bot|kind|시각) → 이름(표시용) 목록.
  type Kind = "arrive" | "pre" | "leave";
  const groups = new Map<string, { bot: Bot; kind: Kind; time: number; names: string[] }>();
  const push = (bot: Bot, kind: Kind, time: number, name: string) => {
    const k = `${bot}|${kind}|${time}`;
    const g = groups.get(k) || { bot, kind, time, names: [] };
    g.names.push(name); groups.set(k, g);
  };
  const tag = (sid: string, makeup: boolean) => stu[sid].name + (makeup ? "(보강)" : "");

  // 과목 봇 — 등원/하원10분전/하원.
  for (const e of slots.values()) {
    const bot = botOf(e);
    if (e.start === minutes) push(bot, "arrive", e.start, tag(e.sid, e.makeup));
    if (e.end - 10 === minutes) push(bot, "pre", e.end, tag(e.sid, e.makeup));
    if (e.end === minutes) push(bot, "leave", e.end, tag(e.sid, e.makeup));
  }

  // 데스크 봇 — 등원만. 영수 겹치면 학생당 '가장 이른' 슬롯 하나. 이름에 학년(+보강).
  const firstBy = new Map<string, Eff>();
  for (const e of slots.values()) { const cur = firstBy.get(e.sid); if (!cur || e.start < cur.start) firstBy.set(e.sid, e); }
  for (const e of firstBy.values()) {
    if (e.start !== minutes) continue;
    const g = stu[e.sid].grade;
    const label = stu[e.sid].name + (g || e.makeup ? `(${[g, e.makeup ? "보강" : ""].filter(Boolean).join("·")})` : "");
    push("desk", "arrive", e.start, label);
  }

  if (groups.size === 0) return out;

  const hooks: Partial<Record<Bot, string>> = {};
  for (const bot of ["math", "eng_elem", "eng_mid", "desk"] as Bot[]) hooks[bot] = await cfg(env, HOOK_KEY[bot]);

  for (const g of groups.values()) {
    const names = g.names.join(", ");
    out.push({ bot: g.bot, kind: g.kind, time: koTime(g.time), names: g.names });
    if (dry) continue;
    const webhook = hooks[g.bot];
    if (!webhook) continue;
    const dedupe = `${date}|${g.bot}|${g.kind}|${g.time}`;
    const exist = await env.DB.prepare("SELECT 1 AS x FROM class_bot_sent WHERE k=?").bind(dedupe).first().catch(() => null);
    if (exist) continue;
    const n = g.names.length, t = koTime(g.time), label = BOT_LABEL[g.bot];
    // 파란 헤더 = 과목+시점 안내. 본문 = 한 줄 요약 + (빈 줄) + 학생/시간 라벨 정렬.
    let header = "", lead = "", timeLabel = "";
    if (g.kind === "arrive") { header = `${label} 등원 안내`; lead = `등원 시간입니다 · ${n}명`; timeLabel = "등원 시간"; }
    else if (g.kind === "pre") { header = `${label} 하원 10분 전 안내`; lead = `하원 10분 전입니다 · ${n}명`; timeLabel = "하원 예정"; }
    else { header = `${label} 하원 안내`; lead = `하원 시간입니다 · ${n}명`; timeLabel = "하원 시간"; }
    const text = `${lead}\n\n학생: ${names}\n${timeLabel}: ${t}`;
    const res = await sendKakao({ KAKAO_WEBHOOK_URL: webhook }, text, undefined, header).catch((e) => ({ sent: false, reason: String(e) }));
    await env.DB.prepare("INSERT OR IGNORE INTO class_bot_sent(k, at) VALUES(?,?)").bind(dedupe, Date.now()).run().catch(() => {});
    if (!res.sent) console.error("checkin alert send failed", dedupe, res.reason);
  }
  return out;
}
