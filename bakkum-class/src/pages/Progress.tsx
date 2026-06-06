import { useState } from "react";
import type { ProgLog } from "../types";
import { useStore } from "../store";
import { importRecords } from "../api";
import { studentById } from "../lib/logic";
import { fmtMDDow } from "../lib/dates";
import { Empty } from "../components/ui";
import { ProgressModal } from "../components/modals";
import { Icon } from "../icons";

export function Progress() {
  const { data, openModal, reload, toast } = useStore();
  const [importing, setImporting] = useState(false);

  const sorted = data.progressLog.slice().sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const ongoing = sorted.filter((p) => p.pct < 100);
  const done = sorted.filter((p) => p.pct >= 100);

  async function onImport() {
    setImporting(true);
    try {
      const r = await importRecords();
      if (r.error) toast("가져오기 실패: " + r.error);
      else {
        await reload();
        toast(`노션에서 숙제 ${r.homework} · 진도 ${r.progress} · 출결 ${r.attendance}건 가져왔어요.`);
      }
    } finally {
      setImporting(false);
    }
  }

  function Row({ p }: { p: ProgLog }) {
    const s = studentById(data.students, p.studentId);
    const complete = p.pct >= 100;
    return (
      <div className="mk-item">
        <div className="mk-main">
          <div className="mk-name">
            {s ? s.name : "(삭제된 학생)"}{" "}
            <span className={"badge " + (complete ? "b-green" : "b-blue")}>{complete ? "완료" : "진행중"}</span>
          </div>
          <div className="mk-meta">
            <span>
              {p.unit || "단원 미정"}
              {p.area ? " · " + p.area : ""} · {p.pct}%
              {p.startDate ? " · 시작 " + fmtMDDow(p.startDate) : ""}
            </span>
            {p.memo && (
              <>
                <span className="sep">·</span>
                <span className="mk-memo">{p.memo}</span>
              </>
            )}
          </div>
        </div>
        <div className="mk-actions">
          <button className="btn ghost sm" onClick={() => openModal(<ProgressModal id={p.id} />)}>
            <Icon name="edit" />
            수정
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <div className="page-title">진도 관리</div>
          <div className="page-desc">진행중/완료(완성도 100) 기준. 월말리포트엔 학생의 현재 진도가 반영됩니다.</div>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={onImport} disabled={importing}>
            <Icon name="refresh" />
            {importing ? "가져오는 중…" : "노션에서 기록 가져오기"}
          </button>
          <button className="btn primary" onClick={() => openModal(<ProgressModal id={null} />)}>
            <Icon name="plus" />
            진도 기록
          </button>
        </div>
      </div>

      <div className="mk-group">
        <div className="mk-grouphead">진행중 <span className="gcnt">{ongoing.length}건</span></div>
        <div className="card">
          {ongoing.length ? ongoing.map((p) => <Row key={p.id} p={p} />) : <Empty>진행중인 진도가 없습니다.</Empty>}
        </div>
      </div>

      {done.length > 0 && (
        <div className="mk-group">
          <div className="mk-grouphead">완료 <span className="gcnt">{done.length}건</span></div>
          <div className="card">{done.map((p) => <Row key={p.id} p={p} />)}</div>
        </div>
      )}
    </section>
  );
}
