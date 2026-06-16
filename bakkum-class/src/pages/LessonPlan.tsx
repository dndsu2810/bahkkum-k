import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { useStore } from "../store";
import { Icon } from "../icons";
import { getConfig, setConfig } from "../lib/configApi";

// 연간 수업 계획표 — 원장 시트 구조를 앱 자체 표로. 분기→월 타임라인 × 항목(카테고리·세부).
// 저장은 class_config의 'math_year_plan' 키(JSON). 수학 강사·원장이 편집, 그 외 읽기.

const MONTHS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
const QUARTERS = [
  { label: "1분기", span: 3 },
  { label: "2분기", span: 3 },
  { label: "3분기", span: 3 },
  { label: "4분기", span: 3 },
];

interface PlanRow { cat: string; item: string }
const PLAN_ROWS: PlanRow[] = [
  { cat: "학기 진도", item: "예습" },
  { cat: "학기 진도", item: "복습" },
  { cat: "학기 진도", item: "고백클래스" },
  { cat: "시험대비", item: "중간고사" },
  { cat: "시험대비", item: "기말고사" },
  { cat: "KTC 수학경시대회", item: "수학경시대회" },
  { cat: "주간 테스트", item: "주간 테스트" },
  { cat: "주간 테스트", item: "월말 학습 리포트" },
  { cat: "특강", item: "서술형&문해력 특강" },
  { cat: "특강", item: "Game Day" },
  { cat: "학기 마무리", item: "문제집 마무리" },
  { cat: "학기 마무리", item: "학기 진도 마무리" },
  { cat: "학기 마무리", item: "다음 학기 준비" },
];
const key = (r: PlanRow, m: number) => `${r.cat}|${r.item}|${m}`;

// 시트 기본 내용(월 기준 요약) — 비어 보이지 않게 미리 채움. 원장이 자유롭게 수정.
const DEFAULT_CELLS: Record<string, string> = {
  "학기 진도|예습|0": "1학기 진도 예습(A)",
  "학기 진도|예습|6": "2학기 진도 예습(A)",
  "학기 진도|복습|2": "1학기 복습+연산(A)",
  "학기 진도|복습|8": "2학기 복습+연산(A)",
  "학기 진도|고백클래스|0": "30일/50일 수학(G)",
  "시험대비|중간고사|3": "1학기 중간고사(M1~H3)",
  "시험대비|중간고사|9": "2학기 중간고사(M1~H3)",
  "시험대비|기말고사|5": "1학기 기말고사(M1~H3)",
  "시험대비|기말고사|11": "2학기 기말고사(M1~H3)",
  "주간 테스트|주간 테스트|0": "매주 수·목 진행(A)",
  "주간 테스트|월말 학습 리포트|0": "1월(A)", "주간 테스트|월말 학습 리포트|1": "2월(A)", "주간 테스트|월말 학습 리포트|2": "3월(A)",
  "주간 테스트|월말 학습 리포트|3": "4월(A)", "주간 테스트|월말 학습 리포트|4": "5월(A)", "주간 테스트|월말 학습 리포트|5": "6월(A)",
  "주간 테스트|월말 학습 리포트|6": "7월(1학기 A)", "주간 테스트|월말 학습 리포트|7": "8월(A)", "주간 테스트|월말 학습 리포트|8": "9월(A)",
  "주간 테스트|월말 학습 리포트|9": "10월(A)", "주간 테스트|월말 학습 리포트|10": "11월(A)", "주간 테스트|월말 학습 리포트|11": "12월(2학기 A)",
  "특강|서술형&문해력 특강|4": "서술형&문해력 특강(E5~6)",
  "특강|Game Day|2": "3월(A)", "특강|Game Day|4": "5월(A)", "특강|Game Day|6": "7월(A)",
  "특강|Game Day|8": "9월(A)", "특강|Game Day|9": "10월(A)", "특강|Game Day|11": "12월(A)",
  "학기 마무리|문제집 마무리|5": "학기 마무리(호평초)",
  "학기 마무리|학기 진도 마무리|6": "학기 마무리(A)", "학기 마무리|학기 진도 마무리|11": "학기 마무리(A)",
};

// 칸 값: 일정명(n) + 상세설명(d). 구버전은 문자열(=일정명)만 저장됐으므로 호환 처리.
type CellRaw = string | { n: string; d: string };
const cellName = (v: CellRaw | undefined): string => (typeof v === "string" ? v : v?.n || "");
const cellDetail = (v: CellRaw | undefined): string => (typeof v === "string" ? "" : v?.d || "");

// 연도별 저장 키. 해당 연도 키가 없으면 구버전 단일 키(LEGACY_KEY)를 기본값으로 사용해
// 기존에 저장해 둔 계획이 사라지지 않게 한다(읽기 전용 fallback, 덮어쓰지 않음).
const LEGACY_KEY = "math_year_plan";
const yearKey = (y: number) => `${LEGACY_KEY}_${y}`;
function cellsFor(cfg: Record<string, string>, y: number): Record<string, CellRaw> {
  const raw = cfg[yearKey(y)] ?? cfg[LEGACY_KEY];
  if (raw) { try { return JSON.parse(raw); } catch { return DEFAULT_CELLS; } }
  return DEFAULT_CELLS;
}

// 칸 상세 입력 모달 — 일정명과 상세설명을 분리해 입력.
function PlanCellModal({ item, sub, name, detail, onSave }: { item: string; sub: string; name: string; detail: string; onSave: (n: string, d: string) => void }) {
  const { closeModal } = useStore();
  const [n, setN] = useState(name);
  const [d, setD] = useState(detail);
  return (
    <>
      <div className="modal-head">
        <div>
          <div className="modal-title">{item}</div>
          <div className="page-desc" style={{ marginTop: 2 }}>{sub}</div>
        </div>
        <button className="modal-x" onClick={closeModal} aria-label="닫기"><Icon name="x" /></button>
      </div>
      <div className="modal-body">
        <label className="plan-flabel">일정명</label>
        <input className="input" value={n} onChange={(e) => setN(e.target.value)} placeholder="예: 1학기 중간고사" autoFocus />
        <label className="plan-flabel" style={{ marginTop: 14 }}>상세설명 <span className="plan-flabel-opt">선택</span></label>
        <textarea className="input plan-cell-ta" value={d} onChange={(e) => setD(e.target.value)} rows={5} placeholder="범위·일정·준비물 등 자세한 내용 (줄바꿈 가능)" />
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={closeModal}>취소</button>
        <button className="btn primary" onClick={() => { onSave(n, d); closeModal(); }}>저장</button>
      </div>
    </>
  );
}

export function LessonPlan() {
  const { user } = useAuth();
  const { openModal } = useStore();
  // 연간 수업 계획은 수학 강사가 정하므로 수학 강사·원장 모두 편집 가능.
  const canEdit = user?.role === "admin" || user?.role === "math";
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth(); // 0~11

  const cfgRef = useRef<Record<string, string>>({});
  const [year, setYear] = useState(nowYear);
  const [cells, setCells] = useState<Record<string, CellRaw>>({});
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nowThRef = useRef<HTMLTableCellElement | null>(null);

  useEffect(() => {
    getConfig()
      .then((c) => { cfgRef.current = c; setCells(cellsFor(c, nowYear)); })
      .catch(() => setCells(DEFAULT_CELLS))
      .finally(() => setLoaded(true));
  }, [nowYear]);

  // 현재 연도를 보고 있을 때, 표를 열면 이번 달 칸이 보이도록 가로 스크롤.
  useEffect(() => {
    if (!loaded || year !== nowYear) return;
    const c = scrollRef.current, th = nowThRef.current;
    if (c && th) c.scrollLeft = Math.max(0, th.offsetLeft - c.clientWidth / 2 + th.clientWidth / 2);
  }, [loaded, year, nowYear]);

  function changeYear(delta: number) {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const ny = year + delta;
    setYear(ny);
    setCells(cellsFor(cfgRef.current, ny));
  }

  function scheduleSave(next: Record<string, CellRaw>) {
    const y = year;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const json = JSON.stringify(next);
      cfgRef.current = { ...cfgRef.current, [yearKey(y)]: json };
      void setConfig({ [yearKey(y)]: json }).then(() => setSavedAt("저장됨 " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }))).catch(() => setSavedAt("저장 실패"));
    }, 700);
  }
  // 칸을 눌러 일정명·상세설명 입력(모달). 저장 시 즉시 반영 + 자동 저장 예약.
  // 상세설명이 없으면 문자열(일정명)로 컴팩트 저장 → 구버전과 동일 포맷 유지.
  function editCell(k: string, name: string, detail: string) {
    const n = name.trim(), d = detail.trim();
    setCells((cur) => {
      const next = { ...cur };
      if (!n && !d) delete next[k];
      else if (!d) next[k] = n;
      else next[k] = { n, d };
      scheduleSave(next);
      return next;
    });
  }
  function openCell(k: string, r: PlanRow, m: number) {
    if (!canEdit) return;
    const cur = cells[k];
    openModal(<PlanCellModal item={r.item} sub={`${r.cat} · ${MONTHS[m]}`} name={cellName(cur)} detail={cellDetail(cur)} onSave={(n, d) => editCell(k, n, d)} />);
  }

  // 카테고리별 그룹(첫 행에 카테고리명 표시용)
  const catFirst = new Set<string>();
  const seen = new Set<string>();
  for (const r of PLAN_ROWS) { if (!seen.has(r.cat)) { seen.add(r.cat); catFirst.add(r.cat + "|" + r.item); } }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">수학 연간 수업 계획표</h1>
          <div className="page-desc">분기·월별 수업 계획을 한 곳에서. {canEdit ? "칸을 눌러 바로 입력하면 자동 저장돼요." : "수학 강사·원장이 작성한 연간 계획이에요."}</div>
        </div>
        <div className="head-actions plan-head-actions">
          {savedAt && <span className="page-desc">{savedAt}</span>}
          <div className="plan-yearnav">
            <button className="btn ghost sm" onClick={() => changeYear(-1)} aria-label="이전 연도">‹</button>
            <span className="plan-year">{year}년{year === nowYear && <span className="plan-year-now">올해</span>}</span>
            <button className="btn ghost sm" onClick={() => changeYear(1)} aria-label="다음 연도">›</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "auto" }} ref={scrollRef}>
        {!loaded ? (
          <div className="hub-muted" style={{ padding: 20 }}>불러오는 중…</div>
        ) : (
          <table className="plan-tbl">
            <thead>
              <tr>
                <th className="plan-cat-h" rowSpan={2}>항목</th>
                {QUARTERS.map((q, qi) => <th key={q.label} colSpan={q.span} className={"plan-q" + (qi > 0 ? " qstart" : "")}>{q.label}</th>)}
              </tr>
              <tr>
                {MONTHS.map((m, mi) => {
                  const isNow = year === nowYear && mi === nowMonth;
                  return (
                    <th
                      key={m}
                      ref={isNow ? nowThRef : undefined}
                      className={"plan-m" + (mi % 3 === 0 && mi > 0 ? " qstart" : "") + (isNow ? " now" : "")}
                    >
                      {m}
                      {isNow && <span className="plan-now-tag">이번 달</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {PLAN_ROWS.map((r) => {
                const isCatFirst = catFirst.has(r.cat + "|" + r.item);
                return (
                  <tr key={r.cat + "|" + r.item} className={isCatFirst ? "plan-catstart" : ""}>
                    <th className="plan-rowh">
                      {isCatFirst && <span className="plan-cat">{r.cat}</span>}
                      <span className="plan-item">{r.item}</span>
                    </th>
                    {MONTHS.map((_, m) => {
                      const k = key(r, m);
                      const v = cells[k];
                      const name = cellName(v);
                      const detail = cellDetail(v);
                      const has = !!(name || detail);
                      const isNow = year === nowYear && m === nowMonth;
                      return (
                        <td key={m} className={"plan-cell" + (has ? " filled" : "") + (m % 3 === 0 && m > 0 ? " qstart" : "") + (isNow ? " now" : "")}>
                          {canEdit ? (
                            <button type="button" className={"plan-cellbtn" + (has ? "" : " empty")} onClick={() => openCell(k, r, m)} title={detail || "눌러서 일정 입력"}>
                              {has ? (<>{name}{detail && <span className="plan-dot" aria-label="상세설명 있음" />}</>) : <Icon name="plus" />}
                            </button>
                          ) : (
                            <span className="plan-val" title={detail || undefined}>{name}{detail && <span className="plan-dot" aria-label="상세설명 있음" />}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
