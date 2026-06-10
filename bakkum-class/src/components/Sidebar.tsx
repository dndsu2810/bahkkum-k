import { Icon } from "../icons";
import { orderedNav, GROUP_ORDER, GROUP_OF, type NavPrefs, type PageId } from "../lib/nav";

export type { PageId };

export function Sidebar({
  page,
  onNavigate,
  studentCount,
  pendingCount,
  navPrefs,
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  studentCount: number;
  pendingCount: number;
  navPrefs: NavPrefs;
}) {
  const nav = orderedNav(navPrefs);

  function countFor(id: PageId): React.ReactNode {
    if (id === "students") return <span className="nav-badge">{studentCount}</span>;
    if (id === "makeup" && pendingCount > 0) return <span className="nav-badge warn">{pendingCount}</span>;
    return null;
  }

  return (
    <aside className="side">
      <div className="brand">
        <div className="logo">바</div>
        <div>
          <b>바꿈영수학원</b>
          <span>수업 관리 도구</span>
        </div>
      </div>

      <nav>
        {GROUP_ORDER.map((g) => {
          const items = nav.filter((n) => GROUP_OF[n.id] === g);
          if (!items.length) return null;
          return (
            <div className="nav-group" key={g}>
              <div className="nav-label">{g}</div>
              {items.map((n) => (
                <button
                  key={n.id}
                  className={"nav-item" + (page === n.id ? " active" : "")}
                  onClick={() => onNavigate(n.id)}
                >
                  <span className="ic">
                    <Icon name={n.icon} />
                  </span>
                  {n.label}
                  {countFor(n.id)}
                </button>
              ))}
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
        <p>모든 기록은 학원 계정에 안전하게 저장돼요. 어느 기기에서 접속해도 동일하게 유지됩니다.</p>
      </div>
    </aside>
  );
}
