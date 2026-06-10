import { useState } from "react";
import type { HwLog } from "../types";
import { useStore } from "../store";
import { curMonthStr, inMonth, monthOptions, studentById } from "../lib/logic";
import { fmtDayBand } from "../lib/dates";
import { Select, TodayLink } from "../components/ui";
import { InlineTable, type InlineCol } from "../components/InlineTable";
import { HomeworkModal } from "../components/modals";
import { Icon } from "../icons";

const HW_STATUS = ["pending", "done", "late"];
const HW_STATUS_LABEL: Record<string, string> = { pending: "검사 전", done: "검사완료", late: "지연" };

export function Homework() {
  const { data, openModal, mutate, mutateAsync, toast } = useStore();
  const [ym, setYm] = useState(curMonthStr());

  const rows = data.homeworkLog.filter((h) => inMonth(h.date, ym)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const nameOf = (h: HwLog) => studentById(data.students, h.studentId)?.name ?? "(삭제된 학생)";

  function apply(d: { homeworkLog: HwLog[] }, id: string, key: string, v: string) {
    const h = d.homeworkLog.find((x) => x.id === id);
    if (!h) return;
    if (key === "date") h.date = v;
    else if (key === "book") h.book = v;
    else if (key === "tags") h.tags = v.split(",").map((t) => t.trim()).filter(Boolean);
    else if (key === "completion") h.completion = Math.max(0, Math.min(100, Math.round(+v) || 0));
    else if (key === "status") h.status = (v as HwLog["status"]) || "pending";
    else if (key === "memo") h.memo = v;
  }
  async function onPatch(id: string, key: string, value: string, orig: string): Promise<boolean> {
    const ok = await mutateAsync((d) => apply(d, id, key, value));
    if (!ok) { mutate((d) => apply(d, id, key, orig)); toast("저장하지 못했어요 · 잠시 후 다시 시도해 주세요"); }
    return ok;
  }
  function onDelete(id: string) {
    if (!window.confirm("이 숙제 기록을 삭제할까요?")) return;
    mutate((d) => { d.homeworkLog = d.homeworkLog.filter((x) => x.id !== id); });
    toast("숙제 기록을 삭제했어요.");
  }

  const cols: InlineCol<HwLog>[] = [
    { key: "student", label: "학생", type: "readonly", width: "14%", get: nameOf, display: (h) => <span className="t-name">{nameOf(h)}</span> },
    { key: "book", label: "교재 / 내용", type: "text", width: "30%", placeholder: "교재·내용", get: (h) => h.book, display: (h) => <span>{h.book || "—"}</span> },
    { key: "tags", label: "태그", type: "text", width: "14%", placeholder: "쉼표로 구분", get: (h) => h.tags.join(", ") },
    { key: "completion", label: "완성도", type: "number", width: "9%", min: 0, max: 100, get: (h) => String(h.completion), display: (h) => <span style={{ fontWeight: 700 }}>{h.completion}%</span> },
    {
      key: "status", label: "상태", type: "select", width: "11%", options: HW_STATUS, optionLabels: HW_STATUS_LABEL,
      get: (h) => h.status,
      display: (h) => <span className={"badge " + (h.status === "done" ? "b-green" : h.status === "late" ? "b-orange" : "b-gray")}>{HW_STATUS_LABEL[h.status]}</span>,
    },
    { key: "memo", label: "메모", type: "text", width: "13%", placeholder: "특이사항", get: (h) => h.memo },
  ];

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <div className="page-title">숙제 기록</div>
          <div className="page-desc">오늘 숙제 검사·내주기는 <TodayLink /> 화면에서, 여기선 쌓인 숙제 기록을 모아 보고 수정해요.</div>
        </div>
        <div className="head-actions">
          <Select value={ym} onChange={setYm} options={monthOptions()} />
          <button className="btn primary" onClick={() => openModal(<HomeworkModal id={null} />)}>
            <Icon name="plus" />
            숙제 기록
          </button>
        </div>
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <InlineTable
            rows={rows}
            cols={cols}
            rowId={(h) => h.id}
            onPatch={onPatch}
            onDelete={onDelete}
            groupBy={(h) => ({ key: h.date, label: fmtDayBand(h.date) })}
            empty={<div className="empty">아직 숙제 기록이 없어요. <TodayLink /> 화면에서 입력하면 여기에 쌓여요.</div>}
          />
        </div>
      </div>
    </section>
  );
}
