import { useState } from "react";
import { useStore } from "../store";
import {
  curMonthStr,
  enrolledStudents,
  monthActivity,
  monthLabel,
  monthLabelFull,
  monthOptions,
  monthPending,
  monthScheduled,
  newThisMonth,
  pct,
} from "../lib/logic";
import { buildReport, copyText } from "../lib/report";
import { Kpi, WeekdayBars, Donut } from "../components/charts";
import { StudentTable } from "../components/StudentTable";
import { MakeupList } from "../components/MakeupList";
import { Select } from "../components/ui";
import { Icon } from "../icons";

export function Dashboard() {
  const { data, toast } = useStore();
  const [curMonth, setCurMonth] = useState(curMonthStr());

  const enrolled = enrolledStudents(data.students, curMonth);
  const ele = enrolled.filter((s) => s.grade === "초등");
  const mid = enrolled.filter((s) => s.grade === "중등");
  const pend = monthPending(data.makeups, curMonth);
  const sched = monthScheduled(data.makeups, curMonth);
  const act = monthActivity(data.makeups, curMonth);
  const fresh = newThisMonth(data.students, curMonth);

  function onCopy() {
    copyText(buildReport(data, curMonth)).then(() => toast("복사됐어요. 카톡에 붙여넣기 하면 돼요."));
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <div className="page-title">월별 현황</div>
          <div className="page-desc">{monthLabelFull(curMonth)} 기준 재적 현황 및 월말 정산</div>
        </div>
        <div className="head-actions">
          <Select value={curMonth} onChange={setCurMonth} options={monthOptions()} />
          <button className="btn primary" onClick={onCopy}>
            <Icon name="copy" />
            리포트 복사
          </button>
        </div>
      </div>

      <div className="kpi-row">
        <Kpi
          label="재적 학생"
          num={enrolled.length}
          unit="명"
          tone="blue"
          icon="users"
          foot={monthLabel(curMonth) + " 1일 기준" + (fresh.length ? " · 신규 " + fresh.length + "명" : "")}
        />
        <Kpi
          label="초등"
          num={ele.length}
          unit="명"
          tone="pink"
          icon="cap"
          foot={"전체의 " + pct(ele.length, enrolled.length) + "%"}
        />
        <Kpi
          label="중등"
          num={mid.length}
          unit="명"
          tone="purple"
          icon="book"
          foot={"전체의 " + pct(mid.length, enrolled.length) + "%"}
        />
        <Kpi
          label="보강 대기"
          num={pend.length}
          unit="건"
          tone="orange"
          icon="refresh"
          foot={sched.length ? "예정·완료 " + sched.length + "건" : "예정 없음"}
        />
      </div>

      <div className="chart-row">
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">요일별 수업 분포</div>
              <div className="card-sub">재적 학생 정규 수업 기준</div>
            </div>
          </div>
          <div className="chart-body">
            <WeekdayBars enrolled={enrolled} />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">학생 구분</div>
              <div className="card-sub">초등 · 중등 비율</div>
            </div>
          </div>
          <div className="chart-body">
            <Donut ele={ele.length} mid={mid.length} />
          </div>
        </div>
      </div>

      <div className="card sec-gap">
        <div className="card-head">
          <div>
            <div className="card-title">재적 학생</div>
            <div className="card-sub">{enrolled.length}명</div>
          </div>
        </div>
        <div className="tbl-wrap">
          <StudentTable list={enrolled} withActions={false} />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">{monthLabel(curMonth)} 보강 현황</div>
            <div className="card-sub">
              {act.length}건 · 대기 {pend.length} / 예정·완료 {sched.length}
            </div>
          </div>
        </div>
        <MakeupList list={act} students={data.students} manage={false} />
      </div>
    </section>
  );
}
