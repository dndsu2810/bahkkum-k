import type { ReactNode } from "react";
import { useAuth } from "../auth";
import { useHubNav, type HubView } from "../hubNav";
import { ThemeToggle } from "../components/Header";
import { AREAS, ROLE_LABEL, areasForUser, type AreaKey } from "../lib/roles";

/** 허브 공통 셸 — 좌측 영역 네비 + 상단 헤더(역할·로그아웃·테마). 비수학 역할용. */
export function HubShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const hub = useHubNav();
  if (!user || !hub) return null;
  const myAreas = areasForUser(user);
  const areaDefs = AREAS.filter((a) => myAreas.includes(a.key));

  function go(v: HubView) {
    hub!.go(v);
  }

  return (
    <div className="hubx">
      <aside className="hubx-side">
        <button type="button" className="hubx-brand" onClick={() => go("home")} title="허브 홈">
          <div className="hub-logo">바</div>
          <div>
            <b>바꿈 통합 허브</b>
            <span>{ROLE_LABEL[user.role]}</span>
          </div>
        </button>

        <nav className="hubx-nav">
          <button className={"hubx-item" + (hub.view === "home" ? " active" : "")} onClick={() => go("home")}>
            <Dot /> 홈
          </button>
          {areaDefs.map((a) => (
            <button
              key={a.key}
              className={"hubx-item" + (hub.view === a.key ? " active" : "") + (a.pending ? " pending" : "")}
              onClick={() => go(a.key as AreaKey)}
            >
              <Dot /> {a.label}
              {a.pending && <span className="hubx-soon">준비</span>}
            </button>
          ))}
        </nav>

        <div className="hubx-foot">
          <div className="hubx-user">{user.name}</div>
          <button className="acct-logout" onClick={() => logout()}>
            로그아웃
          </button>
        </div>
      </aside>

      <div className="hubx-main">
        <header className="hubx-top">
          <div className="hubx-crumb">{crumbLabel(hub.view)}</div>
          <ThemeToggle />
        </header>
        <main className="hubx-content">{children}</main>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="hubx-dot" />;
}

function crumbLabel(view: HubView): string {
  if (view === "home") return "허브 홈";
  if (view === "math") return "수학 관리";
  const a = AREAS.find((x) => x.key === view);
  return a?.label || "";
}
