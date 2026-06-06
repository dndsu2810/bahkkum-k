import { useState } from "react";
import { useStore } from "../store";
import { importRecords } from "../api";
import { curMonthStr, inMonth, monthOptions, studentById } from "../lib/logic";
import { fmtMDDow } from "../lib/dates";
import { Select, Empty } from "../components/ui";
import { ProgressModal } from "../components/modals";
import { Icon } from "../icons";

export function Progress() {
  const { data, openModal, reload, toast } = useStore();
  const [ym, setYm] = useState(curMonthStr());
  const [importing, setImporting] = useState(false);

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

  const rows = data.progressLog
    .filter((p) => inMonth(p.date, ym))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <div className="page-title">진도 관리</div>
          <div className="page-desc">기록한 진도는 월말리포트 ‘진도 달성 현황’에 자동 반영됩니다(해당 월 최신 기록).</div>
        </div>
        <div className="head-actions">
          <Select value={ym} onChange={setYm} options={monthOptions()} />
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

      <div className="card">
        {rows.length === 0 ? (
          <Empty>이 달의 진도 기록이 없습니다.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>기록일</th>
                  <th>학생</th>
                  <th>단원</th>
                  <th>영역</th>
                  <th>달성률</th>
                  <th style={{ textAlign: "right" }}>수정</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const s = studentById(data.students, p.studentId);
                  return (
                    <tr key={p.id}>
                      <td className="muted">{fmtMDDow(p.date)}</td>
                      <td style={{ fontWeight: 700, color: "var(--text)" }}>{s ? s.name : "(삭제된 학생)"}</td>
                      <td>{p.unit || "—"}</td>
                      <td className="muted">{p.area || "—"}</td>
                      <td>{p.pct}%</td>
                      <td className="t-actions">
                        <button className="btn ghost sm" onClick={() => openModal(<ProgressModal id={p.id} />)}>
                          <Icon name="edit" />
                          수정
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
