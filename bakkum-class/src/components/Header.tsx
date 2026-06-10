import { TODAY, fmtFull } from "../lib/dates";
import { GROUP_OF, navLabel, type PageId } from "../lib/nav";

export function Header({ page }: { page: PageId }) {
  return (
    <header className="topbar">
      <div className="crumb">
        {GROUP_OF[page]} · <b>{navLabel(page)}</b>
      </div>
      <div className="top-actions">
        <div className="pill-date">
          <span className="dot" />
          {fmtFull(TODAY)}
        </div>
      </div>
    </header>
  );
}
