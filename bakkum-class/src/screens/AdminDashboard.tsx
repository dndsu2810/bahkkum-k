import { useEffect, useMemo, useState } from "react";
import { adminApi, type AdminOverview, type StudentReport } from "../lib/adminApi";
import { todayStr, pad, fmtWhen } from "../lib/dates";
import { SkeletonCards } from "../components/Skeleton";

type AttFilter = "all" | "math" | "elem" | "mid";

const delta = (a: number, b: number) => {
  const d = a - b;
  if (d === 0) return { txt: "지난달과 동일", cls: "flat" };
  return d > 0 ? { txt: `지난달 대비 +${d}`, cls: "up" } : { txt: `지난달 대비 ${d}`, cls: "down" };
};

/** 원장 전용 대시보드 — 등록현황·증감·지각결석·특이사항 자동 집계 + 학생별 영수 종합. */
export function AdminDashboard() {
  const [ym, setYm] = useState(() => todayStr().slice(0, 7));
  const [ov, setOv] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [attF, setAttF] = useState<AttFilter>("all");

  useEffect(() => {
    setLoading(true);
    adminApi
      .overview(ym)
      .then((o) => { setOv(o); setErr(""); })
      .catch(() => setErr("불러오지 못했어요. 잠시 후 다시 시도해 주세요."))
      .finally(() => setLoading(false));
  }, [ym]);

  function shiftMonth(d: number) {
    const [y, m] = ym.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + d, 1));
    setYm(`${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`);
  }

  const students = ov?.students || [];
  const filtered = useMemo(() => {
    const kw = q.trim();
    return students.filter((s) => !kw || s.name.includes(kw) || (s.grade || "").includes(kw));
  }, [students, q]);

  const nd = ov ? delta(ov.newThis, ov.newLast) : null;

  return (
    <div className="sm-wrap">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">원장 대시보드</h1>
          <p className="sm-desc">강사들 기록이 자동으로 모여요. 등록 현황·지각결석·학생별 영수 종합을 한눈에.</p>
        </div>
        <div className="cal-nav" style={{ margin: 0 }}>
          <button className="btn ghost sm" onClick={() => shiftMonth(-1)}>‹</button>
          <div className="cal-month">{ym.replace("-", ". ")}</div>
          <button className="btn ghost sm" onClick={() => shiftMonth(1)}>›</button>
          <button className="btn ghost sm" onClick={() => setYm(todayStr().slice(0, 7))}>이번 달</button>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 12 }}>{err}</div>}
      {loading || !ov ? (
        <SkeletonCards n={4} />
      ) : (
        <>
          <div className="dash-kpis">
            <div className="kpi">
              <div className="kpi-v">{ov.summary.total}<span className="kpi-u">명</span></div>
              <div className="kpi-l">재원 학생</div>
              <div className="kpi-sub">수학 {ov.summary.math} · 영어 {ov.summary.eng}(초{ov.summary.elem}·중고{ov.summary.mid})</div>
            </div>
            <div className="kpi">
              <div className="kpi-v">{ov.newThis}<span className="kpi-u">명</span></div>
              <div className="kpi-l">이번 달 신규 등록</div>
              {nd && <div className={"kpi-delta " + nd.cls}>{nd.txt}</div>}
            </div>
            <div className="kpi">
              <div className="kpi-v" style={{ color: "var(--warn)" }}>{ov.late}<span className="kpi-u">건</span></div>
              <div className="kpi-l">이번 달 지각</div>
            </div>
            <div className="kpi">
              <div className="kpi-v" style={{ color: "var(--bad)" }}>{ov.absent}<span className="kpi-u">건</span></div>
              <div className="kpi-l">이번 달 결석</div>
            </div>
          </div>

          <div className="dash-grid">
            <section className="card dash-card">
              <h3 className="dash-h">지각·결석 현황</h3>
              <div className="sm-filters" style={{ marginBottom: 10 }}>
                {([["all", "전체"], ["math", "수학"], ["elem", "초등영어"], ["mid", "중고등영어"]] as [AttFilter, string][]).map(([k, label]) => (
                  <button key={k} className={"sm-fchip" + (attF === k ? " on" : "")} onClick={() => setAttF(k)}>{label}</button>
                ))}
              </div>
              {(() => {
                const pick = (p: AdminOverview["perStudent"][number]) =>
                  attF === "all"
                    ? { late: p.math.late + p.elem.late + p.mid.late, absent: p.math.absent + p.elem.absent + p.mid.absent }
                    : p[attF];
                const rows = ov.perStudent
                  .map((p) => ({ p, v: pick(p) }))
                  .filter((x) => x.v.late > 0 || x.v.absent > 0)
                  .sort((a, b) => b.v.late + b.v.absent - (a.v.late + a.v.absent));
                if (rows.length === 0) return <div className="hub-muted">이번 달 지각·결석 기록이 없어요.</div>;
                return (
                  <div className="dash-rows">
                    {rows.map(({ p, v }) => (
                      <button className="dash-row" key={p.id} onClick={() => setOpenId(p.id)}>
                        <span className="dash-row-nm">{p.name}</span>
                        <span className="dash-row-tags">
                          {v.late > 0 && <span className="dash-tag late">지각 {v.late}</span>}
                          {v.absent > 0 && <span className="dash-tag absent">결석 {v.absent}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </section>

            <section className="card dash-card">
              <h3 className="dash-h">최근 특이사항</h3>
              {ov.notes.length === 0 ? (
                <div className="hub-muted">특이사항이 없어요.</div>
              ) : (
                <div className="dash-notes">
                  {ov.notes.map((n, i) => (
                    <div className="dash-note" key={i}>
                      <div className="dash-note-h">
                        <b>{n.studentName || "—"}</b>
                        <span className="hub-muted">{n.author} · {fmtWhen(n.createdAt)}</span>
                      </div>
                      <div className="dash-note-b">{n.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="card dash-card" style={{ marginTop: 16 }}>
            <h3 className="dash-h">학생별 영수 종합</h3>
            <p className="hub-muted" style={{ marginBottom: 10 }}>학생을 누르면 이번 달 수학·영어 기록과 특이사항을 한데 모아 봅니다.</p>
            <input className="input sm-search" style={{ marginBottom: 10 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·학년 검색" />
            <div className="dash-stu-grid">
              {filtered.map((s) => (
                <button className="dash-stu" key={s.id} onClick={() => setOpenId(s.id)}>
                  <span className="dash-stu-nm">{s.name}</span>
                  <span className="dash-stu-meta">{s.grade || "—"} · {[s.subjects.includes("math") ? "수학" : "", s.subjects.includes("english") ? "영어" : ""].filter(Boolean).join("·") || "—"}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {openId && <StudentReportModal id={openId} month={ym} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/* ---------------- 학생 개별 영수 종합 ---------------- */
function StudentReportModal({ id, month, onClose }: { id: string; month: string; onClose: () => void }) {
  const [rep, setRep] = useState<StudentReport | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    adminApi.student(id, month).then(setRep).catch(() => setErr("불러오지 못했어요."));
  }, [id, month]);

  return (
    <div className="prof-overlay" onClick={onClose}>
      <div className="prof" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="prof-top">
          <div className="prof-top-main">
            <div className="prof-name">{rep?.student?.name || "학생"} · 영수 종합</div>
            <div className="hub-muted">{month.replace("-", ". ")} {rep?.student ? `· ${rep.student.grade || ""} ${rep.student.school || ""}` : ""}</div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="prof-body">
          {err && <div className="auth-err">{err}</div>}
          {!rep ? (
            <div className="hub-muted">불러오는 중…</div>
          ) : (
            <>
              {rep.student?.subjects.includes("math") && (
                <section className="rep-sec">
                  <h4 className="rep-h">수학</h4>
                  <div className="rep-stats">
                    <span className="rep-stat">출석 {rep.math.present}</span>
                    <span className="rep-stat warn">지각 {rep.math.late}</span>
                    <span className="rep-stat bad">결석 {rep.math.absent}</span>
                    <span className="rep-stat">숙제 {rep.math.homework}건</span>
                  </div>
                  {rep.math.tests.length > 0 && (
                    <div className="rep-list">
                      {rep.math.tests.map((t, i) => <div className="rep-li" key={i}><span>{t.date} {t.type}</span><b>{t.score}점 <span className="hub-muted">{t.status}</span></b></div>)}
                    </div>
                  )}
                  {rep.math.progress.length > 0 && (
                    <div className="rep-list">
                      {rep.math.progress.map((p, i) => <div className="rep-li" key={i}><span>{p.date} {p.unit} {p.area}</span><b>{p.pct}%</b></div>)}
                    </div>
                  )}
                </section>
              )}
              {rep.student?.subjects.includes("english") && (
                <section className="rep-sec">
                  <h4 className="rep-h">영어</h4>
                  <div className="rep-stats">
                    <span className="rep-stat">출석 {rep.english.attended}일</span>
                    {rep.english.late > 0 && <span className="rep-stat warn">지각 {rep.english.late}</span>}
                    {rep.english.absent > 0 && <span className="rep-stat bad">결석 {rep.english.absent}</span>}
                    <span className="rep-stat">숙제검사 {rep.english.hwChecked}회</span>
                    <span className="rep-stat">포인트 {rep.english.points}점</span>
                  </div>
                  {rep.english.tests.length > 0 && (
                    <div className="rep-list">
                      {rep.english.tests.map((t, i) => <div className="rep-li" key={i}><span>{t.date} {t.name}</span><b>{t.score} / {t.total}</b></div>)}
                    </div>
                  )}
                  {rep.english.progress.length > 0 && (
                    <div className="rep-list">
                      {rep.english.progress.map((p, i) => <div className="rep-li" key={i}><span>{p.book} {p.level}</span><b>{p.status}</b></div>)}
                    </div>
                  )}
                  {rep.english.comments.length > 0 && (
                    <div className="rep-list">
                      {rep.english.comments.map((c, i) => <div className="rep-li col" key={i}><span className="hub-muted">{c.date}</span>{c.comment}</div>)}
                    </div>
                  )}
                </section>
              )}
              <section className="rep-sec">
                <h4 className="rep-h">특이사항</h4>
                {rep.notes.length === 0 ? (
                  <div className="hub-muted">없음</div>
                ) : (
                  <div className="rep-list">
                    {rep.notes.map((n, i) => <div className="rep-li col" key={i}><span className="hub-muted">{n.author} · {fmtWhen(n.createdAt)}</span>{n.body}</div>)}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
        <div className="prof-foot">
          <button className="btn ghost" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
