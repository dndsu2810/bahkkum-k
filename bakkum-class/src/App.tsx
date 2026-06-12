import { useState } from "react";
import { useStore } from "./store";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { type NavPrefs, type PageId, loadNavPrefs, saveNavPrefs } from "./lib/nav";
import { Icon } from "./icons";
import { type Category, getCategories, setCategories } from "./lib/categories";
import { type SectionKey, getReportOrder, setReportOrder } from "./lib/reportSections";
import { ModalHost, ToastHost } from "./components/ModalHost";
import { Dashboard } from "./pages/Dashboard";
import { Attendance } from "./pages/Attendance";
import { Students } from "./pages/Students";
import { Timetable } from "./pages/Timetable";
import { MakeupPage } from "./pages/Makeup";
import { Today } from "./pages/Today";
import { Board } from "./pages/Board";
import { Schedule } from "./pages/Schedule";
import { Homework } from "./pages/Homework";
import { Progress } from "./pages/Progress";
import { Tests } from "./pages/Tests";
import { Report } from "./pages/Report";
import { Settings } from "./pages/Settings";

export default function App() {
  const { data, loaded, loadError, retryLoad, page, navigate } = useStore();
  const [navPrefs, setNavPrefs] = useState<NavPrefs>(loadNavPrefs());
  const [cats, setCats] = useState<Category[]>(getCategories());
  const [secOrder, setSecOrder] = useState<SectionKey[]>(getReportOrder());

  const pendingCount = data.makeups.filter((k) => k.status === "pending").length;

  function updateNavPrefs(p: NavPrefs) {
    setNavPrefs(p);
    saveNavPrefs(p);
  }
  function updateCategories(c: Category[]) {
    setCategories(c);
    setCats(c);
  }
  function updateReportOrder(o: SectionKey[]) {
    setReportOrder(o);
    setSecOrder(o);
  }

  return (
    <div className="app">
      <Sidebar
        page={page}
        onNavigate={navigate}
        studentCount={data.students.length}
        pendingCount={pendingCount}
        navPrefs={navPrefs}
        onReorder={(order) => updateNavPrefs({ order, hidden: navPrefs.hidden })}
      />
      <div className="main">
        <Header page={page} />
        <main className="content">
          {loadError ? (
            <div className="empty" style={{ flexDirection: "column", gap: 12, textAlign: "center" }}>
              <div style={{ fontWeight: 700, color: "var(--bad)" }}>데이터를 불러오지 못했어요.</div>
              <div style={{ color: "var(--ink3)", fontSize: 14 }}>
                {loadError}
                <br />
                기록은 서버에 그대로 있습니다. 저장은 잠가두었으니 안심하고 다시 시도해 주세요.
              </div>
              <button className="btn primary" onClick={retryLoad}>다시 불러오기</button>
            </div>
          ) : !loaded ? (
            <div className="skel-page" aria-busy="true" aria-label="불러오는 중">
              <div className="skel skel-title" />
              <div className="skel skel-brief" />
              <div className="skel skel-card" />
              <div className="skel skel-card" />
            </div>
          ) : (
            <>
              {page === "today" && <Today />}
              {page === "board" && <Board />}
              {page === "dashboard" && <Dashboard />}
              {page === "schedule" && <Schedule />}
              {page === "attendance" && <Attendance />}
              {page === "students" && <Students />}
              {page === "timetable" && <Timetable />}
              {page === "makeup" && <MakeupPage />}
              {page === "homework" && <Homework />}
              {page === "progress" && <Progress />}
              {page === "tests" && <Tests />}
              {page === "report" && <Report />}
              {page === "settings" && (
                <Settings
                  navPrefs={navPrefs}
                  onChange={updateNavPrefs}
                  categories={cats}
                  onCategoriesChange={updateCategories}
                  reportOrder={secOrder}
                  onReportOrderChange={updateReportOrder}
                />
              )}
            </>
          )}
        </main>
      </div>
      <MobileTabBar page={page} onNavigate={navigate} />
      <ModalHost />
      <ToastHost />
    </div>
  );
}

// 좁은 화면 전용 하단 고정 탭바 — 엄지로 닿는 주요 화면 (A-8)
const MOBILE_TABS: { id: PageId; label: string; icon: string }[] = [
  { id: "today", label: "오늘", icon: "today" },
  { id: "attendance", label: "출결", icon: "check" },
  { id: "homework", label: "숙제", icon: "book" },
  { id: "timetable", label: "시간표", icon: "cal" },
  { id: "dashboard", label: "현황", icon: "chart" },
];

function MobileTabBar({ page, onNavigate }: { page: PageId; onNavigate: (p: PageId) => void }) {
  return (
    <nav className="mtabbar" aria-label="주요 화면">
      {MOBILE_TABS.map((t) => (
        <button
          key={t.id}
          className={"mtab" + (page === t.id ? " on" : "")}
          onClick={() => onNavigate(t.id)}
          aria-current={page === t.id ? "page" : undefined}
        >
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
