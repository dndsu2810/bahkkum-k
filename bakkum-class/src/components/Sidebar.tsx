import { useState } from "react";
import { Icon, StarIcon } from "../icons";
import {
  orderedNav,
  favoritesNav,
  GROUP_ORDER,
  GROUP_OF,
  ALWAYS,
  type NavItem,
  type NavPrefs,
  type PageId,
} from "../lib/nav";

export type { PageId };

export function Sidebar({
  page,
  onNavigate,
  studentCount,
  pendingCount,
  navPrefs,
  onReorder,
  onToggleFav,
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  studentCount: number;
  pendingCount: number;
  navPrefs: NavPrefs;
  onReorder: (order: PageId[]) => void;
  onToggleFav: (id: PageId) => void;
}) {
  const nav = orderedNav(navPrefs);
  const favs = favoritesNav(navPrefs);
  const favSet = new Set(favs.map((n) => n.id));
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
      setDragId(null);
      setOverId(null);
      return;
    }
    const ids = nav.map((n) => n.id).filter((id) => id !== dragId);
    const idx = ids.indexOf(targetId);
    ids.splice(idx < 0 ? ids.length : idx, 0, dragId);
    onReorder(ids);
    setDragId(null);
    setOverId(null);
  }

  function navRow(n: NavItem, opts: { draggable: boolean }) {
    const movable = opts.draggable && !ALWAYS.includes(n.id);
    const fav = favSet.has(n.id);
    return (
      <div
        key={n.id}
        className={
          "nav-row" +
          (overId === n.id && dragId && dragId !== n.id ? " drop-target" : "") +
          (dragId === n.id ? " dragging" : "")
        }
        draggable={movable}
        onDragStart={movable ? () => setDragId(n.id) : undefined}
        onDragEnd={() => {
          setDragId(null);
          setOverId(null);
        }}
        onDragOver={(e) => {
          if (dragId) {
            e.preventDefault();
            setOverId(n.id);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          drop(n.id);
        }}
      >
        <button
          className={"nav-item" + (page === n.id ? " active" : "")}
          onClick={() => onNavigate(n.id)}
        >
          <span className="ic">
            <Icon name={n.icon} />
          </span>
          {n.label}
          {countFor(n.id)}
        </button>
        <button
          className={"nav-star" + (fav ? " on" : "")}
          onClick={() => onToggleFav(n.id)}
          title={fav ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          aria-pressed={fav}
        >
          <StarIcon filled={fav} />
        </button>
      </div>
    );
  }

  return (
    <aside className="side">
      <button
        type="button"
        className="brand"
        onClick={() => onNavigate("today")}
        title="오늘 화면으로"
        aria-label="바꿈영수학원 · 오늘 화면으로"
      >
        <div className="logo">바</div>
        <div>
          <b>바꿈영수학원</b>
          <span>수업 관리 도구</span>
        </div>
      </button>

      <nav>
        {favs.length > 0 && (
          <div className="nav-group" key="__fav">
            <div className="nav-label">즐겨찾기</div>
            {favs.map((n) => navRow(n, { draggable: false }))}
          </div>
        )}
        {GROUP_ORDER.map((g) => {
          // 즐겨찾기로 올라간 항목은 원래 그룹에서 숨겨 '모아보기'가 되게 한다.
          const items = nav.filter((n) => GROUP_OF[n.id] === g && !favSet.has(n.id));
          if (!items.length) return null;
          return (
            <div className="nav-group" key={g}>
              <div className="nav-label">{g}</div>
              {items.map((n) => navRow(n, { draggable: true }))}
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
        <p>별(★)로 즐겨찾기, 드래그로 순서 변경. 설정은 로그인 계정별로 저장됩니다.</p>
      </div>
    </aside>
  );
}
