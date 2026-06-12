import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import type { Student, Task, TaskStatus } from "../types";
import { activeStudents, studentById } from "../lib/logic";
import { todayStr, fmtMDDow, uid } from "../lib/dates";
import { Icon } from "../icons";
import { Empty } from "../components/ui";

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "todo", label: "할 일" },
  { key: "doing", label: "진행 중" },
  { key: "done", label: "완료" },
];

export const TASK_TAGS = ["보강", "학부모", "교재", "경시", "마케팅", "행정", "수업준비"];
const TAG_TONE: Record<string, string> = {
  보강: "b-blue",
  학부모: "b-pink",
  교재: "b-green",
  경시: "b-purple",
  마케팅: "b-orange",
  행정: "b-gray",
  수업준비: "b-blue",
};
const ARCHIVE_DAYS = 7;

export function Board() {
  const { data, mutate, openModal } = useStore();
  const tasks = data.tasks || [];
  const today = todayStr();
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTag, setDraftTag] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [showArchive, setShowArchive] = useState(false);

  // 완료 후 7일 지난 카드는 보관함으로 자동 이동 (마운트 시 1회)
  useEffect(() => {
    const cutoff = Date.now() - ARCHIVE_DAYS * 86400000;
    const stale = (data.tasks || []).filter((t) => t.status === "done" && !t.archived && t.doneAt && t.doneAt < cutoff);
    if (stale.length) {
      const ids = new Set(stale.map((t) => t.id));
      mutate((d) => {
        for (const t of d.tasks || []) if (ids.has(t.id)) t.archived = true;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = tasks.filter((t) => !t.archived);
  const byCol = (s: TaskStatus) => live.filter((t) => t.status === s).sort(sortTasks);

  function addTask() {
    const title = draftTitle.trim();
    if (!title) return;
    const t: Task = { id: uid(), title, status: "todo", tag: draftTag || undefined, createdAt: Date.now() };
    mutate((d) => { (d.tasks ||= []).push(t); });
    setDraftTitle("");
  }
  function moveTask(id: string, status: TaskStatus) {
    mutate((d) => {
      const t = (d.tasks || []).find((x) => x.id === id);
      if (!t || t.status === status) return;
      t.status = status;
      if (status === "done") t.doneAt = Date.now();
      else t.doneAt = undefined;
    });
  }
  function removeTask(id: string) {
    mutate((d) => { d.tasks = (d.tasks || []).filter((x) => x.id !== id); });
  }
  function archiveDone() {
    mutate((d) => {
      for (const t of d.tasks || []) if (t.status === "done" && !t.archived) t.archived = true;
    });
  }

  function onDrop(status: TaskStatus) {
    if (dragId) moveTask(dragId, status);
    setDragId(null);
    setOverCol(null);
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">강사 업무</h1>
          <div className="page-desc">할 일을 카드로 관리해요. 카드를 끌어 칸을 옮기면 상태가 바뀝니다.</div>
        </div>
      </div>

      {/* 빠른 추가 */}
      <div className="card sec-gap board-add">
        <input
          className="input"
          placeholder="할 일을 입력하고 Enter (예: 정시우 보강 일정 잡기)"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
        />
        <select className="ctrl board-add-tag" value={draftTag} onChange={(e) => setDraftTag(e.target.value)}>
          <option value="">분류 없음</option>
          {TASK_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn primary" onClick={addTask}><Icon name="plus" />추가</button>
      </div>

      <div className="board-cols">
        {COLUMNS.map((col) => {
          const items = byCol(col.key);
          return (
            <div
              key={col.key}
              className={"board-col" + (overCol === col.key ? " over" : "")}
              onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
              onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
              onDrop={() => onDrop(col.key)}
            >
              <div className="board-col-head">
                <span className="board-col-title">{col.label}</span>
                <span className="board-col-cnt">{items.length}</span>
              </div>
              <div className="board-col-body">
                {items.length === 0 ? (
                  <div className="board-empty">{col.key === "todo" ? "할 일을 추가하세요" : "비어 있음"}</div>
                ) : (
                  items.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      today={today}
                      students={data.students}
                      onDragStart={() => setDragId(t.id)}
                      onEdit={() => openModal(<TaskModal id={t.id} />)}
                      onComplete={() => moveTask(t.id, "done")}
                      onDelete={() => removeTask(t.id)}
                    />
                  ))
                )}
              </div>
              {col.key === "done" && (
                <div className="board-col-foot">
                  <button className="brief-link" onClick={archiveDone}>완료 카드 정리</button>
                  <button className="brief-link" onClick={() => setShowArchive(true)}>보관함 보기</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showArchive && <ArchiveView onClose={() => setShowArchive(false)} />}
    </section>
  );
}

function sortTasks(a: Task, b: Task): number {
  // 마감일 있는 것 먼저(가까운 순), 그 다음 생성 최신순
  const ad = a.due || "9999", bd = b.due || "9999";
  if (ad !== bd) return ad < bd ? -1 : 1;
  return b.createdAt - a.createdAt;
}

function TaskCard({
  task, today, students, onDragStart, onEdit, onComplete, onDelete,
}: {
  task: Task;
  today: string;
  students: Student[];
  onDragStart: () => void;
  onEdit: () => void;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const done = task.status === "done";
  const stu = task.studentId ? studentById(students, task.studentId) : undefined;
  const overdue = !!task.due && !done && task.due < today;
  const dueLabel = task.due ? (task.due === today ? "오늘" : fmtMDDow(task.due)) : "";
  return (
    <div
      className={"task-card" + (done ? " done" : "")}
      draggable
      onDragStart={onDragStart}
    >
      <div className="task-main" onClick={onEdit}>
        <div className="task-title">
          {done && <span className="task-check"><Icon name="check" /></span>}
          {task.title}
        </div>
        <div className="task-meta">
          {task.tag && <span className={"badge " + (TAG_TONE[task.tag] || "b-gray")}>{task.tag}</span>}
          {stu && <span className="task-stu">{stu.name}</span>}
          {dueLabel && <span className={"task-due" + (overdue ? " overdue" : "")}><Icon name="cal" />{dueLabel}</span>}
        </div>
      </div>
      <div className="task-actions">
        {!done && <button className="task-iconbtn" title="완료" onClick={onComplete}><Icon name="check" /></button>}
        <button className="task-iconbtn" title="수정" onClick={onEdit}><Icon name="edit" /></button>
        <button className="task-iconbtn danger" title="삭제" onClick={onDelete}><Icon name="trash" /></button>
      </div>
    </div>
  );
}

/* ---------- 보관함 ---------- */
function ArchiveView({ onClose }: { onClose: () => void }) {
  const { data, mutate } = useStore();
  const archived = (data.tasks || []).filter((t) => t.archived);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");

  const filtered = useMemo(() => {
    return archived
      .filter((t) => (tag ? t.tag === tag : true))
      .filter((t) => (q ? (t.title + " " + (t.memo || "")).toLowerCase().includes(q.toLowerCase()) : true))
      .sort((a, b) => (b.doneAt || b.createdAt) - (a.doneAt || a.createdAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archived, q, tag]);

  function restore(id: string) {
    mutate((d) => {
      const t = (d.tasks || []).find((x) => x.id === id);
      if (t) t.archived = false;
    });
  }
  function remove(id: string) {
    mutate((d) => { d.tasks = (d.tasks || []).filter((x) => x.id !== id); });
  }

  return (
    <div className="card sec-gap">
      <div className="card-head">
        <div>
          <div className="card-title">보관함</div>
          <div className="card-sub">완료 후 보관된 카드 {archived.length}건 · 되살리거나 검색할 수 있어요</div>
        </div>
        <button className="btn ghost sm" onClick={onClose}><Icon name="chev" />보드로</button>
      </div>
      <div className="board-arch-filter">
        <input className="input" placeholder="검색 (제목·메모)" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="ctrl" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">전체 분류</option>
          {TASK_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <Empty>보관된 카드가 없어요.</Empty>
      ) : (
        <div className="board-arch-list">
          {filtered.map((t) => {
            const stu = t.studentId ? studentById(data.students, t.studentId) : undefined;
            return (
              <div className="arch-row" key={t.id}>
                <div className="arch-main">
                  <div className="arch-title">{t.title}</div>
                  <div className="arch-meta">
                    {t.tag && <span className={"badge " + (TAG_TONE[t.tag] || "b-gray")}>{t.tag}</span>}
                    {stu && <span className="task-stu">{stu.name}</span>}
                    {t.doneAt && <span className="muted">{fmtMDDow(ymdOf(t.doneAt))} 완료</span>}
                  </div>
                </div>
                <div className="arch-actions">
                  <button className="btn ghost sm" onClick={() => restore(t.id)}><Icon name="undo" />되살리기</button>
                  <button className="task-iconbtn danger" title="삭제" onClick={() => remove(t.id)}><Icon name="trash" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ymdOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/* ---------- 카드 수정 모달 ---------- */
function TaskModal({ id }: { id: string }) {
  const { data, mutate, closeModal } = useStore();
  const t0 = (data.tasks || []).find((x) => x.id === id);
  const [title, setTitle] = useState(t0?.title || "");
  const [tag, setTag] = useState(t0?.tag || "");
  const [due, setDue] = useState(t0?.due || "");
  const [studentId, setStudentId] = useState(t0?.studentId || "");
  const [memo, setMemo] = useState(t0?.memo || "");
  if (!t0) return null;
  const students = activeStudents(data.students);

  function save() {
    mutate((d) => {
      const t = (d.tasks || []).find((x) => x.id === id);
      if (!t) return;
      t.title = title.trim() || t.title;
      t.tag = tag || undefined;
      t.due = due || undefined;
      t.studentId = studentId || undefined;
      t.memo = memo || undefined;
    });
    closeModal();
  }

  return (
    <>
      <div className="modal-head">
        <div className="modal-title">업무 카드 수정</div>
      </div>
      <div className="modal-body">
        <div className="field">
          <label>제목</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>분류</label>
            <select className="input" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">없음</option>
              {TASK_TAGS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div className="field">
            <label>마감일</label>
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>연결 학생</label>
          <select className="input" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">없음</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>메모</label>
          <textarea className="input" rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={closeModal}>취소</button>
        <button className="btn primary" onClick={save}>저장</button>
      </div>
    </>
  );
}
