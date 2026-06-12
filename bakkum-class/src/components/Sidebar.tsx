import { useState } from "react";
import { Icon } from "../icons";
import { orderedNav, GROUP_ORDER, GROUP_OF, ALWAYS, type NavPrefs, type PageId } from "../lib/nav";

export type { PageId };

export function Sidebar({
  page,
  onNavigate,
  studentCount,
  pendingCount,
  navPrefs,
  onReorder,
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  studentCount: number;
  pendingCount: number;
  navPrefs: NavPrefs;
  onReorder: (order: PageId[]) => void;
}) {
  const nav = orderedNav(navPrefs);
  const [dragId, setDragId] = useState<PageId | null>(null);
  const [overId, setOverId] = useState<PageId | null>(null);

  function countFor(id: PageId): React.ReactNode {
    if (id === "students") return <span className="nav-badge">{studentCount}</span>;
    if (id === "makeup" && pendingCount > 0) return <span className="nav-badge warn">{pendingCount}</span>;
    return null;
  }

  // 드래그한 항목을 대상 항목 앞에 끼워넣어 새 순서를 만든다. (고정 메뉴는 이동 불가)
  function drop(targetId: PageId) {
    if (!dragId || dragId === targetId || ALWAYS.includes(dragId)) {
      setDragId(null); setOverId(null); return;
    }
    const ids = nav.map((n) => n.id).filter((id) => id !== dragId);
    const idx = ids.indexOf(targetId);
    ids.splice(idx < 0 ? ids.length : idx, 0, dragId);
    onReorder(ids);
    setDragId(null); setOverId(null);
  }

  return (
    <aside className="side">
      <button type="button" className="brand" onClick={() => onNavigate("today")} title="오늘 화면으로" aria-label="바꿈영수학원 · 오늘 화면으로">
        <div className="logo">바</div>
        <div>
          <b>바꿈영수학원</b>
          <span>수업 관리 도구</span>
        </div>
      </button>

      <nav>
        {GROUP_ORDER.map((g) => {
          const items = nav.filter((n) => GROUP_OF[n.id] === g);
          if (!items.length) return null;
          return (
            <div className="nav-group" key={g}>
              <div className="nav-label">{g}</div>
              {items.map((n) => {
                const movable = !ALWAYS.includes(n.id);
                return (
                  <button
                    key={n.id}
                    className={
                      "nav-item" +
                      (page === n.id ? " active" : "") +
                      (overId === n.id && dragId && dragId !== n.id ? " drop-target" : "") +
                      (dragId === n.id ? " dragging" : "")
                    }
                    onClick={() => onNavigate(n.id)}
                    draggable={movable}
                    onDragStart={movable ? () => setDragId(n.id) : undefined}
                    onDragEnd={() => { setDragId(null); setOverId(null); }}
                    onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(n.id); } }}
                    onDrop={(e) => { e.preventDefault(); drop(n.id); }}
                  >
                    <span className="ic">
                      <Icon name={n.icon} />
                    </span>
                    {n.label}
                    {countFor(n.id)}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="side-foot">
        <div className="h">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ width: 15, height: 15, strokeWidth: 2 }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          데이터 안전 보관
        </div>
        <p>드래그로 메뉴 순서를 바꿀 수 있어요. 모든 기록은 학원 계정에 안전하게 저장됩니다.</p>
      </div>
    </aside>
  );
}
