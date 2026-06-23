// 수학 야구(수학 전광판) — 스트라이크·볼·아웃 점수 계산 공용 로직.
// 학생 화면·선생님 화면·워커가 "같은 함수"로 계산해 결과가 절대 어긋나지 않게 한다.
// (React/DOM 의존 없음 — 워커에서도 import 해서 그대로 쓴다.)

/* ───────────────────────── 규칙(벌·상 항목) ───────────────────────── */

export type RuleKind = "strike" | "ball"; // strike=벌(스트라이크) / ball=상(볼)

// 자동 인식 출처. 'manual'은 선생님이 직접 줄 때만(자동 인식 안 함).
export type RuleTrigger =
  | "att:지각"
  | "att:무단결석"
  | "att:결석"
  | "att:조퇴"
  | "att:attitude_미흡"
  | "hw:late" // 숙제 지연(status=late)
  | "hw:low" // 숙제 완성도 임계 이하
  | "manual";

export interface BaseballRule {
  id: string;
  kind: RuleKind;
  label: string; // 예: '무단결석', '추가숙제'
  points: number; // 더해질 스트라이크/볼 개수
  trigger: RuleTrigger; // 자동 인식 출처('manual'=수동)
  threshold?: number; // hw:low 완성도 임계(<=). 기본 50
  enabled: boolean;
  sort: number;
}

/** 처음 켤 때 들어가는 기본 규칙(선생님이 화면에서 추가·수정·삭제 가능). */
export const DEFAULT_RULES: BaseballRule[] = [
  { id: "r_truancy", kind: "strike", label: "무단결석", points: 1, trigger: "att:무단결석", enabled: true, sort: 1 },
  { id: "r_late", kind: "strike", label: "지각", points: 1, trigger: "att:지각", enabled: true, sort: 2 },
  { id: "r_attitude", kind: "strike", label: "수업태도 미흡", points: 1, trigger: "att:attitude_미흡", enabled: true, sort: 3 },
  { id: "r_hwlate", kind: "strike", label: "숙제 지연", points: 1, trigger: "hw:late", enabled: true, sort: 4 },
  { id: "r_hwlow", kind: "strike", label: "숙제 50%이하", points: 1, trigger: "hw:low", threshold: 50, enabled: true, sort: 5 },
  { id: "b_extrahw", kind: "ball", label: "추가숙제", points: 1, trigger: "manual", enabled: true, sort: 1 },
  { id: "b_self", kind: "ball", label: "자진등원", points: 1, trigger: "manual", enabled: true, sort: 2 },
  { id: "b_score", kind: "ball", label: "성적향상", points: 2, trigger: "manual", enabled: true, sort: 3 },
  { id: "b_model", kind: "ball", label: "모범태도", points: 1, trigger: "manual", enabled: true, sort: 4 },
];

/* ───────────────────────── 기준값(설정) ───────────────────────── */

export interface BaseballConfig {
  strikesPerOut: number; // 스트라이크 몇 개면 아웃 1개 (3)
  ballsToClearOut: number; // 볼 몇 개면 아웃 1개 삭제 (4)
  outsForMakeup: number; // 아웃 몇 개면 보충 대상 (3)
  dailyBallCap: number; // 볼 하루 적립 한도 (2)
  monthlyReset: boolean; // 매월 1일 S·B·O 초기화 (true)
  since: string; // 이 날짜 이후 기록만 카운트(YYYY-MM-DD, ''=제한없음)
}

export const DEFAULT_BASEBALL_CONFIG: BaseballConfig = {
  strikesPerOut: 3,
  ballsToClearOut: 4,
  outsForMakeup: 3,
  dailyBallCap: 2,
  monthlyReset: true,
  since: "",
};

/* ───────────────────────── 이벤트(수동 조정/볼/보충확인) ───────────────────────── */

export type EventKind =
  | "ball" // 볼 주기(+상)
  | "strike" // 수동 스트라이크(+벌)
  | "cancel_strike" // 스트라이크 취소(-)
  | "exempt_out" // 아웃 면제(-)
  | "makeup_done" // 보충 완료(보충 대상 해제)
  | "ignore_auto"; // 자동 인식 스트라이크 1건 무효화(억울한 경우)

export interface BaseballEvent {
  id: string;
  studentId: string;
  kind: EventKind;
  points: number; // 가중치(ball +1/+2, strike +1, cancel/exempt -1, 나머지 0)
  label: string; // 사유(규칙 라벨 또는 메모 제목)
  ref?: string; // ignore_auto일 때 무효화할 자동트리거 id
  memo?: string;
  ts: number; // 효력 시각(ms) — 타임라인 정렬
  by?: string; // 누가
  createdAt: number;
}

/* ───────────────────────── 자동 인식 스트라이크(출결·숙제에서 파생) ───────────────────────── */

export interface AttEntry {
  attKey: string; // "YYYY-MM-DD|studentId|HH:MM"
  studentId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  status: string; // 출석|지각|결석|조퇴|무단결석|보강
  attitude: string; // 매우좋음|보통|미흡|''
}
export interface HwEntry {
  id: string;
  studentId: string;
  date: string; // YYYY-MM-DD
  completion: number; // 0..100
  status: string; // done|late|pending
}

export interface AutoStrike {
  id: string; // 안정적 파생 id (ignore_auto의 ref로 씀)
  studentId: string;
  ruleId: string;
  label: string;
  points: number;
  date: string;
  ts: number;
}

const KST = "+09:00";
function dayTs(date: string, time: string): number {
  const t = (time && /^\d{1,2}:\d{2}$/.test(time)) ? time : "00:00";
  const ms = Date.parse(`${date}T${t.padStart(5, "0")}:00${KST}`);
  return Number.isNaN(ms) ? 0 : ms;
}
function monthOf(ts: number): string {
  // KST 기준 YYYY-MM
  const d = new Date(ts + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 7);
}

/** 출결·숙제 기록 → 자동 스트라이크 목록(규칙 기반).
 *  한 기록(출결 1건·숙제 1건)당 스트라이크는 "최대 1개" — 가장 우선(sort 작은) 규칙 하나만 적용.
 *  (예: 지연이면서 50%이하인 숙제도 두 번 세지 않고 한 번만.) since 이전은 제외. */
export function deriveAutoStrikes(att: AttEntry[], hw: HwEntry[], rules: BaseballRule[], cfg: BaseballConfig): AutoStrike[] {
  const out: AutoStrike[] = [];
  const since = cfg.since || "";
  const strikeRules = rules.filter((r) => r.kind === "strike" && r.enabled).slice().sort((a, b) => a.sort - b.sort);
  for (const a of att) {
    if (since && a.date < since) continue;
    const r = strikeRules.find((r) => (r.trigger === "att:attitude_미흡" ? a.attitude === "미흡" : r.trigger.startsWith("att:") ? a.status === r.trigger.slice(4) : false));
    if (!r) continue;
    out.push({
      id: `auto|att|${a.attKey}|${r.id}`,
      studentId: a.studentId,
      ruleId: r.id,
      label: r.label,
      points: Math.max(1, r.points || 1),
      date: a.date,
      ts: dayTs(a.date, a.time) || dayTs(a.date, "09:00"),
    });
  }
  for (const h of hw) {
    if (since && h.date < since) continue;
    const r = strikeRules.find((r) => (r.trigger === "hw:late" ? h.status === "late" : r.trigger === "hw:low" ? h.status !== "pending" && h.completion <= (r.threshold ?? 50) : false));
    if (!r) continue;
    out.push({
      id: `auto|hw|${h.id}|${r.id}`,
      studentId: h.studentId,
      ruleId: r.id,
      label: r.label,
      points: Math.max(1, r.points || 1),
      date: h.date,
      ts: dayTs(h.date, "20:00"),
    });
  }
  return out;
}

/* ───────────────────────── 전광판 계산 ───────────────────────── */

export type BoardStatus = "clean" | "good" | "warn" | "makeup";
export type RecentTone = "strike" | "ball" | "minus" | "makeup" | "honey";

export interface BoardRecent {
  date: string;
  tone: RecentTone;
  label: string;
  delta: string; // 예: 'S +1', '볼 +1', '아웃 -1'
  round: number; // 이 기록이 속한 회차(1부터)
}

export interface MathBoard {
  studentId: string;
  S: number;
  B: number;
  O: number;
  penaltyRounds: number; // 쓰리아웃으로 초기화된 누적 횟수(보충 N회차)
  pendingMakeup: boolean; // 현재 보충 대상(아직 보충 안 함)
  honey: number; // 아웃이 없을 때 볼 4개가 꿀로 전환된 누적
  status: BoardStatus;
  monthLabel: string; // 이번 달 YYYY-MM
  goal: string; // 학생용 한 줄 목표 안내
  recent: BoardRecent[]; // 최근 8건(요약)
  history: BoardRecent[]; // 전체 기록(회차별 '기록 보기'용, 최신순, 최대 120건)
}

type Item =
  | { ts: number; date: string; t: "strike"; points: number; label: string }
  | { ts: number; date: string; t: "ball"; points: number; label: string }
  | { ts: number; date: string; t: "cancel"; points: number; label: string }
  | { ts: number; date: string; t: "exempt"; points: number; label: string }
  | { ts: number; date: string; t: "makeup"; points: number; label: string };

/** 자동 스트라이크 + 이벤트 → 현재 전광판. 타임라인을 시간순으로 처리한다. */
export function computeBoard(studentId: string, autoStrikes: AutoStrike[], events: BaseballEvent[], cfg: BaseballConfig = DEFAULT_BASEBALL_CONFIG): MathBoard {
  // 무효화된 자동 스트라이크 id 집합
  const ignored = new Set<string>();
  for (const e of events) if (e.kind === "ignore_auto" && e.ref) ignored.add(e.ref);

  const items: Item[] = [];
  for (const a of autoStrikes) {
    if (ignored.has(a.id)) continue;
    items.push({ ts: a.ts, date: a.date, t: "strike", points: a.points, label: a.label });
  }
  for (const e of events) {
    const date = new Date(e.ts + 9 * 3600 * 1000).toISOString().slice(0, 10);
    if (e.kind === "ball") items.push({ ts: e.ts, date, t: "ball", points: Math.max(1, e.points || 1), label: e.label });
    else if (e.kind === "strike") items.push({ ts: e.ts, date, t: "strike", points: Math.max(1, e.points || 1), label: e.label });
    else if (e.kind === "cancel_strike") items.push({ ts: e.ts, date, t: "cancel", points: Math.max(1, e.points || 1), label: e.label });
    else if (e.kind === "exempt_out") items.push({ ts: e.ts, date, t: "exempt", points: Math.max(1, e.points || 1), label: e.label });
    else if (e.kind === "makeup_done") items.push({ ts: e.ts, date, t: "makeup", points: 0, label: e.label });
  }
  items.sort((a, b) => a.ts - b.ts || (a.t === "ball" ? 1 : 0) - (b.t === "ball" ? 1 : 0));

  let S = 0, B = 0, O = 0, honey = 0;
  let pendingMakeup = false;
  let curMonth = "";
  let round = 1; // 현재 회차(1부터). 쓰리아웃으로 초기화될 때마다 +1.
  const ballByDay: Record<string, number> = {};
  const recent: BoardRecent[] = [];
  const rec = (e: Omit<BoardRecent, "round">) => recent.push({ ...e, round });

  for (const it of items) {
    const mon = monthOf(it.ts);
    if (cfg.monthlyReset && curMonth && mon !== curMonth) {
      // 매월 S·B·O 초기화. 회차·꿀·보충대기는 유지.
      S = 0; B = 0; O = 0;
    }
    curMonth = mon;

    if (it.t === "strike") {
      S += it.points;
      rec({ date: it.date, tone: "strike", label: it.label, delta: `스트라이크 +${it.points}` });
      while (S >= cfg.strikesPerOut) {
        S -= cfg.strikesPerOut;
        O += 1;
        rec({ date: it.date, tone: "strike", label: "스트라이크 3개 → 아웃", delta: "아웃 +1" });
        if (O >= cfg.outsForMakeup) {
          rec({ date: it.date, tone: "makeup", label: `${round}회차 쓰리아웃 — 보충 대상`, delta: "쓰리아웃" });
          O = 0; pendingMakeup = true; round += 1;
        }
      }
    } else if (it.t === "ball") {
      const used = ballByDay[it.date] || 0;
      const room = Math.max(0, cfg.dailyBallCap - used);
      const add = Math.max(0, Math.min(it.points, room));
      ballByDay[it.date] = used + add;
      if (add > 0) {
        B += add;
        rec({ date: it.date, tone: "ball", label: it.label, delta: `볼 +${add}` });
        while (B >= cfg.ballsToClearOut) {
          B -= cfg.ballsToClearOut;
          if (O > 0) { O -= 1; rec({ date: it.date, tone: "minus", label: "볼 4개 적립", delta: "아웃 -1" }); }
          else if (S > 0) { S -= 1; rec({ date: it.date, tone: "minus", label: "볼 4개 적립", delta: "스트라이크 -1" }); }
          else { honey += 1; rec({ date: it.date, tone: "honey", label: "볼 4개 → 꿀 전환", delta: "꿀 +1" }); }
        }
      }
    } else if (it.t === "cancel") {
      S = Math.max(0, S - it.points);
      rec({ date: it.date, tone: "minus", label: it.label || "스트라이크 취소", delta: `스트라이크 -${it.points}` });
    } else if (it.t === "exempt") {
      O = Math.max(0, O - it.points);
      pendingMakeup = false;
      rec({ date: it.date, tone: "minus", label: it.label || "아웃 면제", delta: `아웃 -${it.points}` });
    } else if (it.t === "makeup") {
      pendingMakeup = false;
      rec({ date: it.date, tone: "makeup", label: it.label || "보충 완료", delta: "보충 ✓" });
    }
  }

  // 이번 달이 마지막 처리 월과 다르면(이번 달 들어 기록 없음) 초기화 반영
  const nowMonth = monthOf(Date.now());
  if (cfg.monthlyReset && curMonth && nowMonth !== curMonth) { S = 0; B = 0; O = 0; }
  const penaltyRounds = round - 1; // 누적 보충(쓰리아웃 초기화) 횟수

  const status: BoardStatus = pendingMakeup ? "makeup" : O >= 1 || S >= cfg.strikesPerOut - 1 ? "warn" : S > 0 || B > 0 || O > 0 ? "good" : "clean";

  let goal: string;
  if (pendingMakeup) goal = "지금은 보충 대상이에요. 볼을 모아 만회해 봐요!";
  else if (O > 0) goal = `볼 ${Math.max(1, cfg.ballsToClearOut - B)}개만 더 모으면 아웃 하나가 사라져요!`;
  else if (S >= cfg.strikesPerOut - 1) goal = "스트라이크 하나만 더 쌓이면 아웃이에요. 조심!";
  else if (S > 0) goal = "볼을 모으면 스트라이크를 지울 수 있어요.";
  else goal = "아직 깨끗해요. 이대로 가요!";

  return {
    studentId,
    S, B, O,
    penaltyRounds,
    pendingMakeup,
    honey,
    status,
    monthLabel: nowMonth,
    goal,
    recent: recent.slice(-8).reverse(),
    history: recent.slice().reverse().slice(0, 120),
  };
}

/* ───────────────────────── 정규화 헬퍼(클라 스냅샷용) ───────────────────────── */

/** 수학 스냅샷의 attendance(Record<key,rec>) → AttEntry[] (한 학생). */
export function attEntriesFor(attendance: Record<string, { status: string; attitude?: string }>, studentId: string): AttEntry[] {
  const out: AttEntry[] = [];
  for (const [key, rec] of Object.entries(attendance || {})) {
    const parts = key.split("|");
    if (parts[1] !== studentId) continue;
    out.push({ attKey: key, studentId, date: parts[0] || "", time: parts[2] || "", status: rec.status || "", attitude: rec.attitude || "" });
  }
  return out;
}

/** 상태 한글 라벨(뱃지). */
export function statusLabel(s: BoardStatus): string {
  return s === "makeup" ? "보충 대상" : s === "warn" ? "주의" : s === "good" ? "좋아요" : "깨끗해요";
}
