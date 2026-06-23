// 통합 보강관리 — 수학·영어 보강을 한곳에 모아 보는 공통 화면.
// 위쪽: '보강 하루 전'·'보강 당일' 안내(학부모·학생 문자 복붙) / 아래쪽: 대기·예정·완료 관리(기존 그대로).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Makeup } from "../types";
import { useStore } from "../store";
import { mkStatus, studentById } from "../lib/logic";
import { findBoKey } from "../lib/attendanceLogic";
import { fmtMDDow, todayStr, ymd, TODAY } from "../lib/dates";
import { engApi, type EngMakeup } from "../lib/engApi";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { ScheduleModal, SkipModal, MakeupModal } from "../components/modals";
import { EngMakeupModal } from "./English";
import { CopyMsgBtn, parentMakeupMsg, studentMakeupMsg } from "../components/MakeupList";
import { Empty } from "../components/ui";
import { Icon } from "../icons";

type USt = "pending" | "scheduled" | "done" | "skip";
/** 수학·영어 보강을 합친 통합 표시 모델. */
interface U {
  subject: "math" | "eng";
  id: string;
  studentId: string;
  name: string;
  parentPhone: string;
  studentPhone: string;
  st: USt;
  absentDate: string;
  makeupDate: string;
  makeupTime: string;
  memo: string;
  math?: Makeup;
  eng?: EngMakeup;
}

const subjLabel = (u: U) => (u.subject === "math" ? "수학" : "영어");
function addDay(base: Date, n: number): Date { const d = new Date(base); d.setDate(d.getDate() + n); return d; }

function statusBadge(st: USt): ReactNode {
  if (st === "pending") return <span className="badge b-orange">보강 대기</span>;
  if (st === "scheduled") return <span className="badge b-blue">보강 예정</span>;
  if (st === "done") return <span className="badge b-green">보강 완료</span>;
  return <span className="badge b-gray">보강 미진행</span>;
}

function metaOf(u: U): string {
  if (u.st === "pending") return "결석 " + (u.absentDate ? fmtMDDow(u.absentDate) : "미정") + " · 보강일 미정";
  if (u.st === "skip") return "결석 " + (u.absentDate ? fmtMDDow(u.absentDate) : "미정") + " · 보강 미진행";
  let m = "보강 " + fmtMDDow(u.makeupDate) + (u.makeupTime ? " " + u.makeupTime : "");
  if (u.absentDate) m += " · 결석 " + fmtMDDow(u.absentDate);
  return m;
}

export function IntegratedMakeup() {
  const { data, mutate, toast, openModal } = useStore();
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [engList, setEngList] = useState<EngMakeup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showArchive, setShowArchive] = useState(false);

  const engReload = useCallback(() => engApi.makeups().then(setEngList).catch(() => {}), []);
  useEffect(() => {
    let alive = true;
    Promise.all([
      getRoster().catch(() => [] as RosterStudent[]),
      engApi.makeups().catch(() => [] as EngMakeup[]),
    ]).then(([r, e]) => {
      if (!alive) return;
      setRoster(r);
      setEngList(e);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  // 이름·연락처는 공통 학생 마스터(로스터)에서. 휴원·퇴원 학생 보강은 숨김(명단엔 남음).
  const info = useMemo(() => {
    const m: Record<string, { name: string; parentPhone: string; studentPhone: string; active: boolean }> = {};
    for (const s of roster) m[s.id] = { name: s.name, parentPhone: s.parentPhone, studentPhone: s.studentPhone, active: s.status !== "퇴원" && s.status !== "휴원" };
    return m;
  }, [roster]);
  const engStudents = useMemo(() => roster.filter((s) => s.subjects.includes("english")), [roster]);

  const all = useMemo<U[]>(() => {
    const out: U[] = [];
    for (const k of data.makeups) {
      const inf = info[k.studentId];
      if (inf && !inf.active) continue;
      out.push({
        subject: "math", id: k.id, studentId: k.studentId,
        name: inf?.name ?? (studentById(data.students, k.studentId)?.name ?? "(삭제된 학생)"),
        parentPhone: inf?.parentPhone ?? "", studentPhone: inf?.studentPhone ?? "",
        st: mkStatus(k), absentDate: k.absentDate, makeupDate: k.makeupDate, makeupTime: k.makeupTime, memo: k.memo, math: k,
      });
    }
    for (const mk of engList) {
      const inf = info[mk.studentId];
      if (inf && !inf.active) continue;
      const waiting = mk.status === "대기" || !mk.makeupDate;
      const st: USt = waiting ? "pending" : mk.status === "완료" ? "done" : mk.status === "취소" ? "skip" : "scheduled";
      out.push({
        subject: "eng", id: mk.id, studentId: mk.studentId,
        name: inf?.name ?? "(삭제된 학생)",
        parentPhone: inf?.parentPhone ?? "", studentPhone: inf?.studentPhone ?? "",
        st, absentDate: mk.absentDate, makeupDate: mk.makeupDate, makeupTime: mk.makeupTime, memo: mk.memo, eng: mk,
      });
    }
    return out;
  }, [data.makeups, data.students, engList, info]);

  // ── 분류 ──
  const todayS = todayStr();
  const tmrwS = ymd(addDay(TODAY, 1));
  const archiveCutoff = ymd(addDay(TODAY, -7));
  const byTime = (a: U, b: U) => (a.makeupTime || "").localeCompare(b.makeupTime || "") || a.name.localeCompare(b.name);
  const absDesc = (a: U, b: U) => (a.absentDate < b.absentDate ? 1 : a.absentDate > b.absentDate ? -1 : 0);

  const dayBefore = all.filter((u) => u.st === "scheduled" && u.makeupDate === tmrwS).sort(byTime);
  const dayOf = all.filter((u) => (u.st === "scheduled" || u.st === "done") && u.makeupDate === todayS).sort(byTime);
  const pending = all.filter((u) => u.st === "pending").sort(absDesc);
  const scheduled = all.filter((u) => u.st === "scheduled").sort((a, b) => (a.makeupDate > b.makeupDate ? 1 : a.makeupDate < b.makeupDate ? -1 : byTime(a, b)));
  const doneAll = all.filter((u) => u.st === "done").sort((a, b) => (a.makeupDate < b.makeupDate ? 1 : -1));
  const doneActive = doneAll.filter((u) => !(u.makeupDate && u.makeupDate < archiveCutoff));
  const doneArchived = doneAll.filter((u) => u.makeupDate && u.makeupDate < archiveCutoff);
  const skipped = all.filter((u) => u.st === "skip").sort(absDesc);

  // ── 수학 보강 처리(기존 보강 관리와 동일 로직) ──
  function mathComplete(id: string) {
    mutate((d) => {
      const k = d.makeups.find((m) => m.id === id);
      if (!k) return;
      k.status = "done";
      if (k.makeupDate) {
        const exist = findBoKey(d.attendance, k.makeupDate, k.studentId);
        const key = exist || k.makeupDate + "|" + k.studentId + "|" + (k.makeupTime || "");
        d.attendance[key] = { ...(d.attendance[key] || {}), status: "보강", note: d.attendance[key]?.note || k.memo || "" };
      }
    });
    toast("보강 완료 처리했어요.");
  }
  function mathUncomplete(id: string) {
    mutate((d) => {
      const k = d.makeups.find((m) => m.id === id);
      if (!k) return;
      k.status = "scheduled";
      const exist = findBoKey(d.attendance, k.makeupDate, k.studentId);
      delete d.attendance[exist || k.makeupDate + "|" + k.studentId + "|" + (k.makeupTime || "")];
    });
    toast("보강 예정으로 되돌렸어요.");
  }
  function mathRevert(id: string) {
    mutate((d) => {
      const k = d.makeups.find((m) => m.id === id);
      if (!k) return;
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
  }
  function mathDelete(id: string) {
    mutate((d) => {
      const k = d.makeups.find((m) => m.id === id);
      if (k?.makeupDate) {
        const exist = findBoKey(d.attendance, k.makeupDate, k.studentId);
        if (exist) delete d.attendance[exist];
      }
      if (k?.attKey) d.dismissedMakeups = [...new Set([...(d.dismissedMakeups || []), k.attKey])];
      d.makeups = d.makeups.filter((m) => m.id !== id);
    });
    toast("보강 항목을 삭제했어요.");
  }

  // ── 영어 보강 처리 ──
  const engStatus = async (mk: EngMakeup, status: string) => { await engApi.saveMakeup({ ...mk, status }); engReload(); };
  const engRemove = async (mk: EngMakeup) => { if (!window.confirm("이 보강을 삭제할까요?")) return; await engApi.removeMakeup(mk.id); engReload(); };
  const engEdit = (mk: EngMakeup | null) => openModal(<EngMakeupModal students={engStudents} initial={mk} onSaved={engReload} />);

  // ── 공통 디스패처(과목별로 알맞은 처리로 분기) ──
  const act = {
    schedule: (u: U) => (u.subject === "math" ? openModal(<ScheduleModal id={u.id} />) : engEdit(u.eng!)),
    edit: (u: U) => (u.subject === "math" ? openModal(<ScheduleModal id={u.id} />) : engEdit(u.eng!)),
    complete: (u: U) => (u.subject === "math" ? mathComplete(u.id) : void engStatus(u.eng!, "완료")),
    uncomplete: (u: U) => (u.subject === "math" ? mathUncomplete(u.id) : void engStatus(u.eng!, "예정")),
    revert: (u: U) => (u.subject === "math" ? mathRevert(u.id) : void engStatus(u.eng!, "대기")),
    skip: (u: U) => (u.subject === "math" ? openModal(<SkipModal id={u.id} />) : void engStatus(u.eng!, "취소")),
    unskip: (u: U) => (u.subject === "math" ? mathRevert(u.id) : void engStatus(u.eng!, "예정")),
    del: (u: U) => (u.subject === "math" ? mathDelete(u.id) : void engRemove(u.eng!)),
  };

  function actionsFor(u: U): ReactNode {
    const isSched = u.st === "scheduled" || u.st === "done";
    const copy = isSched ? (
      <>
        <CopyMsgBtn label="학부모 문자" text={parentMakeupMsg(u.name, u, subjLabel(u))} />
        <CopyMsgBtn label="학생 문자" text={studentMakeupMsg(u.name, u, subjLabel(u))} />
      </>
    ) : null;
    if (u.st === "pending") {
      return (
        <>
          <button className="btn primary sm" onClick={() => act.schedule(u)}><Icon name="calplus" />보강 일정</button>
          <button className="btn ghost sm" onClick={() => act.skip(u)}><Icon name="ban" />미진행</button>
          <button className="btn danger sm" onClick={() => act.del(u)}><Icon name="trash" /></button>
        </>
      );
    }
    if (u.st === "scheduled") {
      return (
        <>
          {copy}
          <button className="btn primary sm" onClick={() => act.complete(u)}><Icon name="check" />보강 완료</button>
          <button className="btn ghost sm" onClick={() => act.edit(u)}><Icon name="edit" />수정</button>
          {u.subject === "math"
            ? <button className="btn ghost sm" onClick={() => act.revert(u)}><Icon name="undo" />대기로</button>
            : <button className="btn ghost sm" onClick={() => act.skip(u)}><Icon name="ban" />미진행</button>}
          <button className="btn danger sm" onClick={() => act.del(u)}><Icon name="trash" /></button>
        </>
      );
    }
    if (u.st === "done") {
      return (
        <>
          {copy}
          <button className="btn ghost sm" onClick={() => act.uncomplete(u)}><Icon name="undo" />완료 취소</button>
          <button className="btn ghost sm" onClick={() => act.edit(u)}><Icon name="edit" />수정</button>
          <button className="btn danger sm" onClick={() => act.del(u)}><Icon name="trash" /></button>
        </>
      );
    }
    return (
      <>
        {u.subject === "math" ? (
          <>
            <button className="btn ghost sm" onClick={() => act.skip(u)}><Icon name="edit" />수정</button>
            <button className="btn ghost sm" onClick={() => act.revert(u)}><Icon name="undo" />대기로</button>
          </>
        ) : (
          <button className="btn ghost sm" onClick={() => act.unskip(u)}><Icon name="undo" />예정으로</button>
        )}
        <button className="btn danger sm" onClick={() => act.del(u)}><Icon name="trash" /></button>
      </>
    );
  }

  function URow({ u }: { u: U }) {
    const isSched = u.st === "scheduled" || u.st === "done";
    return (
      <div className={"mk-item" + (u.st === "pending" ? " pending" : "")}>
        <div className="mk-main">
          <div className="mk-name">
            <span className={"mk-subj " + u.subject}>{subjLabel(u)}</span>
            {u.name} {statusBadge(u.st)}
          </div>
          <div className="mk-meta">
            <span>{metaOf(u)}</span>
            {u.memo && (<><span className="sep">·</span><span className="mk-memo">{u.memo}</span></>)}
          </div>
          {isSched && (u.parentPhone || u.studentPhone) && (
            <div className="mk-phones">
              {u.parentPhone && <CopyMsgBtn label={"학부모 " + u.parentPhone} text={u.parentPhone} />}
              {u.studentPhone && <CopyMsgBtn label={"학생 " + u.studentPhone} text={u.studentPhone} />}
            </div>
          )}
        </div>
        <div className="mk-actions">{actionsFor(u)}</div>
      </div>
    );
  }

  function Section({ title, desc, list, emptyMsg, highlight }: { title: string; desc?: string; list: U[]; emptyMsg: string; highlight?: boolean }) {
    return (
      <div className="mk-group">
        <div className="mk-grouphead">{title} <span className="gcnt">{list.length}건</span></div>
        {desc && <div className="page-desc" style={{ margin: "-4px 0 9px 2px" }}>{desc}</div>}
        <div className={"card" + (highlight ? " mk-hi" : "")}>
          {list.length === 0 ? <Empty>{emptyMsg}</Empty> : <div className="mk-list">{list.map((u) => <URow key={u.subject + ":" + u.id} u={u} />)}</div>}
        </div>
      </div>
    );
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">통합 보강관리</h1>
          <div className="page-desc">수학·영어 보강을 한곳에서 봐요. 하루 전·당일 안내 문자를 복사해 보내고, 아래에서 대기·예정·완료를 관리해요.</div>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => openModal(<MakeupModal />)}><Icon name="plus" />수학 결석/보강</button>
          <button className="btn ghost" onClick={() => engEdit(null)}><Icon name="plus" />영어 보강</button>
        </div>
      </div>

      {!loaded ? (
        <div className="hub-muted" style={{ padding: 20 }}>보강 내역을 불러오는 중…</div>
      ) : (
        <>
          <Section
            title="보강 하루 전 (내일)"
            desc="내일 보강 학생이에요. 학부모·학생에게 안내 문자를 복사해 보내세요. 연락처도 눌러서 복사할 수 있어요."
            list={dayBefore}
            emptyMsg="내일 예정된 보강이 없어요."
            highlight
          />
          <Section
            title="보강 당일 (오늘)"
            desc="오늘 보강 학생이에요. 보강이 끝나면 ‘보강 완료’를 눌러 정리하세요."
            list={dayOf}
            emptyMsg="오늘 예정된 보강이 없어요."
            highlight
          />

          <div className="mk-divider">전체 보강 관리</div>

          <Section
            title="보강 대기"
            desc="결석으로 잡힌 보강이에요. 일정을 정하거나 미진행으로 정리하세요."
            list={pending}
            emptyMsg="보강 대기 중인 결석이 없어요."
          />
          <Section title="보강 예정" list={scheduled} emptyMsg="예정된 보강이 없어요." />
          <Section title="보강 완료" list={doneActive} emptyMsg="완료된 보강이 없어요." />
          {skipped.length > 0 && <Section title="보강 미진행" list={skipped} emptyMsg="" />}

          {doneArchived.length > 0 && (
            <div className="mk-group">
              <button className="mk-archive-toggle" onClick={() => setShowArchive((v) => !v)} aria-expanded={showArchive}>
                <span className={"nav-caret" + (showArchive ? "" : " closed")}>▾</span>
                보관함 <span className="gcnt">{doneArchived.length}건</span>
                <span className="mk-archive-hint">완료 후 7일 지난 보강 (자동 보관)</span>
              </button>
              {showArchive && (
                <div className="card">
                  <div className="mk-list">{doneArchived.map((u) => <URow key={u.subject + ":" + u.id} u={u} />)}</div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
