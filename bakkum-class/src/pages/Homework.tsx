import { useMemo, useState } from "react";
import type { HwLog } from "../types";
import { useStore } from "../store";
import { activeStudents } from "../lib/logic";
import { TodayLink } from "../components/ui";
import { Icon } from "../icons";

const HW_STATUS_LABEL: Record<string, string> = { pending: "검사 전", done: "검사완료", late: "지연" };
const mdDate = (d: string) => (d && d.length >= 10 ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : "—");

/**
 * 수학 숙제 기록 — 중고등영어 숙제기록과 동일 레이아웃.
 * 왼쪽 학생 선택 → 오른쪽에 그 학생 숙제 기록을 '월별 접기'로 컴팩트하게.
 */
export function Homework() {
  const { data, mutate, mutateAsync, toast } = useStore();
  const [sel, setSel] = useState("");
  const [q, setQ] = useState("");
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});

  const students = useMemo(
    () => activeStudents(data.students).slice().sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [data.students]
  );
  const qq = q.trim().toLowerCase();
  const shownStudents = qq ? students.filter((s) => (s.name + " " + (s.grade || "")).toLowerCase().includes(qq)) : students;
  const selStudent = students.find((s) => s.id === sel) || null;

  // 월별 그룹(최신 월 먼저), 월 안에서는 날짜 오름차순.
  const months = useMemo(() => {
    const byMonth = new Map<string, HwLog[]>();
    for (const h of data.homeworkLog.filter((h) => h.studentId === sel)) {
      const ym = (h.date || "").slice(0, 7);
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym)!.push(h);
    }
    const arr = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    for (const [, rows] of arr) rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    return arr;
  }, [data.homeworkLog, sel]);

  function apply(d: { homeworkLog: HwLog[] }, id: string, fn: (h: HwLog) => void) {
    const h = d.homeworkLog.find((x) => x.id === id);
    if (h) fn(h);
  }
  async function patch(h: HwLog, fn: (x: HwLog) => void) {
    const ok = await mutateAsync((d) => apply(d, h.id, fn));
    if (!ok) toast("저장하지 못했어요 · 잠시 후 다시 시도해 주세요");
  }
  function remove(h: HwLog) {
    if (!window.confirm(`'${h.book || "이 숙제"}' 기록을 삭제할까요?`)) return;
    mutate((d) => { d.homeworkLog = d.homeworkLog.filter((x) => x.id !== h.id); });
    toast("숙제 기록을 삭제했어요.");
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">수학 숙제 기록</h1>
          <div className="page-desc">학생을 고르면 월별로 숙제 기록을 봐요. 숙제 내주기·검사는 <TodayLink /> 화면에서.</div>
        </div>
      </div>

      <div className="eng-split">
        <div className="eng-side-wrap card">
          <input className="input" style={{ marginBottom: 8 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 검색" />
          <div className="eng-side">
            {shownStudents.length === 0 ? (
              <div className="eng-side-empty">학생이 없어요.</div>
            ) : (
              shownStudents.map((s) => (
                <div key={s.id} className={"eng-stu" + (sel === s.id ? " on" : "")}>
                  <button className="eng-stu-name" onClick={() => { setSel(s.id); setOpenMonths({}); }}>
                    {s.name}{s.grade && <span className="eng-lv">{s.grade}</span>}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="eng-main">
          {!selStudent ? (
            <div className="hub-muted" style={{ padding: 20 }}>왼쪽에서 학생을 선택하면 숙제 기록을 볼 수 있어요.</div>
          ) : (
            <div className="eng-panel">
              <h2>{selStudent.name} · 숙제 기록</h2>
              {months.length === 0 ? (
                <div className="hub-muted">숙제 기록이 없어요. <TodayLink /> 화면에서 숙제를 내주면 여기 쌓여요.</div>
              ) : (
                <div className="eng-hwm-list">
                  {months.map(([ym, rows], mi) => {
                    const [y, mo] = ym.split("-");
                    const open = openMonths[ym] ?? mi === 0;
                    return (
                      <div className="eng-hwm" key={ym}>
                        <button className={"eng-hwm-h" + (open ? " open" : "")} onClick={() => setOpenMonths((m) => ({ ...m, [ym]: !open }))}>
                          <Icon name="chev" />{y}년 {Number(mo)}월 <span>{rows.length}회</span>
                        </button>
                        {open && (
                          <table className="eng-hwt math-hwt">
                            <thead>
                              <tr><th>날짜</th><th>교재</th><th>태그</th><th>진행</th><th>상태</th><th></th></tr>
                            </thead>
                            <tbody>
                              {rows.map((h) => (
                                <tr key={h.id}>
                                  <td className="eng-hwt-date">{mdDate(h.date)}</td>
                                  <td className="math-hwt-book">{h.book || "—"}</td>
                                  <td className="math-hwt-tags">{h.tags.length ? h.tags.join(", ") : "—"}</td>
                                  <td className="eng-hwt-prog">{h.completion ? h.completion + "%" : "—"}</td>
                                  <td>
                                    <select className="math-hwt-sel" value={h.status} onChange={(e) => patch(h, (x) => { x.status = (e.target.value as HwLog["status"]) || "pending"; })}>
                                      {(["pending", "done", "late"] as const).map((s) => <option key={s} value={s}>{HW_STATUS_LABEL[s]}</option>)}
                                    </select>
                                  </td>
                                  <td><button className="ci-del-x" onClick={() => remove(h)} title="삭제">×</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
