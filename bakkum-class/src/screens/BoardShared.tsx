import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useAuth } from "../auth";
import { tasksApi, type BoardTask, type TaskStatus } from "../lib/hubApi";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { listUsers, type UserRow } from "../lib/authApi";
import { DateField } from "../components/DateControls";
import { pad, todayStr } from "../lib/dates";

const ACTIVE_COLS: { key: TaskStatus; label: string }[] = [
  { key: "todo", label: "할 일" },
  { key: "doing", label: "진행 중" },
];
const NEXT: Record<TaskStatus, TaskStatus | null> = { todo: "doing", doing: "done", done: null };
const PREV: Record<TaskStatus, TaskStatus | null> = { todo: null, doing: "todo", done: "doing" };
// 완료 월 분류 키 — 배정일 우선(노션 가져온 건), 없으면 완료시각, 그것도 없으면 생성일.
const monthOf = (t: BoardTask) => {
  if (t.assignDate) return t.assignDate.slice(0, 7);
  const d = new Date(t.doneAt || t.createdAt);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

// 우선순위(급함 먼저) → 마감 빠른 순 → 최신 순
function sortTasks(arr: BoardTask[]): BoardTask[] {
  return [...arr].sort((a, b) => {
    const au = a.priority === "urgent", bu = b.priority === "urgent";
    if (au !== bu) return au ? -1 : 1;
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (a.due && !b.due) return -1;
    if (!a.due && b.due) return 1;
    return b.createdAt - a.createdAt;
  });
}

/** 공유 업무 보드 — 모든 강사가 함께 보는 칸반. 카드 클릭 시 상세/수정. 10초 폴링으로 '실시간' 근사. */
export function BoardShared() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<BoardTask | null>(null);
  const [doneMonth, setDoneMonth] = useState(() => todayStr().slice(0, 7)); // 완료 칸 월별 보기
  const editing = useRef(false);
  // 드래그로 카드를 칸 사이 이동(데스크톱). 터치/접근성용 ‹› 버튼은 그대로 유지.
  const dragId = useRef<string | null>(null);
  const [dropCol, setDropCol] = useState<TaskStatus | null>(null);

  const load = useCallback(async () => {
    try {
      setTasks(await tasksApi.list());
      setErr("");
    } catch {
      setErr("불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }, []);

  useEffect(() => {
    void load();
    getRoster().then(setRoster).catch(() => {});
    listUsers().then(setUsers).catch(() => {});
    const iv = setInterval(() => {
      if (!editing.current && !edit) void load();
    }, 10000);
    const onFocus = () => { if (!edit) void load(); };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, edit]);

  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of roster) m[s.id] = s.name;
    return m;
  }, [roster]);

  // 보관(archived)·원장 전용은 제외. 완료는 칸에서 월별로 따로 거른다(아래).
  const visible = useMemo(() => tasks.filter((t) => !t.archived && !t.adminOnly), [tasks]);
  // 전체보기 / 내 담당 보기 — 로그인 사용자가 담당자로 지정된 것만.
  const [mine, setMine] = useState(false);
  const myName = user?.name || "";
  const isMine = (t: BoardTask) => t.assignee.split(",").map((s) => s.trim()).includes(myName);
  const scoped = useMemo(() => (mine ? visible.filter(isMine) : visible), [visible, mine, myName]); // eslint-disable-line react-hooks/exhaustive-deps
  const myCount = useMemo(() => visible.filter(isMine).length, [visible, myName]); // eslint-disable-line react-hooks/exhaustive-deps
  // 완료가 있는 달 목록(최신순) — 월 이동 버튼 활성화 판단용.
  const doneMonths = useMemo(() => {
    const set = new Set<string>();
    for (const t of visible) if (t.status === "done") set.add(monthOf(t));
    return [...set].sort().reverse();
  }, [visible]);
  const shiftDoneMonth = (delta: number) => {
    const [y, m] = doneMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setDoneMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };
  // 첫 로드 때, 이번 달에 완료가 없고 지난 달들에 있으면 가장 최근 완료 달로 맞춰준다.
  const monthInit = useRef(false);
  useEffect(() => {
    if (monthInit.current || doneMonths.length === 0) return;
    monthInit.current = true;
    if (!doneMonths.includes(doneMonth)) setDoneMonth(doneMonths[0]);
  }, [doneMonths, doneMonth]);

  async function add() {
    const tt = title.trim();
    if (!tt) return;
    setTitle("");
    try {
      await tasksApi.save({ title: tt, status: "todo", priority: "normal" });
      await load();
    } catch {
      setErr("추가에 실패했어요.");
    }
  }
  async function move(t: BoardTask, dir: "next" | "prev") {
    const to = dir === "next" ? NEXT[t.status] : PREV[t.status];
    if (!to) return;
    await moveTo(t.id, to);
  }
  // 카드를 지정한 칸으로 이동(드래그 드롭·버튼 공용). 같은 칸이면 무시.
  async function moveTo(id: string, to: TaskStatus) {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === to) return;
    setTasks((cur) => cur.map((x) => (x.id === id ? { ...x, status: to } : x)));
    try {
      await tasksApi.save({ ...t, status: to });
      await load();
    } catch {
      setErr("이동에 실패했어요.");
    }
  }
  // 칸(드롭 영역) 공통 핸들러 — 드래그 중일 때만 반응.
  const colDrop = (status: TaskStatus) => ({
    onDragOver: (e: DragEvent) => { if (dragId.current) { e.preventDefault(); setDropCol(status); } },
    onDrop: (e: DragEvent) => { e.preventDefault(); const id = dragId.current; dragId.current = null; setDropCol(null); if (id) void moveTo(id, status); },
  });
  async function saveEdit(next: BoardTask) {
    setTasks((cur) => cur.map((x) => (x.id === next.id ? next : x)));
    setEdit(null);
    try {
      await tasksApi.save(next);
      await load();
    } catch {
      setErr("저장에 실패했어요.");
    }
  }
  async function remove(t: BoardTask) {
    if (!window.confirm("이 카드를 삭제할까요?")) return;
    setTasks((cur) => cur.filter((x) => x.id !== t.id));
    setEdit(null);
    try {
      await tasksApi.remove(t.id);
    } catch {
      setErr("삭제에 실패했어요.");
    }
  }

  const card = (t: BoardTask) => (
    <div
      className={"board2-card" + (t.priority === "urgent" ? " urgent" : "")}
      key={t.id}
      onClick={() => setEdit(t)}
      tabIndex={0}
      draggable
      onDragStart={(e) => { dragId.current = t.id; e.dataTransfer.effectAllowed = "move"; }}
      onDragEnd={() => { dragId.current = null; setDropCol(null); }}
    >
      {t.priority === "urgent" && <span className="board2-urgent">급함</span>}
      <div className="board2-card-title">{t.title}</div>
      {t.memo && <div className="board2-card-memo">{t.memo}</div>}
      <div className="board2-card-meta">
        {t.assignee && <span className="board2-asg">{t.assignee}</span>}
        {t.assignDate && <span className="board2-assigned">배정 {t.assignDate.slice(5)}</span>}
        {t.due && <span className="board2-due">~{t.due}</span>}
        {t.studentId && nameOf[t.studentId] && <span className="board2-stu">{nameOf[t.studentId]}</span>}
        {t.source && <span className="board2-auto">자동</span>}
      </div>
      <div className="board2-card-act" onClick={(e) => e.stopPropagation()}>
        {PREV[t.status] && <button className="board2-mv" onClick={() => move(t, "prev")} title="왼쪽으로">‹</button>}
        {NEXT[t.status] && <button className="board2-mv" onClick={() => move(t, "next")} title="오른쪽으로">›</button>}
        <button className="board2-del" onClick={() => remove(t)} title="삭제">×</button>
      </div>
    </div>
  );

  return (
    <div className="board2">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">강사 업무 보드</h1>
          <p className="sm-desc">모든 선생님이 함께 보는 보드예요. 카드를 누르면 상세·담당·마감을 수정할 수 있어요.</p>
        </div>
        <div className="seg-toggle">
          <button className={mine ? "" : "on"} onClick={() => setMine(false)}>전체보기</button>
          <button className={mine ? "on" : ""} onClick={() => setMine(true)}>내 담당 {myCount > 0 && <span className="seg-count">{myCount}</span>}</button>
        </div>
      </div>

      <div className="board2-add">
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => (editing.current = true)}
          onBlur={() => (editing.current = false)}
          onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
          placeholder="할 일을 입력하고 Enter (자세한 내용은 추가 후 카드를 눌러 편집)"
        />
        <button className="btn primary" onClick={add} disabled={!title.trim()}>추가</button>
      </div>
      {err && <div className="auth-err" style={{ margin: "8px 0" }}>{err}</div>}

      <div className="board2-cols">
        {ACTIVE_COLS.map((c) => {
          const items = sortTasks(scoped.filter((t) => t.status === c.key));
          return (
            <div className={"board2-col" + (dropCol === c.key ? " drop-over" : "")} key={c.key} {...colDrop(c.key)}>
              <div className="board2-col-h">
                {c.label} <span className="board2-cnt">{items.length}</span>
              </div>
              <div className="board2-list">
                {items.map(card)}
                {items.length === 0 && <div className="board2-empty">아직 없어요</div>}
              </div>
            </div>
          );
        })}
        {/* 완료 — 월별로 정리해서 봄(쌓이지 않게). 월 이동으로 지난 완료도 확인. */}
        {(() => {
          const items = sortTasks(scoped.filter((t) => t.status === "done" && monthOf(t) === doneMonth));
          return (
            <div className={"board2-col" + (dropCol === "done" ? " drop-over" : "")} key="done" {...colDrop("done")}>
              <div className="board2-col-h">
                완료 <span className="board2-cnt">{items.length}</span>
                <div className="board2-month">
                  <button className="board2-mv" onClick={() => shiftDoneMonth(-1)} title="이전 달">‹</button>
                  <span className="board2-month-l">{doneMonth.replace("-", ". ")}</span>
                  <button className="board2-mv" onClick={() => shiftDoneMonth(1)} disabled={doneMonth >= todayStr().slice(0, 7)} title="다음 달">›</button>
                </div>
              </div>
              <div className="board2-list">
                {items.map(card)}
                {items.length === 0 && <div className="board2-empty">이 달 완료한 일이 없어요</div>}
              </div>
            </div>
          );
        })()}
      </div>

      {edit && (
        <TaskModal task={edit} users={users} isAdmin={isAdmin} onClose={() => setEdit(null)} onSave={saveEdit} onDelete={remove} />
      )}
    </div>
  );
}

/* ---------------- 카드 상세·수정 ---------------- */
function TaskModal({
  task,
  users,
  isAdmin,
  onClose,
  onSave,
  onDelete,
}: {
  task: BoardTask;
  users: UserRow[];
  isAdmin: boolean;
  onClose: () => void;
  onSave: (t: BoardTask) => void;
  onDelete: (t: BoardTask) => void;
}) {
  const [f, setF] = useState<BoardTask>(task);
  const set = <K extends keyof BoardTask>(k: K, v: BoardTask[K]) => setF((c) => ({ ...c, [k]: v }));

  // 담당자는 쉼표로 구분된 여러 명. 칩 토글로 추가/제거.
  const assigned = f.assignee.split(",").map((s) => s.trim()).filter(Boolean);
  const toggleAssignee = (name: string) => {
    const next = assigned.includes(name) ? assigned.filter((n) => n !== name) : [...assigned, name];
    set("assignee", next.join(", "));
  };

  return (
    <div className="prof-overlay" onClick={onClose}>
      <div className="prof" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="prof-top">
          <div className="prof-top-main"><div className="prof-name">업무 카드</div></div>
          <button className="modal-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="prof-body">
          <label className="prof-field">
            <span className="prof-field-l">제목</span>
            <input className="inline-input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="제목" />
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
          <button className="btn ghost" style={{ marginRight: "auto", color: "var(--bad)" }} onClick={() => onDelete(f)}>삭제</button>
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={() => onSave(f)} disabled={!f.title.trim()}>저장</button>
        </div>
      </div>
    </div>
  );
}
