// 교재·비품 주문 관리 API.

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}
async function jpost<T = { ok?: boolean; id?: string; error?: string }>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

export type OrderKind = "교재" | "비품";
export interface Order {
  id: string;
  kind: OrderKind;
  name: string;
  requester: string;
  requesterSub: string;
  needBy: string;
  studentIds: string[]; // 교재 대상 학생
  qty: number; // 비품 수량
  link: string; // 비품 구매 링크
  reason: string; // 비품 구매 사유
  forClass: string; // 비품 필요 수업
  place: string; // 비품 비치 위치
  purchased: boolean;
  shipped: boolean;
  distributedIds: string[]; // 교재 배부 완료된 학생
  placed: boolean; // 비품 비치 완료
  createdAt: number;
  updatedAt: number;
}

export const ordersApi = {
  list: () => jget<{ orders: Order[] }>("/api/orders").then((j) => j.orders),
  pendingCount: () => jget<{ pending: number }>("/api/orders/count").then((j) => j.pending),
  create: (o: Partial<Order>) => jpost("/api/orders", o),
  update: (patch: Partial<Order> & { id: string }) => jpost("/api/orders/update", patch),
  remove: (id: string) => jpost("/api/orders/delete", { id }),
};
