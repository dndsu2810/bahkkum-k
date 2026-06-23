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

/** "17:40" → "오후 5시 40분" (정시면 분 생략). 문자 양식용. */
function koAmPm(time?: string): string {
  if (!time) return "";
  const [hh, mm] = time.split(":");
  const h = Number(hh), m = Number(mm || 0);
  if (isNaN(h)) return time;
  const ap = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}시${m ? ` ${m}분` : ""}`;
}

/** 보강 문자용 최소 정보(수학·영어 보강 공용). */
type MakeupWhen = { makeupDate: string; makeupTime: string };

/** 보강 안내 문자 — 학부모용. 보강 일시는 "6월 23일(화) 오후 5시 40분" 형식. subject=수학/영어. */
export function parentMakeupMsg(name: string, k: MakeupWhen, subject: string): string {
  const when = `${koDateTime(k.makeupDate)} ${koAmPm(k.makeupTime)}`.trim();
  return (
    `[바꿈영수학원] ${subject} 보강 일정 안내\n` +
    `안녕하세요, 바꿈영수학원입니다.\n\n` +
    `${name} 학생의 ${subject} 보강 일정을 안내드립니다.\n\n` +
    `보강 일시 : ${when}\n\n` +
    `보강 수업에 차질이 없도록 정해진 시간에 등원 부탁드립니다.\n` +
    `정해진 보강일에 등원하지 않으면 보강은 자동으로 소멸되오니 유의해 주시기 바랍니다.\n\n` +
    `일정 변경이 필요하신 경우 사전에 연락 주시기 바랍니다.\n` +
    `감사합니다.`
  );
}

/** 보강 안내 문자 — 학생용(하루 전 알림). subject=수학/영어. */
export function studentMakeupMsg(name: string, k: MakeupWhen, subject: string): string {
  const when = `${koDateTime(k.makeupDate)} ${koAmPm(k.makeupTime)}`.trim();
  return (
    `[바꿈영수학원] ${subject} 보강 일정 안내\n` +
    `${name} 학생, 내일 ${subject} 보강 수업이 있어요!\n\n` +
    `보강 일시 : ${when}\n` +
    `잊지 말고 꼭 등원해 주세요. 보강일에 만나요!`
  );
}

/** 문자 양식 복사 버튼 — 누르면 클립보드에 복사하고 잠깐 '복사됨' 표시. */
export function CopyMsgBtn({ label, text }: { label: string; text: string }) {
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
