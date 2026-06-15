// 기록 페이지 공통 필터 바 — 학생·상태·검색을 한 줄로. 4개 페이지(출결·숙제·진도·테스트) 동일.
// 기간(월)은 각 페이지의 기존 월 드롭다운을 그대로 쓰고, 여기선 학생·상태·검색만 통일한다.
export interface RecordFilterValue {
  student: string; // 학생 id ("" = 전체)
  status: string; // 상태 값 ("" = 전체)
  q: string; // 검색어
}
export const EMPTY_FILTER: RecordFilterValue = { student: "", status: "", q: "" };
export const filterActive = (f: RecordFilterValue) => !!(f.student || f.status || f.q.trim());

export function RecordFilters({
  value,
  onChange,
  students,
  statusOptions,
}: {
  value: RecordFilterValue;
  onChange: (v: RecordFilterValue) => void;
  students: { id: string; name: string }[];
  statusOptions?: { v: string; label: string }[];
}) {
  const set = (patch: Partial<RecordFilterValue>) => onChange({ ...value, ...patch });
  return (
    <div className="recfilter">
      <select className="inline-select recfilter-sel" value={value.student} onChange={(e) => set({ student: e.target.value })} aria-label="학생">
        <option value="">학생 전체</option>
        {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {statusOptions && statusOptions.length > 0 && (
        <select className="inline-select recfilter-sel" value={value.status} onChange={(e) => set({ status: e.target.value })} aria-label="상태">
          <option value="">상태 전체</option>
          {statusOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
      )}
      <input className="inline-input recfilter-input" value={value.q} onChange={(e) => set({ q: e.target.value })} placeholder="검색 (이름·내용)" aria-label="검색" />
      {filterActive(value) && <button className="btn ghost sm recfilter-clear" onClick={() => onChange(EMPTY_FILTER)} title="필터 지우기">필터 해제</button>}
    </div>
  );
}
