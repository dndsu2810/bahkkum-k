import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { getConfig, setConfig } from "../lib/configApi";

// 연간 수업 계획표 — 원장 시트 구조를 앱 자체 표로. 분기→월 타임라인 × 항목(카테고리·세부).
// 저장은 class_config의 'math_year_plan' 키(JSON). 원장만 편집, 그 외 읽기.

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

export function LessonPlan() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const [cells, setCells] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getConfig()
      .then((c) => {
        const raw = c.math_year_plan;
        if (raw) { try { setCells(JSON.parse(raw)); } catch { setCells(DEFAULT_CELLS); } }
        else setCells(DEFAULT_CELLS);
      })
      .catch(() => setCells(DEFAULT_CELLS))
      .finally(() => setLoaded(true));
  }, []);

  function edit(k: string, v: string) {
    setCells((cur) => {
      const next = { ...cur };
      if (v.trim()) next[k] = v; else delete next[k];
      return next;
    });
  }
  function scheduleSave(next: Record<string, string>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void setConfig({ math_year_plan: JSON.stringify(next) }).then(() => setSavedAt("저장됨 " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }))).catch(() => setSavedAt("저장 실패"));
    }, 700);
  }
  function onBlurCell() {
    // 최신 cells로 저장 예약 (setCells가 비동기라 다음 틱에 읽기 위해 함수형 사용)
    setCells((cur) => { scheduleSave(cur); return cur; });
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
          <div className="page-desc">분기·월별 수업 계획을 한 곳에서. {canEdit ? "칸을 눌러 바로 입력하면 자동 저장돼요." : "원장이 작성한 연간 계획이에요."}</div>
        </div>
        {savedAt && <div className="head-actions"><span className="page-desc">{savedAt}</span></div>}
      </div>

      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        {!loaded ? (
          <div className="hub-muted" style={{ padding: 20 }}>불러오는 중…</div>
        ) : (
          <table className="plan-tbl">
            <thead>
              <tr>
                <th className="plan-cat-h" rowSpan={2}>항목</th>
                {QUARTERS.map((q) => <th key={q.label} colSpan={q.span} className="plan-q">{q.label}</th>)}
              </tr>
              <tr>
                {MONTHS.map((m) => <th key={m} className="plan-m">{m}</th>)}
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
                      const v = cells[k] || "";
                      return (
                        <td key={m} className={"plan-cell" + (v ? " filled" : "")}>
                          {canEdit ? (
                            <input
                              className="plan-input"
                              value={v}
                              onChange={(e) => edit(k, e.target.value)}
                              onBlur={onBlurCell}
                              title={v}
                            />
                          ) : (
                            <span className="plan-val" title={v}>{v}</span>
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
