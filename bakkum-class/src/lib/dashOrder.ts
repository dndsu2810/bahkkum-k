// 대시보드 카드 표시 순서 — 등원(클릭) 순으로 쌓이고, 드래그로 재정렬. 날짜별 localStorage 저장.
// 영어(EngInputDash)·수학(TodayDashboard) 공용.
import { useCallback, useEffect, useState } from "react";

function loadOrder(key: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v.map(String) : []; }
  catch { return []; }
}

export function useDashOrder(scope: string, day: string) {
  const key = `bk_dashord_${scope}_${day}`;
  const [order, setOrder] = useState<string[]>(() => loadOrder(key));
  useEffect(() => { setOrder(loadOrder(key)); }, [key]);

  const persist = useCallback((ids: string[]) => {
    setOrder(ids);
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* ignore */ }
  }, [key]);

  /** 새 id를 맨 뒤에 추가(등원/추가 순서 기록). 이미 있으면 그대로. */
  const push = useCallback((id: string) => {
    setOrder((cur) => {
      if (cur.includes(id)) return cur;
      const next = [...cur, id];
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [key]);

  /** items를 저장된 순서대로 정렬(순서에 없는 새 항목은 원래 순서대로 뒤에). */
  const sortItems = useCallback(<T,>(items: T[], idOf: (x: T) => string): T[] => {
    const pos = new Map(order.map((id, i) => [id, i]));
    return items
      .map((x, i) => ({ x, p: pos.has(idOf(x)) ? (pos.get(idOf(x)) as number) : 1e9 + i }))
      .sort((a, b) => a.p - b.p)
      .map((o) => o.x);
  }, [order]);

  /** drag한 id를 over 위치 앞으로 이동(현재 보이는 ids 기준 재배치). */
  const move = useCallback((dragId: string, overId: string, presentIds: string[]) => {
    if (dragId === overId) return;
    const pos = new Map(order.map((id, i) => [id, i]));
    const base = [...presentIds].sort((a, b) => (pos.has(a) ? (pos.get(a) as number) : 1e9) - (pos.has(b) ? (pos.get(b) as number) : 1e9));
    const from = base.indexOf(dragId), to = base.indexOf(overId);
    if (from < 0 || to < 0) return;
    base.splice(to, 0, base.splice(from, 1)[0]);
    const rest = order.filter((id) => !presentIds.includes(id)); // 지금 안 보이는 기존 순서는 뒤에 보존
    persist([...base, ...rest]);
  }, [order, persist]);

  return { order, push, sortItems, move };
}
