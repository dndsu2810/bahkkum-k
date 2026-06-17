import { useState } from "react";
import type { Student } from "../types";
import { useStore } from "../store";
import {
  activeStudents,
  curMonthStr,
  enrolledStudents,
  monthLabelFull,
  monthOptions,
  newThisMonth,
  pct,
} from "../lib/logic";
import { fmtMD, parseD } from "../lib/dates";
import { buildReport, copyText } from "../lib/report";
import { parseGrade } from "../lib/grade";
import { WeekdayBars } from "../components/charts";
import { StudentTable } from "../components/StudentTable";
import { Select } from "../components/ui";
import { Icon, type IconName } from "../icons";

const BASE = 5; // 기본 인원 (이 인원까지는 인센티브 없음, 초과분부터 지급)
// 학년은 세부학년(중1·고2…)으로 저장되므로, 대시보드는 구분(초/중/고)으로 묶어 표시한다.
const DIVS: { key: "초" | "중" | "고"; label: string; tone: string }[] = [
  { key: "초", label: "초등", tone: "blue" },
  { key: "중", label: "중등", tone: "purple" },
  { key: "고", label: "고등", tone: "pink" },
];
// 수학 등록일 기준으로 정산 — 수학 첫 등원일(mathStart)이 있으면 그걸 등록일로 사용.
const mathDated = (s: Student): Student => (s.mathStart ? { ...s, startDate: s.mathStart } : s);

/** 한 줄 통계 바의 한 칸 — 아이콘 + 숫자 + 라벨 + 보조설명(콤팩트). */
function Stat({ icon, tone, num, label, sub }: { icon: IconName; tone: string; num: number; label: string; sub: string }) {
  return (
    <div className="stat">
      <span className={"kpi-ic ic-" + tone}><Icon name={icon} /></span>
      <span className="stat-body">
        <span className="stat-line">
          <b className="stat-num">{num}</b>
          <span className="stat-label">{label}</span>
        </span>
        <span className="stat-sub">{sub}</span>
      </span>
    </div>
  );
}


export function Dashboard() {
  const { data, toast } = useStore();
  const [curMonth, setCurMonth] = useState(curMonthStr());

  const active = activeStudents(data.students); // 전체 재원 (명단엔 전원 표시)
  // 정산·재적은 수학 등록일(mathStart) 기준 — 학생 목록을 수학 등록일로 매핑해 계산.
  const calcStudents = data.students.map(mathDated);
  const enrolled = enrolledStudents(calcStudents, curMonth); // 이번 달 재적 (첫주=7일 이전 등록)
  const excludedActive = active.filter((s) => s.excluded); // 정산 제외(원장 가족 등)
  const fresh = newThisMonth(calcStudents, curMonth).filter((s) => !s.excluded); // 둘째 주 이후 신규 → 다음 달
  // 구분(초/중/고)별 인원 — 합이 총 재적과 맞게(세부학년은 구분으로 묶음). 0명 구분은 숨김.
  const catCounts = DIVS.map((d) => ({ c: { name: d.label, tone: d.tone }, n: active.filter((s) => parseGrade(s.grade)?.div === d.key).length })).filter((x) => x.n > 0);

  // 인센티브 정산은 '정산 제외' 학생을 빼고 계산
  const billableEnrolled = enrolled.filter((s) => !s.excluded);
  const overThis = Math.max(0, billableEnrolled.length - BASE); // 이번 달 인센티브 지급 인원
  const nextEnrolled = billableEnrolled.length + fresh.length; // 다음 달 예상 정산 재적
  const overNext = Math.max(0, nextEnrolled - BASE);

  function onCopy() {
    copyText(buildReport(data, curMonth)).then(() => toast("복사됐어요. 카톡에 붙여넣기 하면 돼요."));
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">수학 월별 현황</h1>
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

      <div className="dash-top">
        <div className="card chart-left">
          <div className="card-head">
            <div>
              <div className="card-title sm">요일별 수업 분포</div>
              <div className="card-sub">재적 학생 정규 수업 기준</div>
            </div>
          </div>
          <div className="chart-body sm">
            <WeekdayBars enrolled={enrolled} />
          </div>
        </div>
        <div className="statgrid">
          <Stat icon="users" tone="blue" num={active.length} label="총 재적 학생"
            sub={"이번 달 재적 " + enrolled.length + "명" + (fresh.length ? " · 신규 " + fresh.length : "")} />
          {catCounts.map(({ c, n }) => (
            <Stat key={c.name} icon="cap" tone={c.tone} num={n} label={c.name} sub={pct(n, active.length) + "%"} />
          ))}
          <Stat icon="users" tone="orange" num={overThis} label="인센티브 대상" sub={overThis ? BASE + "명 초과" : "없음"} />
        </div>
      </div>

      {/* 인센티브 정산 (캡쳐용 정리) */}
      <div className="card sec-gap inc-card">
        <div className="card-head">
          <div>
            <div className="card-title">인센티브 정산</div>
            <div className="card-sub">{monthLabelFull(curMonth)} · {BASE}명 초과 시 {BASE + 1}번째부터 1인당 지급</div>
          </div>
        </div>
        <div className="inc-grid">
          <div className="inc-row inc-total">
            <span className="inc-l">총 재원</span>
            <span className="inc-v">{active.length}<i>명</i></span>
          </div>
          {excludedActive.length > 0 && (
            <div className="inc-row">
              <span className="inc-l">
                카운트 제외
                <span className="inc-names"> {excludedActive.map((s) => s.name).join(", ")}</span>
              </span>
              <span className="inc-v inc-minus">−{excludedActive.length}<i>명</i></span>
            </div>
          )}
          <div className="inc-sep" />
          <div className="inc-row">
            <span className="inc-l">이번 달 재적 <em>(첫주 기준 · 정산 대상)</em></span>
            <span className="inc-v">{billableEnrolled.length}<i>명</i></span>
          </div>
          <div className="inc-row inc-pay">
            <span className="inc-l">이번 달 인센티브 <em>(기본 {BASE}명 초과분)</em></span>
            <span className="inc-v">{overThis}<i>명분</i></span>
          </div>
          {fresh.length > 0 && (
            <>
              <div className="inc-sep" />
              <div className="inc-note">
                <div className="inc-note-h">이번 달 신규 {fresh.length}명 · 다음 달부터 정산</div>
                <ul>
                  {fresh.map((s) => (
                    <li key={s.id}>
                      <b>{s.name}</b> <span className="muted">{fmtMD(parseD(s.startDate))} 등록</span>
                    </li>
                  ))}
                </ul>
                <div className="inc-next">→ 다음 달 예상: 재적 {nextEnrolled}명 · 인센티브 {overNext}명분</div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card sec-gap">
        <div className="card-head">
          <div>
            <div className="card-title">재원 학생</div>
            <div className="card-sub">
              전체 {active.length}명{fresh.length ? ` · 이번 달 재적 ${enrolled.length}명 (신규 ${fresh.length}명은 다음 달부터)` : ""}
            </div>
          </div>
        </div>
        <div className="tbl-wrap">
          <StudentTable list={active} withActions={false} />
        </div>
      </div>
    </section>
  );
}
