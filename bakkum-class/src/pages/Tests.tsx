import { useState } from "react";
import type { TestLog } from "../types";
import { useStore } from "../store";
import { curMonthStr, inMonth, monthOptions, studentById } from "../lib/logic";
import { fmtDayBand } from "../lib/dates";
import { Select, TodayLink } from "../components/ui";
import { InlineTable, type InlineCol } from "../components/InlineTable";
import { TestModal } from "../components/modals";
import { pushTestNotion } from "../api";
import { Icon } from "../icons";

const TEST_STATUS = ["예정", "완료"];

export function Tests() {
  const { data, openModal, mutate, mutateAsync, toast } = useStore();
  const [ym, setYm] = useState(curMonthStr());

  const rows = data.testLog.filter((t) => inMonth(t.date, ym)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const nameOf = (t: TestLog) => studentById(data.students, t.studentId)?.name ?? "(삭제된 학생)";

  function apply(d: { testLog: TestLog[] }, id: string, key: string, v: string) {
    const t = d.testLog.find((x) => x.id === id);
    if (!t) return;
    if (key === "date") t.date = v;
    else if (key === "type") t.type = v;
    else if (key === "round") t.round = v;
    else if (key === "range") t.range = v;
    else if (key === "score") t.score = Math.max(0, Math.round(+v) || 0);
    else if (key === "status") t.status = v === "완료" ? "완료" : "예정";
    else if (key === "memo") t.memo = v;
  }
  async function onPatch(id: string, key: string, value: string, orig: string): Promise<boolean> {
    let synced: TestLog | null = null;
    const ok = await mutateAsync((d) => {
      apply(d, id, key, value);
      synced = d.testLog.find((x) => x.id === id) ?? null;
    });
    if (!ok) { mutate((d) => apply(d, id, key, orig)); toast("저장하지 못했어요 · 잠시 후 다시 시도해 주세요"); return false; }
    if (synced) {
      const t: TestLog = synced;
      pushTestNotion(t.studentId, { date: t.date, type: t.type, round: t.round, range: t.range, score: t.score, status: t.status, memo: t.memo });
    }
    return true;
  }
  function onDelete(id: string) {
    if (!window.confirm("이 테스트 기록을 삭제할까요?")) return;
    mutate((d) => { d.testLog = d.testLog.filter((x) => x.id !== id); });
    toast("테스트 기록을 삭제했어요.");
  }

  const cols: InlineCol<TestLog>[] = [
    { key: "student", label: "학생", type: "readonly", width: "14%", get: nameOf, display: (t) => <span className="t-name">{nameOf(t)}</span> },
    { key: "type", label: "유형", type: "text", width: "16%", placeholder: "예: 주간평가", get: (t) => t.type },
    { key: "round", label: "회차", type: "text", width: "12%", placeholder: "예: 6월 2주차", get: (t) => t.round },
    { key: "range", label: "범위", type: "text", width: "18%", placeholder: "시험 범위", get: (t) => t.range },
    { key: "score", label: "점수", type: "number", width: "9%", min: 0, max: 100, get: (t) => String(t.score), display: (t) => <span style={{ fontWeight: 700 }}>{t.score > 0 || t.status === "완료" ? t.score + "점" : "—"}</span> },
    { key: "status", label: "평가", type: "select", width: "10%", options: TEST_STATUS, get: (t) => t.status, display: (t) => <span className={"badge " + (t.status === "완료" ? "b-green" : "b-gray")}>{t.status}</span> },
  ];

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">테스트 기록</h1>
          <div className="page-desc">오늘 테스트는 <TodayLink /> 화면에서, 여기선 전체 테스트 기록을 모아 보고 수정해요.</div>
        </div>
        <div className="head-actions">
          <Select value={ym} onChange={setYm} options={monthOptions()} />
          <button className="btn primary" onClick={() => openModal(<TestModal id={null} />)}>
            <Icon name="plus" />
            테스트 기록
          </button>
        </div>
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <InlineTable
            rows={rows}
            cols={cols}
            rowId={(t) => t.id}
            onPatch={onPatch}
            onDelete={onDelete}
            groupBy={(t) => ({ key: t.date || "미정", label: t.date ? fmtDayBand(t.date) : "시험일 미정" })}
            empty={<div className="empty">아직 테스트 기록이 없어요. <TodayLink /> 화면에서 입력하면 여기에 쌓여요.</div>}
          />
        </div>
      </div>
    </section>
  );
}
