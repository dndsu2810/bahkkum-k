import { useState } from "react";
import { useStore } from "../store";
import { importRecords } from "../api";
import { curMonthStr, inMonth, monthOptions, studentById } from "../lib/logic";
import { fmtMDDow } from "../lib/dates";
import { Select, Empty } from "../components/ui";
import { HomeworkModal } from "../components/modals";
import { Icon } from "../icons";

export function Homework() {
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

  const rows = data.homeworkLog
    .filter((h) => inMonth(h.date, ym))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <div className="page-title">숙제 관리</div>
          <div className="page-desc">기록한 숙제는 월말리포트 ‘숙제 및 수행 기록’에 자동으로 쌓입니다.</div>
        </div>
        <div className="head-actions">
          <Select value={ym} onChange={setYm} options={monthOptions()} />
          <button className="btn" onClick={onImport} disabled={importing}>
            <Icon name="refresh" />
            {importing ? "가져오는 중…" : "노션에서 기록 가져오기"}
          </button>
          <button className="btn primary" onClick={() => openModal(<HomeworkModal id={null} />)}>
            <Icon name="plus" />
            숙제 기록
          </button>
        </div>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <Empty>이 달의 숙제 기록이 없습니다.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>학생</th>
                  <th>교재 / 태그</th>
                  <th>완성도</th>
                  <th>상태</th>
                  <th style={{ textAlign: "right" }}>수정</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const s = studentById(data.students, h.studentId);
                  return (
                    <tr key={h.id}>
                      <td className="muted">{fmtMDDow(h.date)}</td>
                      <td style={{ fontWeight: 700, color: "var(--text)" }}>{s ? s.name : "(삭제된 학생)"}</td>
                      <td>
                        {h.book || "—"}
                        {h.tags.length > 0 && <span className="muted"> · {h.tags.join(", ")}</span>}
                      </td>
                      <td>{h.completion}%</td>
                      <td>
                        <span className={"badge " + (h.status === "late" ? "b-orange" : "b-green")}>
                          {h.status === "late" ? "지연" : "검사완료"}
                        </span>
                      </td>
                      <td className="t-actions">
                        <button className="btn ghost sm" onClick={() => openModal(<HomeworkModal id={h.id} />)}>
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
