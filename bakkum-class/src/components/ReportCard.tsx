import type { ReactNode } from "react";
import type { ReportData } from "../lib/reportTypes";
import { pad } from "../lib/dates";
import { holidayName } from "../lib/holidays";
import { SECTION_LABELS, getReportOrder, type SectionKey } from "../lib/reportSections";
import "../styles/reportCard.css";

const LOGO = "/report-logo.png";

function fmtYmd(s: string): string {
  // "2026-04-01" -> "2026. 04. 01"; pass through if not a date
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[1]}. ${m[2]}. ${m[3]}` : s;
}
function scoreClass(n: number): string {
  return n >= 80 ? "r-s-good" : n >= 60 ? "r-s-mid" : "r-s-low";
}
function compClasses(n: number): { bar: string; txt: string } {
  if (n >= 100) return { bar: "r-c-full", txt: "r-t-full" };
  if (n >= 70) return { bar: "r-c-mid", txt: "r-t-mid" };
  return { bar: "r-c-low", txt: "r-t-low" };
}

function Ring({ pct }: { pct: number }) {
  const r = 60.5;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div className="r-ring">
      <svg width="138" height="138" viewBox="0 0 138 138">
        <circle cx="69" cy="69" r={r} fill="none" stroke="#E4EAEC" strokeWidth="17" />
        <circle
          cx="69"
          cy="69"
          r={r}
          fill="none"
          stroke="#16808F"
          strokeWidth="17"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 69 69)"
        />
      </svg>
      <div className="r-rin">
        <div className="r-rnum">
          {pct}
          <i>%</i>
        </div>
        <span className="r-rcap">달성률</span>
      </div>
    </div>
  );
}

function Calendar({ data }: { data: ReportData }) {
  const { year, month, att } = data;
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay(); // 0 Sun
  const cells: ReactNode[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(<div className="r-cell empty" key={"e" + i} />);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = year + "-" + pad(month) + "-" + pad(day);
    const hol = holidayName(dateStr);
    const dow = new Date(year, month - 1, day).getDay();
    const dCls = hol || dow === 0 ? "r-d sun" : dow === 6 ? "r-d sat" : "r-d";
    const bs = att.days[day] || [];
    const label: Record<string, string> = { p: "출석", l: "지각", m: "보강", a: "결석" };
    // 단일 기록이면 셀 배경을 옅게 틴트, 여러 기록이면 흰 셀에 태그 모두 표시. 공휴일(기록 없음)은 회색.
    const cls = bs.length === 1 ? "r-cell att-" + bs[0] : hol && bs.length === 0 ? "r-cell att-h" : "r-cell";
    cells.push(
      <div className={cls} key={day} title={hol || undefined}>
        <span className={dCls}>{day}</span>
        {bs.length > 0 ? (
          <span className="r-celltags">
            {bs.map((x) => (
              <span key={x} className={"r-celltag tag-" + x}>{label[x]}</span>
            ))}
          </span>
        ) : hol ? (
          <span className="r-celltag tag-h">{hol}</span>
        ) : null}
      </div>
    );
  }
  while (cells.length % 7 !== 0) cells.push(<div className="r-cell empty" key={"t" + cells.length} />);

  return (
    <div className="r-cal-card">
      <div className="r-cal-legend">
        <span><i className="r-lg g" />출석</span>
        <span><i className="r-lg w" />지각</span>
        <span><i className="r-lg b" />보강</span>
        <span><i className="r-lg r" />결석</span>
        <span><i className="r-lg n" />수업 없음</span>
      </div>
      <div className="r-cal">
        <div className="r-wd sun">일</div>
        <div className="r-wd">월</div>
        <div className="r-wd">화</div>
        <div className="r-wd">수</div>
        <div className="r-wd">목</div>
        <div className="r-wd">금</div>
        <div className="r-wd sat">토</div>
        {cells}
      </div>
      {data.extras.notes.length > 0 && (
        <div className="r-notes">
          <h4>출결 특이사항</h4>
          {data.extras.notes.map((n) => (
            <div className="r-note" key={n.id}>
              <span className={"r-ndate " + n.tone}>{n.dateLabel}</span>
              <span className="r-ntext">{n.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportCard({ data }: { data: ReportData }) {
  const { att, extras } = data;
  const weekly = extras.evals.filter((e) => e.type === "주간평가");
  const weeklyAvg = weekly.length
    ? Math.round(weekly.reduce((s, e) => s + (e.score || 0), 0) / weekly.length)
    : 0;
  const hwAvg = extras.homeworks.length
    ? Math.round(extras.homeworks.reduce((s, h) => s + (h.completion || 0), 0) / extras.homeworks.length)
    : 0;

  const showComment = !!extras.comment.trim();
  const booksIp = extras.progress.booksInProgress || [];
  const booksCp = extras.progress.booksCompleted || [];
  const showProgress = booksIp.length > 0 || booksCp.length > 0 || !!extras.progress.unit.trim();
  const showEvals = extras.evals.length > 0;
  const showHw = extras.homeworks.length > 0;
  const sups = extras.supplements || [];
  const showSup = sups.length > 0;
  const supTotal = sups.reduce((a, s) => a + (s.minutes || 0), 0);

  // 섹션 본문 (제목/번호는 순서대로 렌더링하며 부여)
  const bodies: Record<SectionKey, { show: boolean; aside?: ReactNode; body: ReactNode }> = {
    summary: {
      show: true,
      body: (
        <div className="r-kpis">
          <div className="r-kpi">
            <div className="r-kpi-label">주간평가 평균</div>
            <div className="r-kpi-val">{weeklyAvg}<i>점</i></div>
            <div className="r-kpi-bar"><span style={{ width: weeklyAvg + "%" }} /></div>
            <div className="r-kpi-foot">주간평가 {weekly.length}회 평균</div>
          </div>
          <div className="r-kpi">
            <div className="r-kpi-label">출석 현황</div>
            <div className="r-kpi-val">{att.total}<i>회 수업</i></div>
            <div className="r-stack">
              <i className="r-s-att" style={{ flex: att.present || 0.0001 }} />
              <i className="r-s-mk" style={{ flex: att.makeup || 0.0001 }} />
              <i className="r-s-ab" style={{ flex: att.absent || 0.0001 }} />
            </div>
            <div className="r-legend">
              <span><i className="r-dot g" />출석 {att.present}</span>
              <span><i className="r-dot b" />보강 {att.makeup}</span>
              <span><i className="r-dot r" />결석 {att.absent}</span>
              {(att.late || 0) > 0 && (
                <span><i className="r-dot w" />지각 {att.late}{(att.lateMin || 0) > 0 ? ` · ${att.lateMin}분` : ""}</span>
              )}
            </div>
          </div>
          <div className="r-kpi">
            <div className="r-kpi-label">숙제 평균 완성도</div>
            <div className="r-kpi-val">{hwAvg}<i>%</i></div>
            <div className="r-kpi-bar"><span style={{ width: hwAvg + "%", background: "var(--green)" }} /></div>
            <div className="r-kpi-foot">총 {extras.homeworks.length}건 검사 · 평균 기준</div>
          </div>
        </div>
      ),
    },
    comment: {
      show: showComment,
      body: (
        <div className="r-comment">
          <div className="r-by">
            <span className="r-nm">담임 선생님</span>
            <span className="r-tg">종합 의견</span>
          </div>
          <p>{extras.comment}</p>
        </div>
      ),
    },
    progress: {
      show: showProgress,
      body: (booksIp.length || booksCp.length) ? (
        <div className="r-books">
          <div className="r-books-col">
            <div className="r-tag">이번 달 진행중인 교재</div>
            {booksIp.length ? (
              <ul className="r-book-list">
                {booksIp.map((b, i) => (
                  <li key={"ip" + i}><b>{b.unit || "교재"}</b>{b.area && <span className="r-book-range">{b.area}</span>}<span className="r-book-date">{fmtYmd(b.startDate)} 시작</span></li>
                ))}
              </ul>
            ) : <div className="r-book-empty">없음</div>}
          </div>
          <div className="r-books-col">
            <div className="r-tag">이번 달 완료한 교재</div>
            {booksCp.length ? (
              <ul className="r-book-list">
                {booksCp.map((b, i) => (
                  <li key={"cp" + i} className="done"><b>{b.unit || "교재"}</b>{b.area && <span className="r-book-range">{b.area}</span>}<span className="r-book-date">{fmtYmd(b.endDate || "")} 완료</span></li>
                ))}
              </ul>
            ) : <div className="r-book-empty">없음</div>}
          </div>
        </div>
      ) : (
        <div className="r-progress">
          <Ring pct={extras.progress.pct} />
          <div className="r-prog-info">
            <span className="r-tag">현재 학습 단원</span>
            <div className="r-unit">{extras.progress.unit}</div>
            <div className="r-pbar"><span style={{ width: Math.max(0, Math.min(100, extras.progress.pct)) + "%" }} /></div>
            <div className="r-prog-grid">
              <div className="r-it"><div className="r-l">학습 영역</div><div className="r-v">{extras.progress.area || "—"}</div></div>
              <div className="r-it"><div className="r-l">학습 시작일</div><div className="r-v">{fmtYmd(extras.progress.startDate) || "—"}</div></div>
            </div>
          </div>
        </div>
      ),
    },
    attendance: {
      show: true,
      aside: <span className="r-sec-aside">{data.year}년 {data.month}월</span>,
      body: <Calendar data={data} />,
    },
    evals: {
      show: showEvals,
      aside: weekly.length > 0 ? <span className="r-sec-aside">주간평가 평균 {weeklyAvg}점</span> : undefined,
      body: (
        <div className="r-evals">
          {extras.evals.map((e) => (
            <div className="r-ev" key={e.id}>
              <div className="r-ev-head">
                <span className={"r-ev-type " + (e.type === "주간평가" ? "wk" : "cp")}>{e.type}</span>
                <span className="r-ev-status">완료</span>
              </div>
              <div className="r-ev-name">{e.name}</div>
              <div className="r-ev-meta">{e.meta}</div>
              <div className="r-ev-bottom">
                <span className="r-ev-date">{fmtYmd(e.date)}</span>
                <span className={"r-ev-score " + scoreClass(e.score)}>
                  {e.score}<small>점</small>
                </span>
              </div>
            </div>
          ))}
        </div>
      ),
    },
    homework: {
      show: showHw,
      aside: <span className="r-sec-aside">총 {extras.homeworks.length}건</span>,
      body: (
        <div className="r-hw">
          {extras.homeworks.map((h) => {
            const cc = compClasses(h.completion);
            const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(h.date);
            return (
              <div className="r-hw-item" key={h.id}>
                <div className="r-hw-main">
                  <div className="r-hw-date">
                    {md ? md[2] : h.date}
                    {md && <span>/ {md[3]}</span>}
                  </div>
                  <div className="r-hw-book">
                    <div className="r-bk">{h.book}</div>
                    {h.tags.length > 0 && (
                      <div className="r-hw-tags">
                        {h.tags.map((t, i) => (
                          <i key={i}>{t}</i>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="r-hw-comp">
                    <div className="r-ctop">
                      <span className="r-cl">완성도</span>
                      <span className={"r-cv " + cc.txt}>{h.completion}%</span>
                    </div>
                    <div className="r-cbar"><span className={cc.bar} style={{ width: h.completion + "%" }} /></div>
                  </div>
                  <div className={"r-badge " + (h.status === "done" ? "done" : h.status === "late" ? "late" : "pending")}>
                    {h.status === "done" ? "검사 완료" : h.status === "late" ? "지연" : "검사 전"}
                  </div>
                </div>
                {h.memo && (
                  <div className="r-hw-cmt">
                    <span className="r-ck">선생님 메모</span>
                    <span className="r-ctxt">{h.memo}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ),
    },
    supplements: {
      show: showSup,
      aside: <span className="r-sec-aside">총 {supTotal}분 · {sups.length}건</span>,
      body: (
        <div className="r-sup">
          {sups.map((sp) => {
            const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sp.date);
            return (
              <div className="r-sup-item" key={sp.id}>
                <span className="r-sup-date">{md ? `${md[2]}/${md[3]}` : sp.date}</span>
                <span className="r-sup-min">{sp.minutes}분</span>
                <span className="r-sup-reason">{sp.reason || "—"}</span>
              </div>
            );
          })}
        </div>
      ),
    },
  };

  let n = 0;

  return (
    <div id="report-card" className="r-sheet">
      <header className="r-hd">
        <div className="r-hd-top">
          <img className="r-logo" src={LOGO} alt="바꿈영수학원" crossOrigin="anonymous" />
          <div className="r-period">
            <span className="r-pill">
              {data.year}. {pad(data.month)}
            </span>
            <span className="r-sub">월간 학습 리포트</span>
          </div>
        </div>
        <div className="r-eyebrow">MONTHLY LEARNING REPORT</div>
        <h1 className="r-title">
          <b>{data.studentName}</b> 학생
        </h1>
        <div className="r-meta">
          <span className="r-chip">
            학습 기간 <b>{data.year}. {pad(data.month)}. 01 – {pad(data.month)}. {new Date(data.year, data.month, 0).getDate()}</b>
          </span>
          <span className="r-chip">
            담당 <b>{data.teacher}</b>
          </span>
        </div>
      </header>

      <div className="r-body">
        {getReportOrder().map((k) => {
          const s = bodies[k];
          if (!s || !s.show) return null;
          const num = pad(++n);
          return (
            <section className="r-sec" key={k}>
              <div className="r-sec-head">
                <span className="r-sec-no">{num}</span>
                <span className="r-sec-title">{SECTION_LABELS[k]}</span>
                {s.aside}
              </div>
              {s.body}
            </section>
          );
        })}
      </div>

      <footer className="r-ft">
        <img src={LOGO} alt="바꿈영수학원" crossOrigin="anonymous" />
        <div className="r-ftmeta">
          본 리포트는 {data.year}년 {data.month}월 학습 기록을 바탕으로 작성되었습니다.
          <br />
          바꿈영수학원 · 바라던 꿈을 이루다
        </div>
      </footer>
    </div>
  );
}
