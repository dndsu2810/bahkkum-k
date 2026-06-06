import { Icon, type IconName } from "../icons";

export type PageId =
  | "today"
  | "dashboard"
  | "attendance"
  | "students"
  | "timetable"
  | "makeup"
  | "homework"
  | "progress"
  | "report";

const NAV: { id: PageId; label: string; icon: IconName }[] = [
  { id: "today", label: "오늘", icon: "today" },
  { id: "dashboard", label: "대시보드", icon: "dashboard" },
  { id: "attendance", label: "출결 체크", icon: "clipboard" },
  { id: "students", label: "학생 관리", icon: "students" },
  { id: "timetable", label: "시간표", icon: "cal" },
  { id: "makeup", label: "보강 관리", icon: "refresh" },
  { id: "homework", label: "숙제 관리", icon: "book" },
  { id: "progress", label: "진도 관리", icon: "chart" },
  { id: "report", label: "월말리포트", icon: "fileText" },
];

export function Sidebar({
  page,
  onNavigate,
  studentCount,
  pendingCount,
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  studentCount: number;
  pendingCount: number;
}) {
  return (
    <aside className="sidebar">
      <nav className="nav">
        <div className="nav-label">메뉴</div>
        {NAV.map((n) => {
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
