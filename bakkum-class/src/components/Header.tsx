import { useEffect, useState } from "react";
import { TODAY, fmtFull } from "../lib/dates";
import { GROUP_OF, navLabel, type PageId } from "../lib/nav";
import { useAuth } from "../auth";
import { useHubNav } from "../hubNav";
import { ROLE_LABEL } from "../lib/roles";

export function Header({ page }: { page: PageId }) {
  const hub = useHubNav();
  return (
    <header className="topbar">
      <div className="crumb">
        {GROUP_OF[page]} · <b>{navLabel(page)}</b>
      </div>
      <div className="top-actions">
        {hub?.canLeaveMath && (
          <button className="hub-btn" onClick={() => hub.go("home")} title="허브 홈으로">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            허브
          </button>
        )}
        <ThemeToggle />
        <div className="pill-date">
          <span className="dot" />
          {fmtFull(TODAY)}
        </div>
        <AccountMenu />
      </div>
    </header>
  );
}

// 현재 로그인 사용자 칩 + 로그아웃. 백엔드 없는 dev 환경에선 숨김.
function AccountMenu() {
  const { user, noBackend, logout } = useAuth();
  if (!user || noBackend) return null;
  return (
    <div className="acct">
      <span className="acct-chip">
        {user.name} · <span className="role">{ROLE_LABEL[user.role]}</span>
      </span>
      <button className="acct-logout" onClick={() => logout()}>
        로그아웃
      </button>
    </div>
  );
}

// B-7 다크 모드 토글 — 선택을 localStorage에 저장, html[data-theme]로 적용
export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "dark") return true;
      if (saved === "light") return false;
      // 저장된 선택 없으면 시스템 설정을 따른다.
      return !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });
  // DOM에 반영만 (저장은 사용자가 토글할 때만 → 선택 전엔 시스템 설정을 계속 따름)
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
  }, [dark]);
  function toggle() {
    setDark((v) => {
      const nv = !v;
      try {
        localStorage.setItem("theme", nv ? "dark" : "light");
      } catch {
        /* ignore */
      }
      return nv;
    });
  }
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      title={dark ? "밝은 모드로" : "어두운 모드로"}
      aria-label={dark ? "밝은 모드로 전환" : "어두운 모드로 전환"}
    >
      {dark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
