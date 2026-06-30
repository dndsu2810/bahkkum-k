import { useStore } from "../store";
import { Dashboard } from "../pages/Dashboard";
import { Attendance } from "../pages/Attendance";
import { Students } from "../pages/Students";
import { Timetable } from "../pages/Timetable";
import { MakeupPage } from "../pages/Makeup";
import { Today } from "../pages/Today";
import { TodayDashboard } from "../pages/TodayDashboard";
import { Schedule } from "../pages/Schedule";
import { Homework } from "../pages/Homework";
import { Progress } from "../pages/Progress";
import { Tests } from "../pages/Tests";
import { Report } from "../pages/Report";
import { LessonPlan } from "../pages/LessonPlan";
import { MathBaseball } from "../pages/MathBaseball";
import { TimetableSample } from "../pages/TimetableSample";

/** 수학 수업관리 콘텐츠 — store.page에 따라 수학 페이지를 렌더(설정·보드는 허브 쪽). */
export function MathContent() {
  const { loaded, loadError, retryLoad, page } = useStore();

  if (loadError) {
    return (
      <div className="empty" style={{ flexDirection: "column", gap: 12, textAlign: "center" }}>
        <div style={{ fontWeight: 700, color: "var(--bad)" }}>데이터를 불러오지 못했어요.</div>
        <div style={{ color: "var(--ink3)", fontSize: 14 }}>
          {loadError}
          <br />
          기록은 서버에 그대로 있습니다. 저장은 잠가두었으니 안심하고 다시 시도해 주세요.
        </div>
        <button className="btn primary" onClick={retryLoad}>다시 불러오기</button>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="skel-page" aria-busy="true" aria-label="불러오는 중">
        <div className="skel skel-title" />
        <div className="skel skel-brief" />
        <div className="skel skel-card" />
        <div className="skel skel-card" />
      </div>
    );
  }
  return (
    <>
      {page === "today" && <Today />}
      {page === "classdash" && <TodayDashboard />}
      {page === "dashboard" && <Dashboard />}
      {page === "schedule" && <Schedule />}
      {page === "attendance" && <Attendance />}
      {page === "students" && <Students />}
      {page === "timetable" && <Timetable />}
      {page === "makeup" && <MakeupPage />}
      {page === "homework" && <Homework />}
      {page === "progress" && <Progress />}
      {page === "tests" && <Tests />}
      {page === "baseball" && <MathBaseball />}
      {page === "report" && <Report />}
      {page === "plan" && <LessonPlan />}
      {page === "timetable_sample" && <TimetableSample />}
    </>
  );
}
