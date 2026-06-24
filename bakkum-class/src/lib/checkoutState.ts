// 하원(카드를 맨 아래로 접기) 상태 — 화면 전용 UI 상태지만, 새로고침해도 그날 분은 유지한다.
// 날짜별로 localStorage에 저장. scope로 화면(math/eng-mid 등)을 구분.
import { parseD, ymd } from "./dates";
import { messageApi } from "./messageApi";

const PREFIX = "checkout-out:";
const keyFor = (scope: string, day: string) => `${PREFIX}${scope}:${day}`;

/** 하원 누를 때 그 학생에게 '하원해도 좋아요' 알림 1줄 — 같은 날 학생당 1회만(중복 방지). */
export function notifyCheckoutOnce(studentId: string, name: string, day: string): void {
  const id = String(studentId || "").trim();
  if (!id) return;
  const k = "co-notified:" + day;
  let sent: string[] = [];
  try { sent = JSON.parse(localStorage.getItem(k) || "[]"); } catch { /* ignore */ }
  if (sent.includes(id)) return;
  sent.push(id);
  try { localStorage.setItem(k, JSON.stringify(sent)); } catch { /* ignore */ }
  void messageApi.notifyCheckout(id, name).catch(() => { /* 알림 실패는 하원 동작에 영향 없음 */ });
}

export function loadCheckout(scope: string, day: string): Set<string> {
  try {
    const raw = localStorage.getItem(keyFor(scope, day));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveCheckout(scope: string, day: string, set: Set<string>) {
  try {
    if (set.size) localStorage.setItem(keyFor(scope, day), JSON.stringify([...set]));
    else localStorage.removeItem(keyFor(scope, day));
  } catch {
    /* 저장 실패는 무시 — 화면 정렬용 상태라 치명적이지 않음 */
  }
}

// 오래된 날짜 키 자동 정리 — keepDays(기본 7일)보다 오래된 하원 상태는 지운다.
// 하원은 그날 하루용이라 지나간 날짜 키는 남겨둘 이유가 없다(매일 쌓이는 키 누적 방지).
export function pruneCheckout(today: string, keepDays = 7) {
  try {
    const cutoff = parseD(today);
    cutoff.setDate(cutoff.getDate() - keepDays);
    const cutoffStr = ymd(cutoff); // YYYY-MM-DD는 문자열 비교로 날짜 순서가 맞다.
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const day = k.slice(k.lastIndexOf(":") + 1);
      if (day < cutoffStr) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* 무시 — 정리 실패가 기능을 막지 않도록 */
  }
}
