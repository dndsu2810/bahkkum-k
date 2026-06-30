import { useState } from "react";

/** 명단 정렬 선택(가나다순 / 학년순).
 *  화면마다 따로(scope) 저장해, 한 화면에서 바꿔도 다른 화면은 그대로예요. */
export type StudentSort = "name" | "grade";

export function useStudentSort(scope: string): [StudentSort, (s: StudentSort) => void] {
  const key = "math_list_sort_" + scope;
  const [sort, setSort] = useState<StudentSort>(() => {
    try { return localStorage.getItem(key) === "grade" ? "grade" : "name"; } catch { return "name"; }
  });
  const set = (s: StudentSort) => { setSort(s); try { localStorage.setItem(key, s); } catch { /* ignore */ } };
  return [sort, set];
}

export function StudentSortToggle({ value, onChange }: { value: StudentSort; onChange: (s: StudentSort) => void }) {
  return (
    <div className="seg stu-sort">
      <button type="button" className={"seg-btn" + (value === "name" ? " on" : "")} onClick={() => onChange("name")}>가나다순</button>
      <button type="button" className={"seg-btn" + (value === "grade" ? " on" : "")} onClick={() => onChange("grade")}>학년순</button>
    </div>
  );
}
