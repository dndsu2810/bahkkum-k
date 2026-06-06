import { Icon } from "../icons";
import { orderedNav, type NavPrefs, type PageId } from "../lib/nav";

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
  return (
    <aside className="sidebar">
      <nav className="nav">
        <div className="nav-label">메뉴</div>
        {nav.map((n) => {
          let count: React.ReactNode = null;
          if (n.id === "students") {
            count = <span className="nav-count">{studentCount}</span>;
          } else if (n.id === "makeup" && pendingCount > 0) {
            count = <span className="nav-count alert">{pendingCount}</span>;
          }
          return (
            <button
              key={n.id}
              className={"nav-item" + (page === n.id ? " active" : "")}
              onClick={() => onNavigate(n.id)}
            >
              <Icon name={n.icon} />
              {n.label}
              {count}
            </button>
          );
        })}
      </nav>
      <div className="side-info">
        <h4>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ width: 13, height: 13, strokeWidth: 2 }}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          데이터 저장 안내
        </h4>
        <p>모든 데이터는 학원 계정에 안전하게 저장됩니다. 어느 기기에서 접속해도 같은 정보가 유지돼요.</p>
      </div>
    </aside>
  );
}
