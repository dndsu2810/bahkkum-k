import { useMemo, useState } from "react";
import type { HwLog } from "../types";
import { useStore } from "../store";
import { activeStudents, sortStudents } from "../lib/logic";
import { TodayLink } from "../components/ui";
import { StudentSortToggle, useStudentSort } from "../components/StudentSortToggle";
import { Icon } from "../icons";

const HW_STATUS_LABEL: Record<string, string> = { pending: "검사 전", done: "검사완료", late: "지연" };
// 숙제 영역 태그 — [오늘] 내주기와 동일 라벨.
const AREA_TAGS = ["개념", "연산", "복습", "오답", "심화", "활용", "사고력", "서술형", "수학익힘"];

/**
 * 수학 숙제 기록 — 중고등영어 숙제기록과 동일 레이아웃.
 * 왼쪽 학생 선택 → 오른쪽에 그 학생 숙제 기록을 '월별 접기'로 컴팩트하게.
 */
export function Homework() {
  const { data, mutate, mutateAsync, toast } = useStore();
  const [sel, setSel] = useState("");
  const [q, setQ] = useState("");
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const [bookDraft, setBookDraft] = useState<Record<string, string>>({});
  const [pctDraft, setPctDraft] = useState<Record<string, string>>({});

  const [sort, setSort] = useStudentSort("homework");
  const students = useMemo(
    () => sortStudents(activeStudents(data.students), sort),
    [data.students, sort]
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
  // 교재명 — 입력 중엔 draft, 포커스 아웃 때 저장(키 입력마다 저장 방지).
  function commitBook(h: HwLog) {
    const v = bookDraft[h.id];
    setBookDraft((m) => { const n = { ...m }; delete n[h.id]; return n; });
    if (v === undefined || v.trim() === h.book) return;
    patch(h, (x) => { x.book = v.trim(); });
  }
  // 진행(완성도 %) — 0~100으로 보정 후 저장.
  function commitPct(h: HwLog) {
    const raw = pctDraft[h.id];
    setPctDraft((m) => { const n = { ...m }; delete n[h.id]; return n; });
    if (raw === undefined) return;
    const v = Math.max(0, Math.min(100, Math.round(+raw) || 0));
    if (v !== h.completion) patch(h, (x) => { x.completion = v; });
  }
  // 영역 태그 토글.
  function toggleTag(h: HwLog, t: string) {
    patch(h, (x) => { x.tags = x.tags.includes(t) ? x.tags.filter((g) => g !== t) : [...x.tags, t]; });
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
          <div style={{ marginBottom: 8 }}><StudentSortToggle value={sort} onChange={setSort} /></div>
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
                                  <td className="eng-hwt-date">
                                    <input
                                      type="date"
                                      className="math-hwt-date-in"
                                      value={h.date && h.date.length >= 10 ? h.date.slice(0, 10) : ""}
                                      onChange={(e) => { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== h.date) patch(h, (x) => { x.date = v; }); }}
                                      title="숙제 날짜 수정"
                                    />
                                  </td>
                                  <td className="math-hwt-book">
                                    <input
                                      className="math-hwt-input"
                                      value={bookDraft[h.id] ?? h.book}
                                      placeholder="교재"
                                      onChange={(e) => setBookDraft((m) => ({ ...m, [h.id]: e.target.value }))}
                                      onBlur={() => commitBook(h)}
                                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                                    />
                                  </td>
                                  <td className="math-hwt-tags">
                                    <span className="today-tagchips hwt-tagchips">
                                      {AREA_TAGS.map((t) => (
                                        <button key={t} className={h.tags.includes(t) ? "on" : ""} onClick={() => toggleTag(h, t)}>{t}</button>
                                      ))}
                                    </span>
                                  </td>
                                  <td className="eng-hwt-prog">
                                    <input
                                      className="math-hwt-pctinput"
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={pctDraft[h.id] ?? (h.completion || "")}
                                      onChange={(e) => setPctDraft((m) => ({ ...m, [h.id]: e.target.value }))}
                                      onBlur={() => commitPct(h)}
                                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                                    />%
                                  </td>
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
