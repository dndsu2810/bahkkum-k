import { useState } from "react";
import type { ProgLog } from "../types";
import { useStore } from "../store";
import { studentById } from "../lib/logic";
import { fmtDayBand } from "../lib/dates";
import { InlineTable, type InlineCol } from "../components/InlineTable";
import { ProgressModal } from "../components/modals";
import { TodayLink } from "../components/ui";
import { Icon } from "../icons";

type ProgTab = "all" | "ing" | "done";
const TABS: { v: ProgTab; label: string }[] = [
  { v: "all", label: "전체" },
  { v: "ing", label: "진행중" },
  { v: "done", label: "완료" },
];

export function Progress() {
  const { data, openModal, mutate, mutateAsync, toast } = useStore();
  const [tab, setTab] = useState<ProgTab>("all");

  const all = data.progressLog.slice().sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const sorted = all.filter((p) => (tab === "all" ? true : tab === "done" ? p.pct >= 100 : p.pct < 100));
  const ingCount = all.filter((p) => p.pct < 100).length;
  const doneCount = all.length - ingCount;
  const nameOf = (p: ProgLog) => studentById(data.students, p.studentId)?.name ?? "(삭제된 학생)";

  function apply(d: { progressLog: ProgLog[] }, id: string, key: string, v: string) {
    const p = d.progressLog.find((x) => x.id === id);
    if (!p) return;
    if (key === "unit") p.unit = v;
    else if (key === "area") p.area = v;
    else if (key === "pct") p.pct = Math.max(0, Math.min(100, Math.round(+v) || 0));
    else if (key === "startDate") p.startDate = v;
    else if (key === "memo") p.memo = v;
  }
  async function onPatch(id: string, key: string, value: string, orig: string): Promise<boolean> {
    const ok = await mutateAsync((d) => apply(d, id, key, value));
    if (!ok) {
      mutate((d) => apply(d, id, key, orig));
      toast("저장하지 못했어요 · 잠시 후 다시 시도해 주세요");
    }
    return ok;
  }
  function onDelete(id: string) {
    const p = data.progressLog.find((x) => x.id === id);
    if (!window.confirm(`'${p?.unit || "이 진도"}' 기록을 삭제할까요?`)) return;
    mutate((d) => { d.progressLog = d.progressLog.filter((x) => x.id !== id); });
    toast("진도 기록을 삭제했어요.");
  }

  // 같은 학생·같은 단원이 여러 건이면 가장 진행된(진행률↑, 동률이면 시작일↑) 1건만 남긴다.
  function dedupe() {
    const keep = new Map<string, ProgLog>();
    for (const p of data.progressLog) {
      const u = p.unit.trim();
      if (!u) { keep.set("id:" + p.id, p); continue; } // 단원 없는 건 그대로
      const k = p.studentId + "|" + u;
      const ex = keep.get(k);
      if (!ex || p.pct > ex.pct || (p.pct === ex.pct && p.startDate > ex.startDate)) keep.set(k, p);
    }
    const keepIds = new Set([...keep.values()].map((p) => p.id));
    const removed = data.progressLog.length - keepIds.size;
    if (!removed) { toast("정리할 중복이 없어요."); return; }
    if (!window.confirm(`중복 진도 ${removed}건을 정리할까요?\n(학생·단원이 같으면 가장 진행된 1건만 남깁니다)`)) return;
    mutate((d) => { d.progressLog = d.progressLog.filter((p) => keepIds.has(p.id)); });
    toast(`중복 ${removed}건을 정리했어요.`);
  }

  const cols: InlineCol<ProgLog>[] = [
    { key: "student", label: "학생", type: "readonly", width: "12%", get: nameOf, display: (p) => <span className="t-name">{nameOf(p)}</span> },
    { key: "unit", label: "단원", type: "text", width: "23%", placeholder: "예: 3단원 소수의 나눗셈", get: (p) => p.unit, display: (p) => <span>{p.unit || "단원 미정"}</span> },
    { key: "area", label: "영역", type: "text", width: "11%", placeholder: "예: 개념", get: (p) => p.area },
    { key: "pct", label: "진행률", type: "number", width: "12%", min: 0, max: 100, get: (p) => String(p.pct), display: (p) => <span style={{ fontWeight: 700 }}>{p.pct}%</span> },
    { key: "status", label: "상태", type: "readonly", width: "11%", get: (p) => (p.pct >= 100 ? "완료" : "진행중"), display: (p) => <span className={"badge " + (p.pct >= 100 ? "b-green" : "b-blue")}>{p.pct >= 100 ? "완료" : "진행중"}</span> },
    { key: "memo", label: "메모", type: "text", width: "21%", placeholder: "특이사항", get: (p) => p.memo },
  ];

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">진도 기록</h1>
          <div className="page-desc">오늘 진도는 <TodayLink /> 화면에서, 여기선 전체 진도 기록을 모아 보고 수정해요.</div>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={dedupe} title="학생·단원이 같은 중복 진도 정리">
            <Icon name="refresh" />
            중복 정리
          </button>
          <button className="btn primary" onClick={() => openModal(<ProgressModal id={null} />)}>
            <Icon name="plus" />
            진도 기록
          </button>
        </div>
      </div>

      <div className="seg-toggle" style={{ marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t.v} className={tab === t.v ? "on" : ""} onClick={() => setTab(t.v)}>
            {t.label}
            <span className="seg-count">{t.v === "all" ? all.length : t.v === "ing" ? ingCount : doneCount}</span>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <InlineTable
            rows={sorted}
            cols={cols}
            rowId={(p) => p.id}
            onPatch={onPatch}
            onDelete={onDelete}
            groupBy={(p) => ({ key: p.startDate || "미정", label: p.startDate ? fmtDayBand(p.startDate) + " 시작" : "시작일 미정" })}
            empty={<div className="empty">{tab === "done" ? "완료된 진도가 없습니다." : tab === "ing" ? "진행중인 진도가 없습니다." : <>아직 진도 기록이 없어요. <TodayLink /> 화면에서 입력하면 여기에 쌓여요.</>}</div>}
          />
        </div>
      </div>
    </section>
  );
}
