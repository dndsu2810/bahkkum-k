import { useState } from "react";
import { useStore } from "./store";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { type NavPrefs, loadNavPrefs, saveNavPrefs } from "./lib/nav";
import { type Category, getCategories, setCategories } from "./lib/categories";
import { type SectionKey, getReportOrder, setReportOrder } from "./lib/reportSections";
import { ModalHost, ToastHost } from "./components/ModalHost";
import { Dashboard } from "./pages/Dashboard";
import { Attendance } from "./pages/Attendance";
import { Students } from "./pages/Students";
import { Timetable } from "./pages/Timetable";
import { MakeupPage } from "./pages/Makeup";
import { Today } from "./pages/Today";
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
      />
      <div className="main">
        <Header page={page} />
        <div className="content">
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
            <div className="empty">불러오는 중…</div>
          ) : (
            <>
              {page === "today" && <Today />}
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
        </div>
      </div>
      <ModalHost />
      <ToastHost />
    </div>
  );
}
