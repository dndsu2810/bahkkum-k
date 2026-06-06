import { useState } from "react";
import { useStore } from "./store";
import { Header } from "./components/Header";
import { Sidebar, type PageId } from "./components/Sidebar";
import { ModalHost, ToastHost } from "./components/ModalHost";
import { Dashboard } from "./pages/Dashboard";
import { Attendance } from "./pages/Attendance";
import { Students } from "./pages/Students";
import { Timetable } from "./pages/Timetable";
import { MakeupPage } from "./pages/Makeup";
import { Homework } from "./pages/Homework";
import { Progress } from "./pages/Progress";
import { Report } from "./pages/Report";

export default function App() {
  const { data, loaded } = useStore();
  const [page, setPage] = useState<PageId>("dashboard");

  const pendingCount = data.makeups.filter((k) => k.status === "pending").length;

  return (
    <div className="app">
      <Header />
      <div className="body">
        <Sidebar
          page={page}
          onNavigate={setPage}
          studentCount={data.students.length}
          pendingCount={pendingCount}
        />
        <main className="main">
          {!loaded ? (
            <div className="empty">불러오는 중…</div>
          ) : (
            <>
              {page === "dashboard" && <Dashboard />}
              {page === "attendance" && <Attendance />}
              {page === "students" && <Students />}
              {page === "timetable" && <Timetable />}
              {page === "makeup" && <MakeupPage />}
              {page === "homework" && <Homework />}
              {page === "progress" && <Progress />}
              {page === "report" && <Report />}
            </>
          )}
        </main>
      </div>
      <ModalHost />
      <ToastHost />
    </div>
  );
}
