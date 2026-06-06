import type { Makeup, MakeupDisplay, Student } from "../types";
import { mkStatus, studentById, gradeColor, avatarText } from "../lib/logic";
import { fmtMDDow } from "../lib/dates";
import { Empty } from "./ui";
import { Icon } from "../icons";

function MkBadge({ st }: { st: MakeupDisplay }) {
  if (st === "pending") return <span className="badge b-orange">보강 대기</span>;
  if (st === "scheduled") return <span className="badge b-blue">보강 예정</span>;
  if (st === "done") return <span className="badge b-green">보강 완료</span>;
  if (st === "skip") return <span className="badge b-gray">보강 미진행</span>;
  return null;
}

export interface MakeupActions {
  onSchedule: (id: string) => void;
  onSkip: (id: string) => void;
  onRevert: (id: string) => void;
  onDelete: (id: string) => void;
}

function MkRow({
  k,
  students,
  manage,
  actions,
}: {
  k: Makeup;
  students: Student[];
  manage: boolean;
  actions?: MakeupActions;
}) {
  const s = studentById(students, k.studentId);
  const name = s ? s.name : "(삭제된 학생)";
  const color = s ? gradeColor(s.grade) : "blue";
  const st = mkStatus(k);

  let meta = "";
  let extra: React.ReactNode = null;
  if (st === "pending") {
    meta =
      "결석 " +
      fmtMDDow(k.absentDate) +
      (k.absentTime ? " " + k.absentTime : "") +
      (k.absentDuration ? " (" + k.absentDuration + "분)" : "");
  } else if (st === "skip") {
    meta = "결석 " + fmtMDDow(k.absentDate) + " · 보강 미진행";
    extra = k.parentContacted ? (
      <span className="mk-parent ok">
        <Icon name="check" />
        부모님 연락 완료
      </span>
    ) : (
      <span className="mk-parent no">
        <Icon name="phone" />
        부모님 연락 필요
      </span>
    );
  } else {
    meta = "보강 " + fmtMDDow(k.makeupDate);
    if (k.makeupTime) meta += " " + k.makeupTime;
    if (k.makeupDuration) meta += " (" + k.makeupDuration + "분)";
    if (k.absentDate) meta += " · 결석 " + fmtMDDow(k.absentDate);
  }

  let actionsEl: React.ReactNode = null;
  if (manage && actions) {
    if (st === "pending") {
      actionsEl = (
        <>
          <button className="btn primary sm" onClick={() => actions.onSchedule(k.id)}>
            <Icon name="calplus" />
            보강 일정
          </button>
          <button className="btn ghost sm" onClick={() => actions.onSkip(k.id)}>
            <Icon name="ban" />
            미진행
          </button>
        </>
      );
    } else if (st === "skip") {
      actionsEl = (
        <>
          <button className="btn ghost sm" onClick={() => actions.onSkip(k.id)}>
            <Icon name="edit" />
            수정
          </button>
          <button className="btn ghost sm" onClick={() => actions.onRevert(k.id)}>
            <Icon name="undo" />
            대기로
          </button>
          <button className="btn danger sm" onClick={() => actions.onDelete(k.id)}>
            <Icon name="trash" />
          </button>
        </>
      );
    } else {
      actionsEl = (
        <>
          <button className="btn ghost sm" onClick={() => actions.onSchedule(k.id)}>
            <Icon name="edit" />
            수정
          </button>
          <button className="btn ghost sm" onClick={() => actions.onRevert(k.id)}>
            <Icon name="undo" />
            대기로
          </button>
          <button className="btn danger sm" onClick={() => actions.onDelete(k.id)}>
            <Icon name="trash" />
          </button>
        </>
      );
    }
  }

  return (
    <div className={"mk-item" + (st === "pending" ? " pending" : "")}>
      <span className={"av av-" + color + " av-lg"}>{avatarText(name)}</span>
      <div className="mk-main">
        <div className="mk-name">
          {name} <MkBadge st={st} />
          {extra}
        </div>
        <div className="mk-meta">
          <span>{meta}</span>
          {k.memo && (
            <>
              <span className="sep">·</span>
              <span className="mk-memo">{k.memo}</span>
            </>
          )}
        </div>
      </div>
      {actionsEl && <div className="mk-actions">{actionsEl}</div>}
    </div>
  );
}

export function MakeupList({
  list,
  students,
  manage,
  actions,
  emptyMsg,
}: {
  list: Makeup[];
  students: Student[];
  manage: boolean;
  actions?: MakeupActions;
  emptyMsg?: string;
}) {
  if (!list.length) {
    return <Empty>{emptyMsg ?? (manage ? "보강 항목이 없습니다." : "이 달의 보강 내역이 없습니다.")}</Empty>;
  }
  return (
    <div className="mk-list">
      {list.map((k) => (
        <MkRow key={k.id} k={k} students={students} manage={manage} actions={actions} />
      ))}
    </div>
  );
}
