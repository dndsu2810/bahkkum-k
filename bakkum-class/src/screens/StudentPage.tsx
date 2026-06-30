import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { studentApi, STUDENT_LOG_ITEMS, type StudentPageData, type Curriculum, type CurriculumSection, type CurriculumRow, type StudentLogRow, type StudentGoal, type StudentLink } from "../lib/studentApi";
import { messageApi, type Message } from "../lib/messageApi";
import { DOW, TODAY, fmtFull, fmtMD, fmtMDDow, fmtWhen, mondayOf, parseD, todayStr } from "../lib/dates";
import { NoticeBanner } from "../components/NoticeBanner";
import { DateField } from "../components/DateControls";
import { getCachedLogo } from "../lib/configApi";
import { IssueBoard } from "./IssueBoard";
import { Guide } from "./Guide";
import { Notices } from "./Notices";
import { postApi } from "../lib/postApi";
import { DailyTests } from "./English";
import { Icon } from "../icons";
import { HexAvatar, CombGauge, Bee, SoezLogo } from "../soez";
import { Scoreboard } from "../components/Scoreboard";
import { QueueCard } from "../components/QueueCard";
import { baseballApi } from "../lib/baseballApi";
import type { MathBoard, BaseballRule, BaseballConfig } from "../lib/baseball";
import { HwChecklist } from "../components/HwChecklist";
import { Skeleton } from "../components/Skeleton";

// 학생 화면 로딩 자리표시 — 밋밋한 "불러오는 중…" 대신 실제 레이아웃(프로필·시간표) 모양으로.
function SpSkeleton() {
  return (
    <div className="sp-skel" aria-busy="true" aria-label="불러오는 중">
      <div className="sp-skel-card">
        <Skeleton w={64} h={64} r={14} />
        <div className="sp-skel-lines">
          <Skeleton w="42%" h={20} />
          <Skeleton w="62%" h={13} />
        </div>
      </div>
      <Skeleton w="100%" h={54} r={16} />
      <Skeleton w="100%" h={220} r={18} />
    </div>
  );
}
import { coerceAssign, type HwItem } from "../lib/engApi";
import { alimApi, type MyAlim } from "../lib/alimApi";
import { mathBandOf } from "../lib/grade";
import { WeekTimetable } from "../components/MathTimetableBoard";

/** 학생 개별 페이지(시간표 · 커리큘럼 · 일지 입력/이력).
 *  - 학생 본인: studentId 생략(본인). 일지 입력 가능, 커리큘럼 조회.
 *  - 강사/원장: studentId 지정. 커리큘럼 편집 + 일지 대리 입력. */
/** 안전한 링크만 — http(s)·mailto·tel만 허용(javascript: 등 차단). 서버도 거르지만 한 번 더. */
function safeUrl(u: string): boolean {
  return /^(https?:\/\/|mailto:|tel:)/i.test(String(u || "").trim());
}

/** 학생 화면 바로가기 — 강사가 학생별로 넣은 링크를 버튼으로. 링크 이름이 버튼 글자, 누르면 새 탭으로 이동. */
function LinkCard({ links }: { links: StudentLink[] }) {
  const safe = links.filter((l) => l.name && safeUrl(l.url));
  if (!safe.length) return null;
  return (
    <section className="sp-card">
      <h3 className="sp-card-h">바로가기</h3>
      <div className="sp-links">
        {safe.map((l, i) => (
          <a key={i} className="sp-link-btn" href={l.url} target="_blank" rel="noopener noreferrer">
            <Icon name="link" />
            <span>{l.name}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

export function StudentPage({ studentId, embedded }: { studentId?: string; embedded?: boolean }) {
  const [data, setData] = useState<StudentPageData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const d = await studentApi.page(studentId);
      setData(d);
      setErr("");
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }
  // 조용히 새로고침(로딩표시 없이) — 선생님이 체크한 게 학생 화면에 바로 반영되게.
  // 내용이 그대로면 상태를 바꾸지 않아 리렌더를 막는다(입력 중 화면이 튀지 않게).
  async function reloadSilent() {
    try { const d = await studentApi.page(studentId); setData((cur) => (JSON.stringify(cur) === JSON.stringify(d) ? cur : d)); } catch { /* 폴링 실패는 무시 */ }
  }
  useEffect(() => {
    load();
    const iv = setInterval(reloadSilent, 15000);
    const onFocus = () => void reloadSilent();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  if (loading) return <SpSkeleton />;
  if (err || !data) return <div className="sp-empty">불러오지 못했어요{err ? ` (${err})` : ""}.</div>;

  const canEditCur = data.canEditCurriculum;
  const s = data.student;
  const isMidBand = s.band === "mid" || s.band === "bridge"; // 중고등 — '오늘 뭐해요?'(초등 커리큘럼)·자율학습 카드 숨김

  // 이번 달 출석 — 벌집 게이지(출석/조퇴/지각을 출석으로). 기록이 있을 때만.
  const ym = todayStr().slice(0, 7);
  const monthRecs = data.daily.filter((r) => r.date.slice(0, 7) === ym && r.attStatus);
  const presentDays = monthRecs.filter((r) => ["출석", "지각", "조퇴"].includes(r.attStatus)).length;

  return (
    <div className={"sp" + (embedded ? " is-embed" : "")}>
      {/* 헤더 — 학생 프로필. 오른쪽 빈 공간에 번호표(컴팩트). 본인 화면에서만(강사가 볼 땐 숨김). */}
      <div className="sp-head">
        <HexAvatar name={s.name} photo={s.photo} size={56} className="sp-avatar-hex" />
        <div className="sp-head-info">
          <h2>{s.name}</h2>
          <div className="sp-sub">
            {[s.grade, s.school, s.band === "elem" ? "초등 영어" : s.band === "mid" ? "중고등 영어" : ""].filter(Boolean).join(" · ")}
          </div>
        </div>
        {!studentId && <QueueCard compact />}
      </div>

      {monthRecs.length > 0 && (
        <div className="sp-att-gauge">
          <span className="sp-att-label">이번 달 출석</span>
          <CombGauge value={presentDays} total={monthRecs.length} size={16} />
          <b className="sp-att-num">{presentDays}<span>/{monthRecs.length}일</span></b>
        </div>
      )}

      <div className="sp-grid">
        {/* 시간표 — 영수 둘 다 들으면 두 과목 함께, 한 과목만 들으면 그 과목만 */}
        <section className="sp-card">
          <h3 className="sp-card-h">수업 시간표</h3>
          <WeekTimetable math={data.mathSlots} eng={data.engSlots} />
        </section>

        {/* 오늘 뭐해요? — 선생님이 정한 학습 순서·내용(초등영어 전용). 학생은 읽기 전용, 권한자는 편집.
            아래 '내가 추가한 학습'은 학생이 스스로 반복할 학습(강사 커리큘럼과 별개). */}
        {!isMidBand && (
          <section className="sp-card">
            <h3 className="sp-card-h">오늘 뭐해요?</h3>
            {canEditCur ? (
              <CurriculumEditor studentId={s.id} cur={data.curriculum} onSaved={reloadSilent} />
            ) : (
              <CurriculumView cur={data.curriculum} />
            )}
            <SelfLearning items={data.selfCurriculum} studentId={canEditCur ? s.id : undefined} onSaved={reloadSilent} />
          </section>
        )}
      </div>

      {/* 오늘 일지 바로가기 링크 — 선생님이 그날 일지에 넣은 버튼(있을 때만) */}
      {(() => { const tl = data.daily.find((r) => r.date === todayStr())?.links || []; return tl.length > 0 ? <LinkCard links={tl} /> : null; })()}

      {/* 일지 입력 */}
      <section className="sp-card">
        <h3 className="sp-card-h">{canEditCur ? "수업 일지 입력" : "오늘 수업 일지"}</h3>
        {data.progressBooks && data.progressBooks.length > 0 && (
          <div className="sp-progbooks">
            <span className="sp-progbooks-l">현재 교재</span>
            {data.progressBooks.map((b) => <span className="sp-hw-chip" key={b}>{b}</span>)}
          </div>
        )}
        <LogEditor studentId={canEditCur ? s.id : undefined} tid={s.id} existing={data.daily} slots={data.engSlots} options={data.doneItemOptions} band={s.band} progressBooks={data.progressBooks || []} examMode={data.examMode || false} onSaved={reloadSilent} />
      </section>

      {/* 일지 이력 */}
      <section className="sp-card">
        <h3 className="sp-card-h">지난 일지</h3>
        <LogHistory rows={data.daily} band={s.band} />
      </section>
    </div>
  );
}

/* 월 이동(YYYY-MM) 헬퍼 — 숙제 기록 월별 보기용. */
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}.${Number(m)}`;
}

/* 수학 숙제 한 줄 — 검사일(검사 예정일=recheck, 없으면 마감일)을 함께 보여줘요. */
function HwRow({ h }: { h: { date: string; book: string; status: string; memo: string; recheckDate?: string } }) {
  const checkDay = h.recheckDate || h.date;
  return (
    <li className="sp-mrow">
      <span className={"sp-mtag " + (h.status === "done" ? "ok" : h.status === "late" ? "bad" : "warn")}>
        {h.status === "done" ? "완료" : h.status === "late" ? "지연" : "검사 전"}
      </span>
      <span className="sp-mmain">{h.book || "숙제"}{h.memo ? ` · ${h.memo}` : ""}</span>
      <span className="sp-mdate">{checkDay ? `검사 ${fmtMDDow(checkDay)}` : "검사일 미정"}</span>
    </li>
  );
}

/* ---------------- 수학 학생 화면 (영어 화면과 같은 자리 배치) ----------------
 *  2단계(읽기 전용): 기존 수학 기록(출석·숙제·진도·시험·보강·등하원)을 그대로 보여줘요.
 *  쓰기(선생님께 메모·알림장 작성·주간 신청)는 다음 단계. */
function MathStudentPage() {
  const [data, setData] = useState<StudentPageData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0); // 시간표 주차 이동(화살표)
  const [hwMonth, setHwMonth] = useState(() => todayStr().slice(0, 7)); // 숙제 기록 월
  const [showDoneHw, setShowDoneHw] = useState(false); // 완료 숙제 토글
  const [alims, setAlims] = useState<MyAlim[]>([]); // 활성 알림장 공지(마감 안 지난 것)
  const firstErr = useRef(true);
  useEffect(() => {
    let on = true;
    const load = () => alimApi.mine(todayStr()).then((l) => { if (on) setAlims(l); });
    void load();
    const iv = window.setInterval(load, 30000);
    return () => { on = false; window.clearInterval(iv); };
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () => studentApi.page()
      .then((d) => { if (alive) { setData((cur) => (JSON.stringify(cur) === JSON.stringify(d) ? cur : d)); setErr(""); firstErr.current = false; setLoading(false); } })
      .catch((e) => { if (alive) { if (firstErr.current) setErr(String((e as Error)?.message || e)); setLoading(false); } });
    void load();
    const iv = window.setInterval(load, 15000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);

  if (loading) return <SpSkeleton />;
  if (err || !data) return <div className="sp-empty">불러오지 못했어요{err ? ` (${err})` : ""}.</div>;
  const s = data.student;
  const band = mathBandOf(s.grade, (data.mathClass as "" | "low" | "high") || "");
  const bandLabel = band === "low" ? "초등 저학년" : band === "high" ? "초등 고학년" : "중고등";
  const math = data.math;
  const today = todayStr();
  const ym = today.slice(0, 7);
  const slots = data.mathSlots || [];

  // 이번 달 출석(벌집) — 출석/지각/조퇴를 출석으로.
  const monthAtt = (math?.attendance || []).filter((r) => r.date.slice(0, 7) === ym && r.status);
  const present = monthAtt.filter((r) => ["출석", "지각", "조퇴"].includes(r.status)).length;

  // 오늘 본 시험 / 예정 시험.
  const tests = math?.tests || [];
  const todayDone = tests.filter((t) => t.date === today && t.status === "완료");
  const upcomingTests = tests.filter((t) => t.status === "예정" && (!t.date || t.date >= today)).slice(0, 4);
  // 진행 중 진도.
  const ongoing = (math?.progress || []).filter((p) => p.pct < 100).slice(0, 6);
  // 알림장(오늘) — 강사 메모 + 오늘 숙제 자동.
  const noteToday = math?.noteToday || "";
  const todayHw = (math?.homework || []).filter((h) => h.date === today);
  // 숙제 — 마감(미완료) 요약 + 선택한 달 기록(완료는 토글).
  const pendingHw = (math?.homework || []).filter((h) => h.status !== "done");
  const monthHw = (math?.homework || []).filter((h) => (h.date || "").slice(0, 7) === hwMonth);
  const hwTodo = monthHw.filter((h) => h.status !== "done");
  const hwDone = monthHw.filter((h) => h.status === "done");
  // 다가올 보강 — 완료/스킵 제외 + 보강일이 지나지 않은 것만(지난 건 끝난 보강).
  const upcomingMakeups = (math?.makeups || []).filter((m) => m.status !== "done" && m.status !== "skip" && (!m.makeupDate || m.makeupDate >= today)).slice(0, 6);
  // 최근 등하원.
  const checkin = (math?.checkin || []).slice(0, 8);

  // 오늘 수업(요일 일치).
  const todayKor = ["일", "월", "화", "수", "목", "금", "토"][new Date().getDay()];
  const todayClasses = slots.filter((sl) => sl.day === todayKor).sort((a, b) => a.time.localeCompare(b.time));

  // 시간표 주차 라벨.
  const mon = mondayOf(TODAY, weekOffset);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const weekLabel = weekOffset === 0 ? "이번 주" : weekOffset === 1 ? "다음 주" : weekOffset === -1 ? "지난 주" : `${fmtMD(mon)}~${fmtMD(sun)}`;

  return (
    <div className="sp">
      {/* (C) 프로필 + 번호표 */}
      <div className="sp-head">
        <HexAvatar name={s.name} photo={s.photo} size={56} className="sp-avatar-hex" />
        <div className="sp-head-info">
          <h2>{s.name}</h2>
          <div className="sp-sub">{[s.grade, s.school, "수학 · " + bandLabel].filter(Boolean).join(" · ")}</div>
        </div>
        <QueueCard compact />
      </div>

      {/* 프로필 요약 — 오늘·다가오는 일정·마감 숙제 한눈에 */}
      <div className="sp-summary">
        <div className="sp-sum">
          <span className="sp-sum-l">오늘 수업</span>
          <b>{todayClasses.length ? todayClasses.map((c) => c.time).join(", ") : "없음"}</b>
        </div>
        <div className="sp-sum">
          <span className="sp-sum-l">마감 숙제</span>
          <b className={pendingHw.length ? "warn" : ""}>{pendingHw.length ? `${pendingHw.length}건` : "없음"}</b>
        </div>
        <div className="sp-sum">
          <span className="sp-sum-l">다가오는 보강</span>
          <b>{upcomingMakeups[0] ? (upcomingMakeups[0].makeupDate ? fmtMDDow(upcomingMakeups[0].makeupDate) : "조율 중") : "없음"}</b>
        </div>
        <div className="sp-sum">
          <span className="sp-sum-l">다가오는 시험</span>
          <b>{upcomingTests[0] ? (upcomingTests[0].date ? fmtMDDow(upcomingTests[0].date) : "미정") : "없음"}</b>
        </div>
      </div>

      {/* (D) 이번 달 출석 — 벌집 */}
      {monthAtt.length > 0 && (
        <div className="sp-att-gauge">
          <span className="sp-att-label">이번 달 출석</span>
          <CombGauge value={present} total={monthAtt.length} size={16} />
          <b className="sp-att-num">{present}<span>/{monthAtt.length}일</span></b>
        </div>
      )}

      <div className="sp-grid">
        {/* (E 왼쪽) 수학 시간표 — 컴팩트(에타) + 주차 화살표 */}
        <section className="sp-card">
          <div className="sp-card-head">
            <h3 className="sp-card-h" style={{ margin: 0 }}>수업 시간표</h3>
            <div className="sp-week">
              <button className="sp-week-arr" onClick={() => setWeekOffset((w) => w - 1)} aria-label="이전 주">‹</button>
              <span className="sp-week-lbl">{weekLabel}</span>
              <button className="sp-week-arr" onClick={() => setWeekOffset((w) => w + 1)} aria-label="다음 주">›</button>
            </div>
          </div>
          <WeekTimetable math={data.mathSlots} eng={data.engSlots} />
          <p className="sp-muted" style={{ marginTop: 8 }}>시간표는 보기 전용이에요. 수정은 선생님만 할 수 있어요.</p>
        </section>

        {/* (E 오른쪽) 알림장(오늘) + 수학 숙제 기록 */}
        <section className="sp-card">
          <div className="sp-classnote">
            <div className="sp-classnote-h">오늘 알림장 · {fmtMDDow(today)}</div>
            {alims.length > 0 && (
              <ul className="sp-alim-list">
                {alims.map((a) => (
                  <li className="sp-alim-item" key={a.id}>
                    <span className="sp-alim-body">{a.body}</span>
                    {a.dueDate && <span className="sp-alim-due">{fmtMDDow(a.dueDate)}까지</span>}
                  </li>
                ))}
              </ul>
            )}
            {todayHw.length > 0 && <ul className="sp-mlist">{todayHw.map((h, i) => <HwRow key={i} h={h} />)}</ul>}
            {noteToday ? (
              <p className="sp-classnote-memo">{noteToday}</p>
            ) : (
              todayHw.length === 0 && alims.length === 0 && <div className="sp-muted">오늘 알림장이 없어요.</div>
            )}
          </div>
          <div className="sp-card-head" style={{ marginTop: 14 }}>
            <h4 className="sp-classnote-sub">숙제 기록</h4>
            <div className="sp-week">
              <button className="sp-week-arr" onClick={() => setHwMonth((mm) => shiftMonth(mm, -1))} aria-label="이전 달">‹</button>
              <span className="sp-week-lbl">{monthLabel(hwMonth)}</span>
              <button className="sp-week-arr" onClick={() => setHwMonth((mm) => shiftMonth(mm, 1))} aria-label="다음 달">›</button>
            </div>
          </div>
          {hwTodo.length === 0 && hwDone.length === 0 ? (
            <div className="sp-muted">이 달 숙제 기록이 없어요.</div>
          ) : (
            <>
              {hwTodo.length > 0 ? (
                <ul className="sp-mlist">{hwTodo.map((h, i) => <HwRow key={i} h={h} />)}</ul>
              ) : (
                <div className="sp-muted">검사할 숙제가 없어요.</div>
              )}
              {hwDone.length > 0 && (
                <>
                  <button className="sp-toggle" onClick={() => setShowDoneHw((v) => !v)} aria-expanded={showDoneHw}>
                    완료 {hwDone.length}개 {showDoneHw ? "숨기기" : "보기"}
                  </button>
                  {showDoneHw && <ul className="sp-mlist">{hwDone.map((h, i) => <HwRow key={i} h={h} />)}</ul>}
                </>
              )}
            </>
          )}
        </section>
      </div>

      {/* (F) 오늘 수업 일지 — 진도·시험(읽기 전용) */}
      <section className="sp-card">
        <h3 className="sp-card-h">오늘 수업 일지</h3>
        <div className="sp-mblocks">
          <div className="sp-mblock">
            <div className="sp-mblock-h">진행 중 진도</div>
            {ongoing.length === 0 ? <div className="sp-muted">진행 중인 진도가 없어요.</div> : (
              <ul className="sp-mlist">
                {ongoing.map((p, i) => <li key={i} className="sp-mrow"><span className="sp-mmain">{p.unit}{p.area ? ` · ${p.area}` : ""}</span><span className="sp-mdate">{p.pct}%</span></li>)}
              </ul>
            )}
          </div>
          <div className="sp-mblock">
            <div className="sp-mblock-h">오늘 본 시험</div>
            {todayDone.length === 0 ? <div className="sp-muted">오늘 본 시험이 없어요.</div> : (
              <ul className="sp-mlist">
                {todayDone.map((t, i) => <li key={i} className="sp-mrow"><span className="sp-mmain">{t.type}{t.range ? ` · ${t.range}` : ""}</span><span className="sp-mscore">{t.score}점</span></li>)}
              </ul>
            )}
          </div>
          <div className="sp-mblock">
            <div className="sp-mblock-h">예정 시험</div>
            {upcomingTests.length === 0 ? <div className="sp-muted">예정된 시험이 없어요.</div> : (
              <ul className="sp-mlist">
                {upcomingTests.map((t, i) => <li key={i} className="sp-mrow"><span className="sp-mmain">{t.type}{t.range ? ` · ${t.range}` : ""}</span><span className="sp-mdate">{t.date ? fmtMDDow(t.date) : "미정"}</span></li>)}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* (G) 등하원 · 보강 */}
      <section className="sp-card">
        <h3 className="sp-card-h">등하원 · 보강</h3>
        <div className="sp-mblocks">
          <div className="sp-mblock">
            <div className="sp-mblock-h">다가올 보강</div>
            {upcomingMakeups.length === 0 ? <div className="sp-muted">예정된 보강이 없어요.</div> : (
              <ul className="sp-mlist">
                {upcomingMakeups.map((m, i) => (
                  <li key={i} className="sp-mrow">
                    <span className="sp-mmain">{m.makeupDate ? `${fmtMDDow(m.makeupDate)}${m.makeupTime ? " " + m.makeupTime : ""}` : "일정 조율 중"}{m.memo ? ` · ${m.memo}` : ""}</span>
                    <span className="sp-mtag warn">{m.absentDate ? `${m.absentDate.slice(5)} 결석분` : "보강"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="sp-mblock">
            <div className="sp-mblock-h">최근 등하원</div>
            {checkin.length === 0 ? <div className="sp-muted">등하원 기록이 없어요.</div> : (
              <ul className="sp-mlist">
                {checkin.map((c, i) => (
                  <li key={i} className="sp-mrow">
                    <span className={"sp-mtag " + (c.kind === "하원" ? "info" : "ok")}>{c.kind}</span>
                    <span className="sp-mmain">{c.subject || "수업"}</span>
                    <span className="sp-mdate">{fmtMDDow(c.date)} {c.time}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/* 영어·수학 둘 다 듣는 학생의 진입 선택 화면. */
function SubjectPicker({ onPick }: { onPick: (s: "math" | "english") => void }) {
  return (
    <div className="sp-pick">
      <h2 className="sp-pick-title">오늘 어떤 수업을 볼까요?</h2>
      <p className="sp-pick-sub">과목을 고르면 그 과목 화면으로 들어가요. 언제든 위에서 바꿀 수 있어요.</p>
      <div className="sp-pick-grid">
        <button className="sp-pick-card eng" onClick={() => onPick("english")}>
          <span className="sp-pick-ic"><Icon name="book" /></span>
          <b>영어</b>
          <span>영어 시간표 · 수업 일지</span>
        </button>
        <button className="sp-pick-card math" onClick={() => onPick("math")}>
          <span className="sp-pick-ic"><Icon name="baseball" /></span>
          <b>수학</b>
          <span>수학 시간표 · 수학 야구</span>
        </button>
      </div>
    </div>
  );
}

/* ---------------- 내가 추가한 학습(학생 본인이 자율 추가) ---------------- */
function SelfLearning({ items, studentId, onSaved }: { items: CurriculumRow[]; studentId?: string; onSaved: () => void }) {
  const { user } = useAuth();
  const isStudent = user?.role === "student"; // 학생은 추가는 되지만 삭제는 못 해요.
  const [rows, setRows] = useState<CurriculumRow[]>(items);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => setRows(items), [items]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(items);
  const add = () => setRows([...rows, { name: "", amount: "" }]);
  const setRow = (i: number, patch: Partial<CurriculumRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const del = (i: number) => setRows(rows.filter((_, j) => j !== i));
  async function save() {
    setSaving(true);
    setMsg("");
    try {
      await studentApi.saveSelfCurriculum(rows.filter((r) => r.name.trim() || r.amount.trim()), studentId);
      setMsg("저장됐어요 ✓");
      onSaved();
    } catch {
      setMsg("저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="sp-self">
      <div className="sp-self-h">내가 추가한 학습 <span className="sp-self-sub">스스로 반복할 학습을 추가해요</span></div>
      {rows.length === 0 && <div className="sp-muted">아직 추가한 학습이 없어요. 아래 ‘추가’로 넣어보세요.</div>}
      {rows.map((r, i) => (
        <div className="sp-self-row" key={i}>
          <input className="input" value={r.name} placeholder="학습 (예: 단어 복습)" onChange={(e) => setRow(i, { name: e.target.value })} />
          <input className="input sp-self-amt" value={r.amount} placeholder="분량(선택)" onChange={(e) => setRow(i, { amount: e.target.value })} />
          {!isStudent && <button type="button" className="sp-self-del" onClick={() => del(i)} aria-label="삭제"><Icon name="x" /></button>}
        </div>
      ))}
      <div className="sp-self-act">
        <button type="button" className="btn ghost sm" onClick={add}><Icon name="plus" /> 추가</button>
        <button type="button" className="btn primary sm" onClick={save} disabled={!dirty || saving}>{saving ? "저장 중…" : "저장"}</button>
        {msg && <span className="sp-saved">{msg}</span>}
      </div>
    </div>
  );
}

/* ---------------- 오늘 뭐해요?(읽기 전용) — 선생님이 정한 순서·내용을 학생에게 보여줘요. ---------------- */
function CurriculumView({ cur }: { cur: Curriculum }) {
  if (!cur.sections.length) return <div className="sp-muted">아직 등록된 학습이 없어요.</div>;
  return (
    <div className="sp-cur">
      {cur.note && <div className="sp-cur-note"><Icon name="info" /> {cur.note}</div>}
      {cur.sections.map((sec, si) => (
        <div className="sp-cur-sec" key={si}>
          {sec.title && <div className="sp-cur-sectitle">{sec.title}</div>}
          <ol className="sp-cur-rows">
            {sec.rows.map((r, ri) => (
              <li className="sp-cur-row" key={ri}>
                <span className="sp-cur-name">{r.name}</span>
                {r.amount && <span className="sp-cur-amt">{r.amount}</span>}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

/* ---------------- 커리큘럼(편집, 초등영어 권한자) ---------------- */
export function CurriculumEditor({ studentId, cur, onSaved }: { studentId: string; cur: Curriculum; onSaved: () => void }) {
  const [draft, setDraft] = useState<Curriculum>(cur);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(cur), [cur]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(cur);
  const setSec = (si: number, patch: Partial<CurriculumSection>) => setDraft((d) => ({ ...d, sections: d.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)) }));
  const setRow = (si: number, ri: number, patch: Partial<CurriculumRow>) =>
    setSec(si, { rows: draft.sections[si].rows.map((r, i) => (i === ri ? { ...r, ...patch } : r)) });

  async function save() {
    setSaving(true);
    try {
      await studentApi.saveCurriculum(studentId, draft);
      onSaved();
    } finally {
      setSaving(false);
    }
  }
  async function loadTemplate() {
    setDraft(await studentApi.curriculumDefaults());
  }

  return (
    <div className="sp-cur-edit">
      <textarea
        className="input sp-cur-noteinput"
        rows={2}
        value={draft.note}
        placeholder="안내 문구 (예: 1개의 학습을 완전히 마무리 하고 다음 학습으로 넘어가세요.)"
        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
      />
      {draft.sections.map((sec, si) => (
        <div className="sp-cur-esec" key={si}>
          <div className="sp-cur-esec-head">
            <input
              className="input sp-cur-sectinput"
              value={sec.title}
              placeholder="섹션 이름 (예: 매일 반복)"
              onChange={(e) => setSec(si, { title: e.target.value })}
            />
            <button className="sp-x" title="섹션 삭제" onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_, i) => i !== si) })}>×</button>
          </div>
          {sec.rows.map((r, ri) => (
            <div className="sp-cur-erow" key={ri}>
              <span className="sp-cur-num">{ri + 1}</span>
              <input className="input sp-cur-name-i" value={r.name} placeholder="학습 (예: 단어시험)" onChange={(e) => setRow(si, ri, { name: e.target.value })} />
              <input className="input sp-cur-amt-i" value={r.amount} placeholder="내용 (예: 10개씩)" onChange={(e) => setRow(si, ri, { amount: e.target.value })} />
              <button className="sp-x" title="삭제" onClick={() => setSec(si, { rows: sec.rows.filter((_, i) => i !== ri) })}>×</button>
            </div>
          ))}
          <button className="btn ghost sm" onClick={() => setSec(si, { rows: [...sec.rows, { name: "", amount: "" }] })}>+ 항목</button>
        </div>
      ))}
      <div className="sp-cur-actions">
        <button className="btn ghost sm" onClick={() => setDraft({ ...draft, sections: [...draft.sections, { title: "", rows: [{ name: "", amount: "" }] }] })}>+ 섹션</button>
        {!draft.sections.length && <button className="btn ghost sm" onClick={loadTemplate}>기본 양식 불러오기</button>}
        <button className="btn primary sm" onClick={save} disabled={!dirty || saving}>{saving ? "저장 중…" : dirty ? "저장" : "저장됨"}</button>
      </div>
    </div>
  );
}

/* ---------------- 일지 입력 ---------------- */
/** 현재 시각 'HH:MM'. */
function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** 'HH:MM' + 분 → 'HH:MM' (수업 길이로 끝시간 계산). */
function addMin(hm: string, min: number): string {
  const [h, m] = hm.split(":").map(Number);
  const t = h * 60 + m + min;
  const hh = Math.floor((t % 1440) / 60);
  const mm = t % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/* 지난 일지 이력의 숙제 3분류 태그 색상. */
const hwTagCls = (v: string) => (v === "완료" ? "sp-tag-done" : v === "미흡" ? "sp-tag-warn" : v === "안함" ? "sp-tag-bad" : "");

function LogEditor({ studentId, tid, existing, slots, options, band, progressBooks = [], examMode = false, onSaved }: { studentId?: string; tid: string; existing: StudentLogRow[]; slots: { day: string; time: string; duration: number }[]; options?: string[]; band: string; progressBooks?: string[]; examMode?: boolean; onSaved: () => void }) {
  const { user } = useAuth();
  const items = options && options.length ? options : STUDENT_LOG_ITEMS;
  const isMid = band === "mid" || band === "bridge"; // 중고등(Bridge 포함) — 숙제 3분류·교재 진도
  // 숙제 체크리스트 작성자 — 학생 본인이면 학생, 강사/원장이 보는 중이면 강사.
  const hwBy: "student" | "teacher" = user?.role === "student" ? "student" : "teacher";
  const isStudent = user?.role === "student"; // 학생은 추가·체크는 되지만 삭제는 못 해요.
  const hwByName = user?.name || "";
  const [date, setDate] = useState(todayStr());
  const [goals, setGoals] = useState<StudentGoal[]>([]);
  const [goalText, setGoalText] = useState("");
  const [bookNo, setBookNo] = useState("");
  // 숙제 검사(지난 수업 숙제) — 강사가 낸 지난 숙제. 학생이 '했다' 체크하면 줄긋기(강사와 양방향).
  const [hwCheck, setHwCheck] = useState<{ text: string; status: string }[]>([]);
  // 오늘의 숙제 — 선생님이 낸 숙제·배부 자료 + 학생도 직접 추가(강사와 양방향). 항목별 상태·작성자.
  const [hwAssign, setHwAssign] = useState<HwItem[]>([]);
  const [doneItems, setDoneItems] = useState<string[]>([]);
  const [curRanges, setCurRanges] = useState<Record<string, string>>({}); // 항목별 범위/분량
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [studentNote, setStudentNote] = useState("");
  // 선생님 코멘트(수업·숙제) — 강사가 작성, 학생은 읽기 전용.
  const teacherComment = existing.find((r) => r.date === date)?.comment || "";
  const teacherHwComment = existing.find((r) => r.date === date)?.hwComment || "";
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const dirtyRef = useRef(false); // 학생이 입력 중인지 — 폴링이 입력을 덮어쓰지 않게
  const dateRef = useRef(date);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 선택한 날짜에 이미 기록이 있으면 불러와 이어 적기. 날짜가 바뀌면 항상 갱신,
  // 같은 날짜 폴링 갱신은 학생이 입력 중이 아닐 때만(선생님 입력 반영).
  useEffect(() => {
    const dateChanged = dateRef.current !== date;
    dateRef.current = date;
    if (!dateChanged && dirtyRef.current) return;
    const row = existing.find((r) => r.date === date);
    setGoals(row?.goals || []);
    setHwCheck(row?.hwCheck || []);
    setHwAssign(coerceAssign(row?.hwAssign));
    setBookNo(row?.bookNo || "");
    setDoneItems(row?.doneItems || []);
    setCurRanges(row?.curRanges || {});
    setStartTime(row?.startTime || "");
    setEndTime(row?.endTime || "");
    setStudentNote(row?.studentNote || "");
    dirtyRef.current = false;
  }, [date, existing]);

  // 자동 저장 — 아이들이 '저장'을 안 눌러도 입력하면 잠시 뒤 저절로 저장(잃어버리지 않게).
  useEffect(() => {
    if (!dirtyRef.current) return; // 로드·폴링 갱신은 저장하지 않음(사용자 입력만)
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => { void save(); }, 1200);
    return () => { if (autoTimer.current) clearTimeout(autoTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals, hwCheck, hwAssign, bookNo, doneItems, curRanges, startTime, endTime, studentNote]);

  // 선택한 날짜의 요일에 잡힌 수업시간(자동입력용).
  const dow = DOW[parseD(date).getDay()];
  const scheduled = slots.find((s) => s.day === dow);

  function fillScheduled() {
    if (!scheduled) return;
    dirtyRef.current = true;
    setStartTime(scheduled.time);
    if (scheduled.duration) setEndTime(addMin(scheduled.time, scheduled.duration));
  }

  // 학생이 직접 학습 목표 추가 — 강사와 같은 목표 목록 공유(양방향).
  function addGoal() {
    const t = goalText.trim();
    if (!t) return;
    dirtyRef.current = true;
    setGoals([...goals, { text: t, done: false }]);
    setGoalText("");
  }
  async function save() {
    dirtyRef.current = false; // 저장 시작 시점 — 저장 도중 새로 입력하면 다시 dirty가 되어 보존됨
    setSaving(true);
    setSavedMsg("");
    try {
      await studentApi.saveLog({ studentId, date, goals, hwCheck, hwAssign, bookNo, doneItems, curRanges, startTime, endTime, studentNote });
      setSavedMsg("저장됐어요 ✓");
      onSaved();
    } catch (e) {
      setSavedMsg("저장 실패: " + String((e as Error)?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sp-log-edit" onChangeCapture={() => { dirtyRef.current = true; }}>
      <div className="sp-f">
        <span>날짜</span>
        <DateField value={date} onChange={setDate} />
      </div>

      {/* 수업 시간 — '지금' 버튼으로 한 번에 찍기 + 시간표 자동입력 */}
      <div className="sp-f">
        <span>수업 시간</span>
        <div className="sp-time">
          <div className="sp-time-one">
            <label>시작</label>
            <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <button type="button" className="sp-now" onClick={() => { dirtyRef.current = true; setStartTime(nowHM()); }}>지금</button>
          </div>
          <span className="sp-time-tilde">~</span>
          <div className="sp-time-one">
            <label>끝</label>
            <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            <button type="button" className="sp-now" onClick={() => { dirtyRef.current = true; setEndTime(nowHM()); }}>지금</button>
          </div>
        </div>
        {scheduled && (
          <button type="button" className="sp-time-auto" onClick={fillScheduled}>
            <Icon name="clock" /> 오늘 수업시간 자동입력 ({scheduled.time}{scheduled.duration ? `~${addMin(scheduled.time, scheduled.duration)}` : ""})
          </button>
        )}
      </div>

      {/* 학습 목표 — 선생님·학생이 함께. 직접 추가하고, 한 것에 체크하면 선생님 화면에도 똑같이 반영돼요. */}
      <div className="sp-f">
        <span>학습 목표 (직접 추가하고, 한 것에 체크!)</span>
        {goals.length > 0 && (
          <div className="sp-goals">
            {goals.map((g, i) => {
              const on = g.done;
              return (
                <label key={i} className={"sp-check" + (on ? " on" : "")}>
                  <input type="checkbox" checked={on} onChange={() => { dirtyRef.current = true; setGoals(goals.map((x, j) => (j === i ? { ...x, done: !x.done } : x))); }} />
                  <span className="sp-check-box" aria-hidden="true" />
                  <span className="sp-check-label">{g.text}</span>
                  {!isStudent && <button type="button" className="sp-hw-x" onClick={(e) => { e.preventDefault(); dirtyRef.current = true; setGoals(goals.filter((_, j) => j !== i)); }} aria-label="삭제">×</button>}
                </label>
              );
            })}
          </div>
        )}
        {/* 진행중 교재 칩 — 누르면 목표 입력칸에 채워져요. 내신모드에서도 강사 대시보드처럼 항상 보여줘요. */}
        {progressBooks.length > 0 && (
          <div className="today-bookchips" style={{ marginTop: 6 }}>
            <span className="today-bookchips-lbl">진행중 교재</span>
            {progressBooks.map((b) => (
              <button type="button" className="today-bookchip" key={b} title="이 교재로 목표 채우기" onClick={() => { dirtyRef.current = true; setGoalText(b + " "); }}>{b}</button>
            ))}
          </div>
        )}
        <div className="sp-self-row" style={{ marginTop: 6 }}>
          <input className="input" value={goalText} onChange={(e) => setGoalText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) addGoal(); }} placeholder="학습 목표 추가 (예: 단어 50개 외우기)" />
          <button type="button" className="btn ghost sm" onClick={addGoal} disabled={!goalText.trim()}><Icon name="plus" /> 추가</button>
        </div>
      </div>

      {/* 교재·진도(중고등)·원서 진도번호(초등) — 내신기간엔 진도를 안 쓰므로 숨겨요. */}
      {!examMode && (
        <div className="sp-f">
          <span>{isMid ? "교재 · 진도" : "원서 진도번호"}</span>
          <input className="input" value={bookNo} onChange={(e) => setBookNo(e.target.value)} placeholder={isMid ? "예: 그래머인유즈 3과 p.40~45" : "예: 145"} />
        </div>
      )}

      {isMid ? (
        /* 숙제 검사 (지난 수업 숙제) — 강사가 낸 지난 숙제. 학생이 한 것에 체크하면 줄긋기(강사와 공유). */
        <div className="sp-f">
          <span>숙제 검사 (지난 수업 숙제)</span>
          {hwCheck.length === 0 ? (
            <div className="sp-muted">아직 검사할 숙제가 없어요.</div>
          ) : (
            <div className="sp-checks">
              {hwCheck.map((c, i) => {
                const on = c.status === "완료";
                return (
                  <label key={i} className={"sp-check" + (on ? " on" : "")}>
                    <input type="checkbox" checked={on} onChange={() => { dirtyRef.current = true; setHwCheck(hwCheck.map((x, j) => (j === i ? { ...x, status: on ? "" : "완료" } : x))); }} />
                    <span className="sp-check-box" aria-hidden="true" />
                    <span className="sp-check-label">{c.text}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* 오늘뭐해요 — 항목별로 '완료' 체크 + 범위(분량) 입력. 항목은 '오늘 한 것 수정' 버튼으로 관리. */
        <div className="sp-f">
          <span>오늘뭐해요 (한 것에 체크하고, 어디까지 했는지 적어요)</span>
          <div className="sp-curlist">
            {items.map((it) => {
              const on = doneItems.includes(it);
              return (
                <div key={it} className={"sp-curitem" + (on ? " on" : "")}>
                  <label className={"sp-check" + (on ? " on" : "")}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => { dirtyRef.current = true; setDoneItems(on ? doneItems.filter((x) => x !== it) : [...doneItems, it]); }}
                    />
                    <span className="sp-check-box" aria-hidden="true" />
                    <span className="sp-check-label">{it}</span>
                  </label>
                  <input
                    className="sp-currange"
                    value={curRanges[it] || ""}
                    onChange={(e) => { dirtyRef.current = true; setCurRanges({ ...curRanges, [it]: e.target.value }); }}
                    placeholder="범위 (예: p.20~25)"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 오늘의 숙제 — 항목마다 완료/미흡/안함/없음 + 작성자(학생 초록 / 강사 주황). 선생님 화면과 양방향 공유. */}
      <div className="sp-f">
        <span>오늘의 숙제</span>
        <HwChecklist items={hwAssign} onChange={(next) => { dirtyRef.current = true; setHwAssign(next); }} currentBy={hwBy} currentByName={hwByName} placeholder="오늘 받은 숙제 추가 (예: 단어 3과 외우기)" noDelete={isStudent} />
      </div>

      {/* 숙제 코멘트 — 선생님 메모용. 학생에게는 숨기고(교사가 학생 페이지 열람 시에만 보임). */}
      {!isStudent && isMid && teacherHwComment.trim() && (
        <div className="sp-f">
          <span>숙제 코멘트</span>
          <div className="sp-teacher-comment">{teacherHwComment}</div>
        </div>
      )}

      {/* 시험 — 강사 화면과 동일한 UI(class_eng_test 공유). 학생이 입력한 시험이 강사 화면에도 똑같이 보여요. */}
      <DailyTests studentId={tid} date={date} />

      <div className="sp-f">
        <span>선생님께 (학습 내용 · 메모)</span>
        <textarea className="input" rows={3} value={studentNote} onChange={(e) => setStudentNote(e.target.value)} placeholder="오늘 배운 내용, 느낀 점, 선생님께 남길 말을 적어요." />
      </div>

      {/* 수업 코멘트 — 선생님 메모용. 학생에게는 숨기고(교사가 학생 페이지 열람 시에만 보임). */}
      {!isStudent && teacherComment.trim() && (
        <div className="sp-f">
          <span>수업 코멘트</span>
          <div className="sp-teacher-comment">{teacherComment}</div>
        </div>
      )}

      <div className="sp-log-save">
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? "저장 중…" : "지금 저장"}</button>
        <span className="sp-saved">{saving ? "저장 중…" : savedMsg || "입력하면 자동으로 저장돼요"}</span>
      </div>
    </div>
  );
}

/* ---------------- 일지 이력(월별) ---------------- */
/** 'YYYY-MM' → '2026년 6월'. */
function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}
function LogHistory({ rows, band }: { rows: StudentLogRow[]; band: string }) {
  const { user } = useAuth();
  const isStudent = user?.role === "student"; // 학생에겐 선생님 코멘트 숨김
  const isMid = band === "mid" || band === "bridge";
  // 데이터에 있는 월 목록(최신순).
  const months = Array.from(new Set(rows.map((r) => r.date.slice(0, 7)))).sort().reverse();
  const [month, setMonth] = useState<string>(months[0] || "");
  // 데이터가 바뀌어 선택 월이 사라지면 가장 최근 월로.
  useEffect(() => {
    if (months.length && !months.includes(month)) setMonth(months[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  if (!rows.length) return <div className="sp-muted">아직 작성한 일지가 없어요.</div>;

  const shown = rows.filter((r) => r.date.slice(0, 7) === month);

  return (
    <div>
      <div className="sp-months">
        {months.map((ym) => (
          <button key={ym} className={"sp-month" + (ym === month ? " on" : "")} onClick={() => setMonth(ym)}>
            {fmtMonth(ym)}
            <em>{rows.filter((r) => r.date.slice(0, 7) === ym).length}</em>
          </button>
        ))}
      </div>
      <div className="sp-hist">
        {shown.map((r) => (
          <div className="sp-hist-row" key={r.date}>
            <div className="sp-hist-date">
              <b>{fmtMDDow(r.date)}</b>
              {(r.startTime || r.endTime) && <span className="sp-hist-time">{r.startTime}{r.endTime ? `~${r.endTime}` : ""}</span>}
              {r.attStatus && <span className={"sp-att sp-att-" + (r.attStatus === "결석" ? "x" : r.attStatus === "지각" ? "l" : "o")}>{r.attStatus}</span>}
            </div>
            <div className="sp-hist-body">
              {r.bookNo && <span className="sp-tag">{isMid ? "교재" : "원서"} {r.bookNo}</span>}
              {isMid && r.bookNext && <span className="sp-tag">다음 {r.bookNext}</span>}
              {r.wordTest && <span className="sp-tag">단어 {r.wordTest}</span>}
              {isMid ? (
                <>
                  {r.hwWord && r.hwWord !== "없음" && <span className={"sp-tag " + hwTagCls(r.hwWord)}>단어숙제 {r.hwWord}</span>}
                  {r.hwReading && r.hwReading !== "없음" && <span className={"sp-tag " + hwTagCls(r.hwReading)}>리딩 {r.hwReading}</span>}
                  {r.hwGrammar && r.hwGrammar !== "없음" && <span className={"sp-tag " + hwTagCls(r.hwGrammar)}>문법 {r.hwGrammar}</span>}
                  {r.wrongCheck && <span className="sp-tag sp-tag-done">✓ 틀단확인</span>}
                </>
              ) : (
                r.doneItems.map((it) => (
                  <span className="sp-tag sp-tag-done" key={it}>✓ {it}</span>
                ))
              )}
            </div>
            {!isStudent && r.comment && <div className="sp-hist-note">{r.comment}</div>}
            {r.links && r.links.length > 0 && (
              <div className="sp-hist-links">
                {r.links.filter((l) => safeUrl(l.url)).map((l, i) => (
                  <a key={i} className="sp-link-btn sm" href={l.url} target="_blank" rel="noopener noreferrer"><Icon name="link" /><span>{l.name}</span></a>
                ))}
              </div>
            )}
          </div>
        ))}
        {!shown.length && <div className="sp-muted">이 달에 작성한 일지가 없어요.</div>}
      </div>
    </div>
  );
}

/* ---------------- 학생 본인 셸(로그인 후 첫 화면) ---------------- */
export function StudentHome() {
  const { user, logout } = useAuth();
  const [showIssue, setShowIssue] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [noticeUnseen, setNoticeUnseen] = useState(0);
  const [board, setBoard] = useState<MathBoard | null>(null); // 수학 전광판(수학생만)
  const [boardPhoto, setBoardPhoto] = useState(""); // 학생 사진(모달 헤더)
  const [boardRules, setBoardRules] = useState<BaseballRule[]>([]); // 상벌점 항목(선생님 수정 시 반영)
  const [boardCfg, setBoardCfg] = useState<BaseballConfig | undefined>(undefined);
  const [boardOpen, setBoardOpen] = useState(false);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null); // 하원 배너(오늘만)
  // 진입 과목 — 영수 둘 다 들으면 선택 화면(subject=null), 한 과목이면 바로 그 화면.
  const [subjects, setSubjects] = useState<string[] | null>(null);
  const [subject, setSubject] = useState<"math" | "english" | null>(null);
  useEffect(() => {
    let alive = true;
    studentApi.page()
      .then((d) => {
        if (!alive) return;
        const subs = d.subjects && d.subjects.length ? d.subjects : ["english"];
        setSubjects(subs);
        if (subs.length === 1) setSubject(subs[0] === "math" ? "math" : "english");
        // 둘 다면 subject는 null로 두어 선택 화면을 띄운다.
      })
      .catch(() => { if (alive) { setSubjects(["english"]); setSubject("english"); } });
    return () => { alive = false; };
  }, []);
  const logo = getCachedLogo();
  // 하원 배너 — 오늘 강사가 하원 누르면 상단에 계속 떠있고, 다음날이면 자동으로 사라짐(15초 폴링).
  useEffect(() => {
    let alive = true;
    const load = () => messageApi.checkoutToday().then((n) => { if (alive) setCheckoutNotice(n); }).catch(() => {});
    void load();
    const iv = window.setInterval(load, 15000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () => postApi.unseen().then((n) => { if (alive) setNoticeUnseen(n); }).catch(() => {});
    void load();
    const onSeen = () => void load();
    window.addEventListener("posts-seen", onSeen);
    return () => { alive = false; window.removeEventListener("posts-seen", onSeen); };
  }, []);
  // 본인 수학 전광판 — 선생님이 볼/출결 반영하면 학생 화면에 부드럽게 갱신(15초·focus).
  useEffect(() => {
    let alive = true;
    const load = () => baseballApi.board().then((r) => { if (alive) { setBoard(r.board); setBoardPhoto(r.photo || ""); setBoardRules(r.rules || []); setBoardCfg(r.cfg); } }).catch(() => {});
    void load();
    const iv = window.setInterval(load, 15000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);
  // 모달 ESC·뒤로가기로 닫기.
  useEffect(() => {
    if (!boardOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBoardOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boardOpen]);
  return (
    <div className="sp-shell">
      <header className="sp-shell-top">
        <div className="sp-shell-brand">
          {logo.url ? <img className="hub-logo logo-img" src={logo.url} alt="바꿈영수학원" /> : <span className="hub-logo logo-bee"><Bee size={34} /></span>}
          <div>
            <b className="sp-shell-name">바꿈영수학원 <SoezLogo size={18} className="sp-shell-soez" /></b>
            <span>{fmtFull(parseD(todayStr()))}</span>
          </div>
        </div>
        <div className="sp-shell-actions">
          <StudentMessages />
          {/* 수학 전광판 — 수학 수강생만. 공지사항 옆 상단에. */}
          {board && (
            <button className="bb-chip bb-chip-top" onClick={() => setBoardOpen(true)} aria-haspopup="dialog" title="수학 전광판">
              <span className="bb-chip-ic"><Icon name="baseball" /></span> <span className="sp-lbl">수학 전광판</span>
            </button>
          )}
          <button className="btn ghost sm" onClick={() => setShowGuide(true)} title="사용 안내"><Icon name="book" /> <span className="sp-lbl">사용 안내</span></button>
          <button className="btn ghost sm sp-notice-btn" onClick={() => setShowNotice(true)} title="공지사항">
            <Icon name="megaphone" /> <span className="sp-lbl">공지사항</span>
            {noticeUnseen > 0 && <span className="nav-badge new" style={{ minWidth: "auto", marginLeft: 4 }}>new {noticeUnseen}</span>}
          </button>
          <button className="btn ghost sm" onClick={() => setShowIssue(true)} title="오류 신고"><Icon name="alert" /> <span className="sp-lbl">오류 신고</span></button>
          <button className="btn ghost" onClick={() => logout()} title="로그아웃"><Icon name="logout" /> <span className="sp-lbl">로그아웃</span></button>
        </div>
      </header>
      <main className="sp-shell-body">
        {checkoutNotice && (
          <div className="sp-checkout-banner" role="status">
            <span className="sp-checkout-ic"><Icon name="check" /></span>
            <span className="sp-checkout-txt">{checkoutNotice}</span>
          </div>
        )}
        <NoticeBanner />
        {/* 영수 둘 다 들으면 과목 전환 칩 — 어느 화면에서든 바꿀 수 있게. */}
        {subjects && subjects.length > 1 && subject && (
          <div className="sp-subj-switch" role="tablist" aria-label="과목 전환">
            <button className={"tts-seg" + (subject === "english" ? " on" : "")} onClick={() => setSubject("english")}>
              <Icon name="book" /> 영어
            </button>
            <button className={"tts-seg" + (subject === "math" ? " on" : "")} onClick={() => setSubject("math")}>
              <Icon name="baseball" /> 수학
            </button>
          </div>
        )}
        {subjects === null ? (
          <SpSkeleton />
        ) : subject === null ? (
          <SubjectPicker onPick={setSubject} />
        ) : subject === "math" ? (
          <MathStudentPage />
        ) : (
          <StudentPage />
        )}
      </main>
      {user && <div className="sp-shell-foot">{user.name} 학생 · 본인 기록</div>}
      <footer className="maker-credit">제작자 EZ</footer>

      {/* 수학 전광판 모달 — X·바깥 여백·ESC로 닫고, 카드 안쪽은 안 닫힘 */}
      {boardOpen && board && (
        <div className="prof-overlay bb-overlay" onClick={() => setBoardOpen(false)} role="dialog" aria-modal="true" aria-label="수학 전광판">
          <div className="bb-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x bb-modal-x" onClick={() => setBoardOpen(false)} aria-label="닫기"><Icon name="x" /></button>
            <div className="bb-modal-head">
              <HexAvatar name={user?.name || ""} photo={boardPhoto} size={46} />
              <div>
                <p className="bb-modal-name">{user?.name}<span className="bb-name-round">{board.penaltyRounds + 1}회</span></p>
                <p className="bb-modal-sub">수학 전광판 · {board.monthLabel.replace("-", ".")}</p>
              </div>
            </div>
            <Scoreboard board={board} rules={boardRules} cfg={boardCfg} />
          </div>
        </div>
      )}

      {showIssue && (
        <div className="prof-overlay sp-overlay" onClick={() => setShowIssue(false)}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x sp-modal-x" onClick={() => setShowIssue(false)} aria-label="닫기">✕</button>
            <IssueBoard defaultPage="학생 화면" />
          </div>
        </div>
      )}

      {showGuide && (
        <div className="prof-overlay sp-overlay" onClick={() => setShowGuide(false)}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x sp-modal-x" onClick={() => setShowGuide(false)} aria-label="닫기">✕</button>
            <Guide forceRole="student" embedded />
          </div>
        </div>
      )}

      {showNotice && (
        <div className="prof-overlay sp-overlay" onClick={() => setShowNotice(false)}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x sp-modal-x" onClick={() => setShowNotice(false)} aria-label="닫기">✕</button>
            <Notices readOnly />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- 학생 메시지함 (종 + 배지 + 일시 강조 + 답장 1회) ---------------- */
function StudentMessages() {
  const [list, setList] = useState<Message[]>([]);
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState(false);
  const firstLoad = useRef(true);
  const lastTs = useRef(0); // 지금까지 본 가장 최신 메시지 시각
  const popupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashPopup = () => {
    setPopup(true);
    if (popupTimer.current) clearTimeout(popupTimer.current);
    popupTimer.current = setTimeout(() => setPopup(false), 6000);
  };
  const reload = () =>
    messageApi.inbox().then((msgs) => {
      setList(msgs);
      const newestAll = msgs.reduce((mx, m) => Math.max(mx, m.createdAt), 0);
      // 첫 로드에 안 읽은 게 있거나, 이전에 못 본 새 안읽음 메시지가 오면 강조 팝업.
      if (firstLoad.current) {
        firstLoad.current = false;
        if (msgs.some((m) => m.readAt === 0)) flashPopup();
      } else if (msgs.some((m) => m.readAt === 0 && m.createdAt > lastTs.current)) {
        flashPopup();
      }
      lastTs.current = Math.max(lastTs.current, newestAll);
    }).catch(() => {});
  useEffect(() => {
    void reload();
    // 새로고침 없이도 곧 보이도록 자주 확인(15초). 새 탭 포커스 시에도 즉시 갱신.
    const iv = window.setInterval(() => void reload(), 15000);
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(iv); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unread = list.filter((m) => m.readAt === 0).length;

  function openBox() { setOpen(true); setPopup(false); }
  async function markRead(m: Message) {
    if (m.readAt) return;
    setList((cur) => cur.map((x) => (x.id === m.id ? { ...x, readAt: Date.now() } : x)));
    await messageApi.read(m.id).catch(() => {});
  }
  async function reply(m: Message, text: string) {
    await messageApi.reply(m.id, text);
    setList((cur) => cur.map((x) => (x.id === m.id ? { ...x, replyBody: text, replyAt: Date.now(), readAt: x.readAt || Date.now() } : x)));
  }

  // 날짜별 묶음(최신 날짜 먼저).
  const groups = useMemo(() => {
    const m = new Map<string, Message[]>();
    for (const x of list) {
      const d = new Date(x.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const arr = m.get(key);
      if (arr) arr.push(x);
      else m.set(key, [x]);
    }
    return [...m.entries()];
  }, [list]);

  return (
    <>
      <button className="topbell" onClick={openBox} aria-label="메시지" title="메시지">
        <Icon name="bell" />
        {unread > 0 && <span className="topbell-badge">{unread}</span>}
      </button>
      {popup && (
        <button className="msg-pop" onClick={openBox}>
          <Icon name="bell" /> 선생님이 메시지를 보냈어요
        </button>
      )}
      {open && (
        <div className="prof-overlay sp-overlay" onClick={() => setOpen(false)}>
          <div className="sp-modal msg-inbox" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x sp-modal-x" onClick={() => setOpen(false)} aria-label="닫기">✕</button>
            <h2 className="msg-inbox-h">메시지함</h2>
            {list.length === 0 ? (
              <div className="hub-muted" style={{ padding: "20px 4px" }}>받은 메시지가 없어요.</div>
            ) : (
              groups.map(([day, msgs]) => (
                <div className="msg-day" key={day}>
                  <div className="msg-day-h">{fmtMDDow(day)}</div>
                  {msgs.map((m) => <StudentMsgCard key={m.id} m={m} onRead={() => markRead(m)} onReply={(t) => reply(m, t)} />)}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

function StudentMsgCard({ m, onRead, onReply }: { m: Message; onRead: () => void; onReply: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const replied = m.replyAt > 0;
  const unread = m.readAt === 0;
  async function doReply() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setErr("");
    try {
      await onReply(body);
      setText("");
    } catch {
      setErr("이미 답장했거나 보내지 못했어요.");
    } finally {
      setSending(false);
    }
  }
  return (
    <div className={"msg-card" + (unread ? " unread" : "")}>
      <div className="msg-card-top">
        {unread && <span className="msg-card-dot" />}
        <span className="msg-card-from">{m.senderName || "선생님"}</span>
        <span className="msg-card-when">{fmtWhen(m.createdAt)}</span>
      </div>
      <div className="msg-card-body">{m.body}</div>
      {replied ? (
        <div className="msg-card-replied"><span className="msg-card-replied-l">내 답장</span> {m.replyBody}</div>
      ) : (
        <div className="msg-card-reply">
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="답장 (한 번만 보낼 수 있어요)"
            onKeyDown={(e) => { if (e.key === "Enter") void doReply(); }}
          />
          <button className="btn primary sm" onClick={doReply} disabled={!text.trim() || sending}>{sending ? "보내는 중…" : "답장"}</button>
          {unread && <button className="btn ghost sm" onClick={onRead}>읽음</button>}
        </div>
      )}
      {err && <div className="auth-err" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}
