import { TODAY, fmtFull } from "../lib/dates";

export function Header() {
  return (
    <header className="header">
      <div className="brand">
        <div className="brand-logo">바</div>
        <div>
          <div className="brand-name">바꿈영수학원</div>
          <div className="brand-sub">수업 관리 도구</div>
        </div>
      </div>
      <div className="date-badge">
        <span className="dot" />
        <span>{fmtFull(TODAY)}</span>
      </div>
    </header>
  );
}
