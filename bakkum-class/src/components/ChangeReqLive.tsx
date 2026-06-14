import { useEffect, useState } from "react";
import type { ChangeReq } from "../lib/hubApi";
import { openChangeRequest, type SlotConflict } from "../lib/changeReqLive";

const subjLabel = (s: string) => (s === "english" ? "영어" : "수학");

/** 그 날짜의 '승인된 시간 변경'을 한 줄 배너로 — 시간표/오늘에 임시 반영(표시). */
export function ApprovedBanner({ changes, subject }: { changes: ChangeReq[]; subject?: "math" | "english" }) {
  const list = subject ? changes.filter((c) => c.subject === subject) : changes;
  if (list.length === 0) return null;
  return (
    <div className="crl-banner ok">
      <span className="crl-banner-ic">✓</span>
      <span className="crl-banner-tx">
        오늘 시간 변경(승인):{" "}
        {list.map((c, i) => (
          <span key={c.id}>
            {i > 0 && ", "}
            <b>{c.studentName}</b> {subject ? "" : `${subjLabel(c.subject)} `}
            {c.fromTime || "기존"}→{c.toTime}
          </span>
        ))}
      </span>
    </div>
  );
}

/** 그 날짜에 한 학생의 수학↔영어 시간이 겹치면 자동 팝업으로 알리고 변경요청을 유도. */
export function ConflictPopup({ conflicts, date }: { conflicts: SlotConflict[]; date: string }) {
  // 날짜별 1회만 자동으로 뜨게(닫으면 그 날짜는 다시 안 뜸).
  const [dismissed, setDismissed] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (conflicts.length > 0 && dismissed !== date) setOpen(true);
    else setOpen(false);
  }, [conflicts.length, date, dismissed]);

  if (!open || conflicts.length === 0) return null;
  const close = () => { setDismissed(date); setOpen(false); };
  return (
    <div className="prof-overlay" onClick={close}>
      <div className="prof crl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="prof-top">
          <div className="prof-top-main"><div className="prof-name">⚠ 시간표가 겹칩니다</div></div>
          <button className="modal-x" onClick={close} aria-label="닫기">✕</button>
        </div>
        <div className="prof-body">
          <p className="hub-muted" style={{ marginBottom: 12 }}>{date} · 같은 시간에 수학·영어 수업이 겹치는 학생이 있어요. 한쪽 시간을 바꾸려면 변경 요청을 보내세요.</p>
          <div className="crl-conf-list">
            {conflicts.map((c) => (
              <div className="crl-conf" key={c.studentId}>
                <div className="crl-conf-info">
                  <b>{c.studentName}</b>
                  <span className="crl-conf-time">수학 {c.mathTime} ↔ 영어 {c.engTime}</span>
                </div>
                <div className="crl-conf-acts">
                  <button className="btn ghost sm" onClick={() => openChangeRequest({ studentId: c.studentId, studentName: c.studentName, subject: "math", changeDate: date, fromTime: c.mathTime })}>수학 시간 변경</button>
                  <button className="btn ghost sm" onClick={() => openChangeRequest({ studentId: c.studentId, studentName: c.studentName, subject: "english", changeDate: date, fromTime: c.engTime })}>영어 시간 변경</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="prof-foot">
          <button className="btn ghost" onClick={close}>나중에</button>
        </div>
      </div>
    </div>
  );
}
