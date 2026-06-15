// 노션 → 앱: 모든 연결을 한 번에 가져오기(설정의 단일 버튼).
// 워커 타임아웃을 피하려고 각 항목을 클라이언트에서 순차 호출하고 진행 상황을 콜백으로 알린다.
// 중복은 각 가져오기 엔드포인트가 알아서 건너뛰거나 갱신한다(추가된 것만 늘어남).
// ⚠️ 수학 출결·숙제·진도·테스트는 여기 넣지 않는다 — 앱이 단일 출처라 재가져오기 시
//    보강 예약이 '대기'로 리셋되고 진도가 중복된다. 그건 설정의 '최초 1회' 버튼에서만.

export interface SyncStep {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  count: number;
  error?: string;
}

async function jpost(url: string): Promise<Record<string, number> & { error?: string }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const j = (await r.json().catch(() => ({}))) as Record<string, number> & { error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}
async function jget(url: string): Promise<Record<string, number> & { error?: string }> {
  const r = await fetch(url, { cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as Record<string, number> & { error?: string };
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

// 가져오기 단계 정의 — 순서대로 실행. count는 응답에서 "들어온 건수"를 뽑는다.
const STEPS: { key: string; label: string; run: () => Promise<number> }[] = [
  { key: "roster", label: "학생 명단·생일", run: async () => (await jget("/api/sync/roster?dry=0")).willInsert ?? 0 },
  { key: "events", label: "학원 일정", run: async () => (await jpost("/api/sync/events")).imported ?? 0 },
  { key: "engDaily", label: "영어(중고등) 숙제", run: async () => (await jpost("/api/sync/eng-daily")).imported ?? 0 },
  { key: "engAtt", label: "영어 출결·포인트", run: async () => (await jpost("/api/sync/eng-attendance")).imported ?? 0 },
  { key: "elemLog", label: "영어(초등) 수업일지", run: async () => (await jpost("/api/sync/eng-elem-log")).imported ?? 0 },
  { key: "tasks", label: "강사 업무(할 일 배정)", run: async () => (await jpost("/api/sync/tasks")).imported ?? 0 },
  { key: "wiki", label: "매뉴얼 위키", run: async () => (await jpost("/api/sync/wiki")).imported ?? 0 },
  { key: "sns", label: "SNS 기록", run: async () => (await jpost("/api/sync/sns")).imported ?? 0 },
];

/** 모든 노션 연결을 순차로 가져온다. 단계마다 onProgress로 현재 상태 배열을 넘긴다.
 *  한 단계가 실패해도 멈추지 않고 다음으로 진행한다(노션 권한 누락 등은 부분 성공). */
export async function syncAllFromNotion(onProgress: (steps: SyncStep[]) => void): Promise<SyncStep[]> {
  const steps: SyncStep[] = STEPS.map((s) => ({ key: s.key, label: s.label, status: "pending", count: 0 }));
  onProgress(steps.map((s) => ({ ...s })));
  for (let i = 0; i < STEPS.length; i++) {
    steps[i].status = "running";
    onProgress(steps.map((s) => ({ ...s })));
    try {
      steps[i].count = await STEPS[i].run();
      steps[i].status = "done";
    } catch (e) {
      steps[i].status = "error";
      steps[i].error = e instanceof Error ? e.message : String(e);
    }
    onProgress(steps.map((s) => ({ ...s })));
  }
  return steps;
}
