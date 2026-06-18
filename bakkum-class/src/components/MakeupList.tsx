import { useState } from "react";
import type { Makeup, MakeupDisplay, Student } from "../types";
import { mkStatus, studentById } from "../lib/logic";
import { fmtMDDow, parseD, DOW } from "../lib/dates";
import { copyText } from "../lib/report";
import { Empty } from "./ui";
import { Icon } from "../icons";

/** YYYY-MM-DD → "6월 23일(월)" (시간 있으면 뒤에 붙임). 문자 양식용. */
function koDateTime(date: string, time?: string): string {
  if (!date) return "";
  const d = parseD(date);
  const s = `${d.getMonth() + 1}월 ${d.getDate()}일(${DOW[d.getDay()]})`;
  return time ? `${s} ${time}` : s;
}

/** 보강 안내 문자 — 학부모용(채널톡 안내 형식 · 결석 사유 + 미등원 시 사라짐 안내 포함). */
function parentMakeupMsg(name: string, k: Makeup, subject: string): string {
  const mk = koDateTime(k.makeupDate, k.makeupTime);
  return (
    `안녕하세요, 바꿈영수학원입니다.\n\n` +
    `${name} 학생의 ${subject} 보강 일정을 안내드립니다.\n\n` +
    (k.absentDate ? `• 결석일 : ${koDateTime(k.absentDate)}\n` : "") +
    `• 보강 일시 : ${mk}\n\n` +
    `보강일에 꼭 등원할 수 있도록 부탁드립니다.\n` +
    `미등원 시 보강은 사라지니 참고 부탁드려요.\n\n` +
    `감사합니다.`
  );
}

/** 보강 안내 문자 — 학생용(하루 전 알림 · '미등원 시 사라짐' 문구 제외). */
function studentMakeupMsg(name: string, k: Makeup, subject: string): string {
  const mk = koDateTime(k.makeupDate, k.makeupTime);
  return (
    `[바꿈영수학원] 보강 일정 안내\n\n` +
    `${name} 학생, 내일 ${subject} 보강 수업이 있어요!\n\n` +
    `• 보강 일시 : ${mk}\n\n` +
    `잊지 말고 꼭 등원해 주세요 :)\n` +
    `감사합니다.`
  );
}

/** 문자 양식 복사 버튼 — 누르면 클립보드에 복사하고 잠깐 '복사됨' 표시. */
function CopyMsgBtn({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={"btn ghost sm" + (done ? " ok" : "")}
      title={text}
      onClick={async () => {
        await copyText(text);
        setDone(true);
        window.setTimeout(() => setDone(false), 1300);
      }}
    >
      <Icon name="copy" />
      {done ? "복사됨" : label}
    </button>
  );
}

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
  onComplete?: (id: string) => void; // 예정 → 완료
  onUncomplete?: (id: string) => void; // 완료 → 예정
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
          <button className="btn danger sm" onClick={() => actions.onDelete(k.id)}>
            <Icon name="trash" />
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
    } else if (st === "done") {
      actionsEl = (
        <>
          {actions.onUncomplete && (
            <button className="btn ghost sm" onClick={() => actions.onUncomplete!(k.id)}>
              <Icon name="undo" />
              완료 취소
            </button>
          )}
          <button className="btn ghost sm" onClick={() => actions.onSchedule(k.id)}>
            <Icon name="edit" />
            수정
          </button>
          <button className="btn danger sm" onClick={() => actions.onDelete(k.id)}>
            <Icon name="trash" />
          </button>
        </>
      );
    } else {
      actionsEl = (
        <>
          <CopyMsgBtn label="학부모 문자" text={parentMakeupMsg(name, k, "수학")} />
          <CopyMsgBtn label="학생 문자" text={studentMakeupMsg(name, k, "수학")} />
          {actions.onComplete && (
            <button className="btn primary sm" onClick={() => actions.onComplete!(k.id)}>
              <Icon name="check" />
              보강 완료
            </button>
          )}
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
    return <Empty>{emptyMsg ?? (manage ? "보강 항목이 없어요." : "이 달 보강 내역이 없어요.")}</Empty>;
  }
  return (
    <div className="mk-list">
      {list.map((k) => (
        <MkRow key={k.id} k={k} students={students} manage={manage} actions={actions} />
      ))}
    </div>
  );
}
