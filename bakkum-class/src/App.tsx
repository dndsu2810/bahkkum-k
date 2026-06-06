import { useState } from "react";
import { useStore } from "./store";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { type PageId, type NavPrefs, loadNavPrefs, saveNavPrefs } from "./lib/nav";
import { ModalHost, ToastHost } from "./components/ModalHost";
import { Dashboard } from "./pages/Dashboard";
import { Attendance } from "./pages/Attendance";
import { Students } from "./pages/Students";
import { Timetable } from "./pages/Timetable";
import { MakeupPage } from "./pages/Makeup";
import { Today } from "./pages/Today";
import { Homework } from "./pages/Homework";
import { Progress } from "./pages/Progress";
import { Report } from "./pages/Report";
import { Settings } from "./pages/Settings";

export default function App() {
  const { data, loaded } = useStore();
  const [page, setPage] = useState<PageId>("today");
  const [navPrefs, setNavPrefs] = useState<NavPrefs>(loadNavPrefs());

  const pendingCount = data.makeups.filter((k) => k.status === "pending").length;

  function updateNavPrefs(p: NavPrefs) {
    setNavPrefs(p);
    saveNavPrefs(p);
  }

  return (
    <div className="app">
      <Header />
      <div className="body">
        <Sidebar
          page={page}
          onNavigate={setPage}
          studentCount={data.students.length}
          pendingCount={pendingCount}
          navPrefs={navPrefs}
        />
        <main className="main">
          {!loaded ? (
            <div className="empty">불러오는 중…</div>
          ) : (
            <>
              {page === "today" && <Today />}
              {page === "dashboard" && <Dashboard />}
              {page === "attendance" && <Attendance />}
              {page === "students" && <Students />}
              {page === "timetable" && <Timetable />}
              {page === "makeup" && <MakeupPage />}
              {page === "homework" && <Homework />}
              {page === "progress" && <Progress />}
              {page === "report" && <Report />}
              {page === "settings" && <Settings navPrefs={navPrefs} onChange={updateNavPrefs} />}
            </>
          )}
        </main>
      </div>
      <ModalHost />
      <ToastHost />
    </div>
  );
}
