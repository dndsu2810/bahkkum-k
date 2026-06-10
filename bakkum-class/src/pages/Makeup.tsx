import { type ReactNode } from "react";
import type { Makeup } from "../types";
import { useStore } from "../store";
import { byAbsentDesc, mkStatus } from "../lib/logic";
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

  const pending = data.makeups.filter((k) => mkStatus(k) === "pending").sort(byAbsentDesc);
  const arranged = data.makeups
    .filter((k) => {
      const s = mkStatus(k);
      return s === "scheduled" || s === "done";
    })
    .sort((a, b) => (a.makeupDate < b.makeupDate ? 1 : -1));
  const skipped = data.makeups.filter((k) => mkStatus(k) === "skip").sort(byAbsentDesc);

  const actions: MakeupActions = {
    onSchedule: (id) => openModal(<ScheduleModal id={id} />),
    onSkip: (id) => openModal(<SkipModal id={id} />),
    onComplete: (id) => {
      mutate((d) => {
        const k = d.makeups.find((m) => m.id === id);
        if (!k) return;
        k.status = "done";
        // 보강 출결 기록(앱 내부) 생성 → 달력/리포트에 '보강 (시각)'으로 표시.
        if (k.makeupDate) {
          const key = k.makeupDate + "|" + k.studentId + "|" + (k.makeupTime || "");
          d.attendance[key] = { ...(d.attendance[key] || {}), status: "보강" };
        }
      });
      toast("보강 완료 처리했어요.");
    },
    onUncomplete: (id) => {
      mutate((d) => {
        const k = d.makeups.find((m) => m.id === id);
        if (!k) return;
        k.status = "scheduled";
        const key = k.makeupDate + "|" + k.studentId + "|" + (k.makeupTime || "");
        delete d.attendance[key];
      });
      toast("보강 예정으로 되돌렸어요.");
    },
    onRevert: (id) => {
      mutate((d) => {
        const k = d.makeups.find((m) => m.id === id);
        if (k) {
          k.status = "pending";
          k.makeupDate = "";
          k.makeupTime = "";
          k.parentContacted = false;
        }
      });
      toast("보강 대기로 되돌렸어요.");
    },
    onDelete: (id) => {
      mutate((d) => {
        const k = d.makeups.find((m) => m.id === id);
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
          <div className="page-title">보강 관리</div>
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
        desc="출결 체크에서 결석 처리된 학생입니다. 보강 일정을 잡거나, 미진행으로 정리하세요."
        emptyMsg="보강 대기 중인 결석이 없습니다."
      >
        <MakeupList
          list={pending}
          students={data.students}
          manage
          actions={actions}
          emptyMsg="보강 대기 중인 결석이 없습니다."
        />
      </MkGroup>

      <MkGroup title="보강 예정 · 완료" list={arranged}>
        <MakeupList list={arranged} students={data.students} manage actions={actions} />
      </MkGroup>

      <MkGroup title="보강 미진행" list={skipped}>
        <MakeupList list={skipped} students={data.students} manage actions={actions} />
      </MkGroup>
    </section>
  );
}
