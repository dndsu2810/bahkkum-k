import { useState } from "react";
import type { BoardTask } from "../lib/hubApi";
import type { UserRow } from "../lib/authApi";
import { DateField } from "./DateControls";

/** 빈 새 업무 — '자세히 입력/배정'으로 만들 때 모달에 채울 기본값(요청자는 저장 시 서버가 로그인 이름 자동). */
export function blankTask(title = "", patch: Partial<BoardTask> = {}): BoardTask {
  return { id: "", title, status: "todo", tag: "", due: "", studentId: "", memo: "", assignee: "", priority: "normal", source: "", createdAt: 0, doneAt: null, archived: false, adminOnly: false, assignDate: "", stages: [], now: false, requester: "", ...patch };
}

/** 업무 자세히 입력·배정 팝업 — 제목·요청자·세부지시·담당자·단계별·마감·우선순위·공개범위를 한 번에. */
export function TaskModal({
  task,
  users,
  isAdmin,
  onClose,
  onSave,
  onDelete,
  heading = "업무 카드",
  saveLabel = "저장",
}: {
  task: BoardTask;
  users: UserRow[];
  isAdmin: boolean;
  onClose: () => void;
  onSave: (t: BoardTask) => void;
  onDelete?: (t: BoardTask) => void;
  heading?: string;
  saveLabel?: string;
}) {
  const [f, setF] = useState<BoardTask>(task);
  const set = <K extends keyof BoardTask>(k: K, v: BoardTask[K]) => setF((c) => ({ ...c, [k]: v }));

  // 담당자는 쉼표로 구분된 여러 명. 칩 토글로 추가/제거.
  const assigned = f.assignee.split(",").map((s) => s.trim()).filter(Boolean);
  const toggleAssignee = (name: string) => {
    const next = assigned.includes(name) ? assigned.filter((n) => n !== name) : [...assigned, name];
    set("assignee", next.join(", "));
  };
  // 단계별 담당자 — 1차 제작 · 2차 검수 …(라벨 + 담당). '+ 단계 추가'로 N차까지.
  const stages = f.stages || [];
  const STAGE_DEFAULTS = ["1차 제작", "2차 검수"];
  const setStages = (st: typeof stages) => set("stages", st);
  const addStage = () => setStages([...stages, { label: STAGE_DEFAULTS[stages.length] || `${stages.length + 1}차`, who: "" }]);
  const patchStage = (i: number, k: "label" | "who", v: string) => setStages(stages.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <div className="prof-overlay" onClick={onClose}>
      <div className="prof" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="prof-top">
          <div className="prof-top-main"><div className="prof-name">{heading}</div></div>
          <button className="modal-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="prof-body">
          <label className="prof-field">
            <span className="prof-field-l">제목</span>
            <input className="inline-input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="제목" />
          </label>
          <label className="prof-field">
            <span className="prof-field-l">요청자 (누가 시킨 일인지)</span>
            <input className="inline-input" value={f.requester || ""} onChange={(e) => set("requester", e.target.value)} placeholder="만든 사람 이름이 자동으로 들어가요" />
          </label>
          <label className="prof-field">
            <span className="prof-field-l">세부 지시 내용</span>
            <textarea className="input prof-memo" rows={4} value={f.memo} onChange={(e) => set("memo", e.target.value)} placeholder="자세한 지시·메모(여러 줄)" />
          </label>
          <label className="prof-field">
            <span className="prof-field-l">담당자 (여러 명 선택 가능)</span>
            <div className="sm-subj">
              {users.map((u) => (
                <button
                  type="button"
                  key={u.id}
                  className={"sm-subj-chip" + (assigned.includes(u.name) ? " on" : "")}
                  onClick={() => toggleAssignee(u.name)}
                >
                  {u.name}
                </button>
              ))}
              {users.length === 0 && <span className="hub-muted">등록된 강사가 없어요.</span>}
            </div>
          </label>
          <label className="prof-field">
            <span className="prof-field-l">단계별 담당자 (1차 제작 · 2차 검수 …)</span>
            <div className="task-stages">
              {stages.map((s, i) => (
                <div className="task-stage-row" key={i}>
                  <input className="inline-input task-stage-label" value={s.label} onChange={(e) => patchStage(i, "label", e.target.value)} placeholder="단계 (예: 1차 제작)" />
                  <select className="inline-input task-stage-who" value={s.who} onChange={(e) => patchStage(i, "who", e.target.value)}>
                    <option value="">담당 미정</option>
                    {users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                  </select>
                  <button type="button" className="task-stage-x" onClick={() => setStages(stages.filter((_, j) => j !== i))} aria-label="단계 삭제">×</button>
                </div>
              ))}
              <button type="button" className="btn ghost sm" onClick={addStage}>+ 단계 추가</button>
            </div>
          </label>
          <label className="prof-field">
            <span className="prof-field-l">마감일</span>
            <DateField value={f.due} onChange={(v) => set("due", v)} placeholder="마감일 없음" />
          </label>
          <label className="prof-field">
            <span className="prof-field-l">우선순위</span>
            <div className="sm-subj">
              <button className={"sm-subj-chip" + (f.priority === "urgent" ? " on urgent" : "")} onClick={() => set("priority", "urgent")}>급한 일</button>
              <button className={"sm-subj-chip" + (f.priority === "normal" ? " on" : "")} onClick={() => set("priority", "normal")}>일반</button>
            </div>
          </label>
          {isAdmin && (
            <label className="prof-field">
              <span className="prof-field-l">공개 범위</span>
              <div className="sm-subj">
                <button className={"sm-subj-chip" + (f.adminOnly ? " on" : "")} onClick={() => set("adminOnly", true)}>원장 전용</button>
                <button className={"sm-subj-chip" + (!f.adminOnly ? " on" : "")} onClick={() => set("adminOnly", false)}>강사에게 공개</button>
              </div>
            </label>
          )}
        </div>
        <div className="prof-foot">
          {onDelete && <button className="btn ghost" style={{ marginRight: "auto", color: "var(--bad)" }} onClick={() => onDelete(f)}>삭제</button>}
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={() => onSave(f)} disabled={!f.title.trim()}>{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}
