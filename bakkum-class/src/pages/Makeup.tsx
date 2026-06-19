import { useState, type ReactNode } from "react";
import type { Makeup } from "../types";
import { useStore } from "../store";
import { byAbsentDesc, isActive, mkStatus, studentById } from "../lib/logic";

/** 오늘에서 n일 전 날짜(YYYY-MM-DD). 보강 완료 자동 보관 기준선. */
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
import { findBoKey } from "../lib/attendanceLogic";
import { MakeupList, type MakeupActions } from "../components/MakeupList";
import { ScheduleModal, SkipModal, MakeupModal } from "../components/modals";
import { Icon } from "../icons";

function MkGroup({
  title,
  list,
  desc,
  emptyMsg,
  children,
}: {
  title: string;
  list: Makeup[];
  desc?: string;
  emptyMsg?: string;
  children: ReactNode;
}) {
  if (!list.length && !emptyMsg) return null;
  return (
    <div className="mk-group">
      <div className="mk-grouphead">
        {title} <span className="gcnt">{list.length}건</span>
      </div>
      {desc && <div className="page-desc" style={{ margin: "-4px 0 9px 2px" }}>{desc}</div>}
      <div className="card">{children}</div>
    </div>
  );
}

export function MakeupPage() {
  const { data, mutate, toast, openModal } = useStore();
  const [showArchive, setShowArchive] = useState(false);

  // 재원생 보강만 — 휴원·퇴원생 보강은 숨김(재원으로 되돌리면 다시 보임). 명단엔 그대로 남음.
  const activeMakeups = data.makeups.filter((k) => { const s = studentById(data.students, k.studentId); return s ? isActive(s) : true; });
  const pending = activeMakeups.filter((k) => mkStatus(k) === "pending").sort(byAbsentDesc);
  const arranged = activeMakeups
    .filter((k) => {
      const s = mkStatus(k);
      return s === "scheduled" || s === "done";
    })
    .sort((a, b) => (a.makeupDate < b.makeupDate ? 1 : -1));
  // 완료된 보강은 보강일이 7일 지나면 자동 '보관'(목록에서 접어둠). 예정은 항상 표시. 삭제 아님 — 보관함에서 펼쳐 볼 수 있음.
  const archiveCutoff = daysAgoStr(7);
  const isArchived = (k: Makeup) => mkStatus(k) === "done" && !!k.makeupDate && k.makeupDate < archiveCutoff;
  const arrangedActive = arranged.filter((k) => !isArchived(k));
  const archived = arranged.filter(isArchived);
  const skipped = activeMakeups.filter((k) => mkStatus(k) === "skip").sort(byAbsentDesc);

  const actions: MakeupActions = {
    onSchedule: (id) => openModal(<ScheduleModal id={id} />),
    onSkip: (id) => openModal(<SkipModal id={id} />),
    onComplete: (id) => {
      mutate((d) => {
        const k = d.makeups.find((m) => m.id === id);
        if (!k) return;
        k.status = "done";
        // 보강 출결 기록(앱 내부) 생성 → 달력/리포트에 '보강 (시각)'으로 표시.
        // 같은 날짜·학생에 이미 보강 출결이 있으면 그 행을 재사용(중복 방지).
        if (k.makeupDate) {
          const exist = findBoKey(d.attendance, k.makeupDate, k.studentId);
          const key = exist || k.makeupDate + "|" + k.studentId + "|" + (k.makeupTime || "");
          d.attendance[key] = { ...(d.attendance[key] || {}), status: "보강", note: d.attendance[key]?.note || k.memo || "" };
        }
      });
      toast("보강 완료 처리했어요.");
    },
    onUncomplete: (id) => {
      mutate((d) => {
        const k = d.makeups.find((m) => m.id === id);
        if (!k) return;
        k.status = "scheduled";
        const exist = findBoKey(d.attendance, k.makeupDate, k.studentId);
        delete d.attendance[exist || k.makeupDate + "|" + k.studentId + "|" + (k.makeupTime || "")];
      });
      toast("보강 예정으로 되돌렸어요.");
    },
    onRevert: (id) => {
      mutate((d) => {
        const k = d.makeups.find((m) => m.id === id);
        if (!k) return;
        // 되돌리기 전에, 이 보강으로 만들어진 '보강' 출결 행을 제거한다.
        // (안 지우면 월말리포트 특이사항/달력에 '보강'으로 그대로 남는 문제)
        if (k.makeupDate) {
          const exist = findBoKey(d.attendance, k.makeupDate, k.studentId);
          if (exist) delete d.attendance[exist];
        }
        k.status = "pending";
        k.makeupDate = "";
        k.makeupTime = "";
        k.parentContacted = false;
      });
      toast("보강 대기로 되돌렸어요.");
    },
    onDelete: (id) => {
      mutate((d) => {
        const k = d.makeups.find((m) => m.id === id);
        // 보강으로 만들어진 출결 행도 함께 제거(월말리포트에 '보강'으로 남지 않게).
        if (k?.makeupDate) {
          const exist = findBoKey(d.attendance, k.makeupDate, k.studentId);
          if (exist) delete d.attendance[exist];
        }
        // 결석에서 자동 등록된 보강이면 att_key를 '삭제 표시'에 남겨
        // 노션 재가져오기/출결 재체크 때 되살아나지 않게 한다.
        if (k?.attKey) {
          d.dismissedMakeups = [...new Set([...(d.dismissedMakeups || []), k.attKey])];
        }
        d.makeups = d.makeups.filter((m) => m.id !== id);
      });
      toast("보강 항목을 삭제했어요.");
    },
  };

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">보강 관리</h1>
          <div className="page-desc">결석 학생 보강 일정 관리 · 대기 {pending.length}건</div>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={() => openModal(<MakeupModal />)}>
            <Icon name="plus" />
            결석/보강 추가
          </button>
        </div>
      </div>

      <MkGroup
        title="보강 대기"
        list={pending}
        desc="출결에서 결석 처리된 학생이에요. 보강 일정을 잡거나, 미진행으로 정리하세요."
        emptyMsg="보강 대기 중인 결석이 없어요."
      >
        <MakeupList
          list={pending}
          students={data.students}
          manage
          actions={actions}
          emptyMsg="보강 대기 중인 결석이 없어요."
        />
      </MkGroup>

      <MkGroup title="보강 예정 · 완료" list={arrangedActive}>
        <MakeupList list={arrangedActive} students={data.students} manage actions={actions} />
      </MkGroup>

      <MkGroup title="보강 미진행" list={skipped}>
        <MakeupList list={skipped} students={data.students} manage actions={actions} />
      </MkGroup>

      {archived.length > 0 && (
        <div className="mk-group">
          <button className="mk-archive-toggle" onClick={() => setShowArchive((v) => !v)} aria-expanded={showArchive}>
            <span className={"nav-caret" + (showArchive ? "" : " closed")}>▾</span>
            보관함 <span className="gcnt">{archived.length}건</span>
            <span className="mk-archive-hint">완료 후 7일 지난 보강 (자동 보관)</span>
          </button>
          {showArchive && (
            <div className="card">
              <MakeupList list={archived} students={data.students} manage actions={actions} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
