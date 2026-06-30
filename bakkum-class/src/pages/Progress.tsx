import { useMemo, useState } from "react";
import type { ProgLog } from "../types";
import { useStore } from "../store";
import { activeStudents, sortStudents } from "../lib/logic";
import { fmtDayBand, todayStr, uid } from "../lib/dates";
import { TodayLink } from "../components/ui";
import { StudentSortToggle, useStudentSort } from "../components/StudentSortToggle";
import { Icon } from "../icons";

/**
 * 진도 · 교재관리 — 중고등영어와 동일한 레이아웃.
 * 왼쪽에서 학생을 고르면, 그 학생의 교재 진도를 입력한다.
 * %가 아니라 '시작일'을 입력하고, 완료 전까지는 '진행중', 완료하면 '교재 완료'.
 */
export function Progress() {
  const { data, mutate, mutateAsync, toast } = useStore();
  const [sel, setSel] = useState("");
  const [q, setQ] = useState("");

  const [sort, setSort] = useStudentSort("progress");
  const students = useMemo(
    () => sortStudents(activeStudents(data.students), sort),
    [data.students, sort]
  );
  const qq = q.trim().toLowerCase();
  const shownStudents = qq ? students.filter((s) => (s.name + " " + (s.grade || "")).toLowerCase().includes(qq)) : students;
  const ingCountOf = (sid: string) => data.progressLog.filter((p) => p.studentId === sid && p.pct < 100).length;

  const selStudent = students.find((s) => s.id === sel) || null;
  const myProg = useMemo(
    () =>
      data.progressLog
        .filter((p) => p.studentId === sel)
        .slice()
        .sort((a, b) => {
          // 진행중 먼저, 그 안에서 '최근 수정순'(수정한 교재가 위로). 수정 이력 없으면 시작일로.
          if ((a.pct < 100) !== (b.pct < 100)) return a.pct < 100 ? -1 : 1;
          const ta = a.updatedAt ?? 0;
          const tb = b.updatedAt ?? 0;
          if (ta !== tb) return tb - ta;
          return (a.startDate < b.startDate ? 1 : -1);
        }),
    [data.progressLog, sel]
  );

  // 입력 폼(선택한 학생 기준).
  const [book, setBook] = useState("");
  const [range, setRange] = useState("");
  const [start, setStart] = useState(todayStr());
  // 행 인라인 수정 — 교재명·범위·시작일을 나중에 고칠 수 있게.
  const [editId, setEditId] = useState<string | null>(null);
  const [eBook, setEBook] = useState("");
  const [eRange, setERange] = useState("");
  const [eStart, setEStart] = useState("");
  function startEdit(p: ProgLog) { setEditId(p.id); setEBook(p.unit); setERange(p.area); setEStart(p.startDate); }
  async function saveEdit(p: ProgLog) {
    const title = eBook.trim();
    if (!title) { toast("교재명을 입력해 주세요."); return; }
    const ok = await mutateAsync((d) => apply(d, p.id, (x) => { x.unit = title; x.area = eRange.trim(); x.startDate = eStart || x.startDate; x.updatedAt = Date.now(); }));
    if (!ok) { toast("저장하지 못했어요 · 잠시 후 다시 시도해 주세요"); return; }
    setEditId(null);
    toast("교재 정보를 수정했어요.");
  }

  function add() {
    const title = book.trim();
    if (!title || !sel) return;
    const rec: ProgLog = { id: uid(), studentId: sel, unit: title, area: range.trim(), pct: 0, startDate: start || todayStr(), endDate: "", memo: "", updatedAt: Date.now() };
    mutate((d) => { d.progressLog.push(rec); });
    setBook(""); setRange("");
    setStart(todayStr());
    toast("교재를 추가했어요.");
  }

  function apply(d: { progressLog: ProgLog[] }, id: string, fn: (p: ProgLog) => void) {
    const p = d.progressLog.find((x) => x.id === id);
    if (p) fn(p);
  }
  async function setDone(p: ProgLog, done: boolean) {
    const ok = await mutateAsync((d) => apply(d, p.id, (x) => { x.pct = done ? 100 : 0; x.endDate = done ? todayStr() : ""; x.updatedAt = Date.now(); }));
    if (!ok) toast("저장하지 못했어요 · 잠시 후 다시 시도해 주세요");
  }
  function remove(p: ProgLog) {
    if (!window.confirm(`'${p.unit || "이 교재"}' 진도를 삭제할까요?`)) return;
    mutate((d) => { d.progressLog = d.progressLog.filter((x) => x.id !== p.id); });
    toast("교재 진도를 삭제했어요.");
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">진도 · 교재관리</h1>
          <div className="page-desc">학생을 고르면 교재별 진도를 입력해요. 오늘 진도는 <TodayLink /> 화면에서도 돼요.</div>
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
              shownStudents.map((s) => {
                const ing = ingCountOf(s.id);
                return (
                  <div key={s.id} className={"eng-stu" + (sel === s.id ? " on" : "")}>
                    <button className="eng-stu-name" onClick={() => setSel(s.id)}>
                      {s.name}
                      {s.grade && <span className="eng-lv">{s.grade}</span>}
                      {ing > 0 && <span className="eng-stu-time">진행 {ing}</span>}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="eng-main">
          {!selStudent ? (
            <div className="hub-muted" style={{ padding: 20 }}>왼쪽에서 학생을 선택하면 교재 진도를 입력할 수 있어요.</div>
          ) : (
            <div className="eng-panel">
              <h2>{selStudent.name} · 진도 · 교재</h2>
              <div className="eng-add-row">
                <input className="input" value={book} onChange={(e) => setBook(e.target.value)} placeholder="교재명 (예: 디딤돌 개념원리)" onKeyDown={(e) => e.key === "Enter" && add()} />
                <input className="input" style={{ maxWidth: 150 }} value={range} onChange={(e) => setRange(e.target.value)} placeholder="범위·단계(선택)" />
                <input className="inline-input" style={{ maxWidth: 150 }} type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="시작일" />
                <button className="btn primary" onClick={add} disabled={!book.trim()}>추가</button>
              </div>
              <div className="eng-rows">
                {myProg.map((p) => (
                  editId === p.id ? (
                    <div className="eng-row editing" key={p.id}>
                      <div className="eng-row-main eng-row-edit">
                        <input className="input" value={eBook} onChange={(e) => setEBook(e.target.value)} placeholder="교재명" onKeyDown={(e) => e.key === "Enter" && saveEdit(p)} />
                        <input className="input" style={{ maxWidth: 150 }} value={eRange} onChange={(e) => setERange(e.target.value)} placeholder="범위·단계(선택)" />
                        <input className="inline-input" style={{ maxWidth: 150 }} type="date" value={eStart} onChange={(e) => setEStart(e.target.value)} aria-label="시작일" />
                      </div>
                      <button className="btn primary sm" onClick={() => saveEdit(p)}>저장</button>
                      <button className="btn ghost sm" onClick={() => setEditId(null)}>취소</button>
                    </div>
                  ) : (
                    <div className={"eng-row" + (p.pct >= 100 ? " mat-arow done" : "")} key={p.id}>
                      <div className="eng-row-main">
                        <b>{p.unit || "교재 미정"}</b>
                        {p.area && <span className="eng-lv">{p.area}</span>}
                        <span className={"badge " + (p.pct >= 100 ? "b-green" : "b-blue")} style={{ marginLeft: 4 }}>{p.pct >= 100 ? "교재 완료" : "진행중"}</span>
                      </div>
                      <span className="prog-dates">
                        {fmtDayBand(p.startDate) || "시작일 미정"} 시작{p.pct >= 100 && p.endDate ? ` · ${fmtDayBand(p.endDate)} 완료` : ""}
                      </span>
                      {p.pct >= 100 ? (
                        <button className="btn ghost sm" onClick={() => setDone(p, false)}>진행중으로</button>
                      ) : (
                        <button className="btn sm" onClick={() => setDone(p, true)}>교재 완료</button>
                      )}
                      <button className="btn ghost sm" onClick={() => startEdit(p)} title="수정"><Icon name="edit" /></button>
                      <button className="btn ghost sm" onClick={() => remove(p)} title="삭제"><Icon name="trash" /></button>
                    </div>
                  )
                ))}
                {myProg.length === 0 && <div className="hub-muted">아직 등록된 교재가 없어요. 위에서 교재명을 입력해 추가하세요.</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
