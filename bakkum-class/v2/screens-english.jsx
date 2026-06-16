/* global React, ScreenShell, Icon, Avatar, Check, Pin, Field, Card, MiniBar */
// ============================================================
// 영어 화면: 일일기록(학습일지) ⭐ · 영어 대시보드
//  - 수학 복제 금지: 인센티브 제거 · 테스트=단어시험 · 출결=등원선택 · 초등/중고등 분리
// ============================================================
window.SCREENS = window.SCREENS || {};
const E = React.createElement;
const { useState: useS } = React;

const EN_STUDENTS = {
  "중고등": [
    ["최서아", "영재고 1", true], ["박하린", "한빛중 3", true], ["오지안", "바꿈중 1", true],
    ["이준호", "바꿈중 2", false], ["한예린", "성일고 2", true], ["윤지호", "대성고 1", false],
  ],
  "초등": [
    ["김도윤", "바꿈초 5", true], ["정시우", "바꿈초 3", true], ["강하은", "한솔초 4", false],
    ["문서준", "바꿈초 6", true], ["배아윤", "바꿈초 2", false],
  ],
};

// ============================================================
// 영어 일일기록 (학습일지)
// ============================================================
function English({ device, go, ctx = "english" }) {
  const [grade, setGrade] = useS("중고등");
  const [sel, setSel] = useS(0);
  const [goals, setGoals] = useS({ 0: true, 1: true, 2: false });
  const [hwState, setHwState] = useS("완료");
  const list = EN_STUDENTS[grade];
  const cur = list[sel] || list[0];

  const gradeToggle = E("div", { className: "rel" },
    E("div", { className: "seg", style: { display: "inline-flex", background: "var(--surface-2)", borderColor: "var(--line)" } },
      ["초등", "중고등"].map(g =>
        E("button", { key: g, className: g === grade ? "on" : "", style: { padding: "0 16px", height: 30, color: g === grade ? "#fff" : "var(--ink-2)", background: g === grade ? (g === "중고등" ? "var(--accent-2)" : "var(--accent)") : undefined },
          onClick: () => { setGrade(g); setSel(0); } }, g, " 영어"))),
    E(Pin, { n: 2, x: "auto", y: -8, r: -6 }));

  // 등원 학생 선택 패널
  const attendList = E("div", { className: "rel", style: { height: "100%" } },
    E(Card, { title: "오늘 등원 학생", cls: "col", style: { height: "100%", padding: 14 },
      action: E("span", { className: "t-xs w-faint fw6" }, list.filter(s => s[2]).length, " / ", list.length, " 등원") },
      E("div", { className: "col", style: { gap: 4, overflowY: "auto" } },
        list.map(([nm, sch, here], i) =>
          E("div", { key: i, className: "row gap", onClick: () => setSel(i),
            style: { padding: "9px 10px", borderRadius: 10, cursor: "pointer", gap: 10,
              background: i === sel ? "var(--accent-soft)" : "transparent", border: i === sel ? "1px solid var(--accent)" : "1px solid transparent" } },
            E(Check, { on: here }),
            E(Avatar, { size: 32, label: nm[0] }),
            E("div", { className: "grow col", style: { gap: 1 } },
              E("strong", { style: { fontSize: 13, color: i === sel ? "var(--accent)" : "var(--ink)" } }, nm),
              E("span", { className: "t-xs w-faint" }, sch)),
            here ? E("span", { className: "w-dot ok" }) : E("span", { className: "t-xs w-faint" }, "미등원"))))),
    E(Pin, { n: 3, x: "auto", y: 14 }));

  // 일일기록 폼
  const goalItems = ["오늘 단어 30개 암기", "본문 1차 해석 완료", "Grammar Unit 4 풀이"];
  const logForm = E("div", { className: "col gap2", style: { height: "100%", overflowY: device === "mobile" ? "visible" : "auto", paddingRight: device === "mobile" ? 0 : 2 } },
    // 학생 헤더
    E("div", { className: "row gap2 between wrap" },
      E("div", { className: "row gap" }, E(Avatar, { size: 40, label: cur[0][0] }),
        E("div", { className: "col" }, E("strong", { style: { fontSize: 16 } }, cur[0]),
          E("span", { className: "t-xs w-faint" }, cur[1], " · ", grade, " 영어"))),
      E("span", { className: "w-badge ok" }, E("span", { className: "w-dot ok" }), "오늘 등원")),
    // 진도/커리
    E("div", { className: "rel" },
      E(Card, { title: "진도 · 커리큘럼", cls: "pad-sm" },
        E("div", { className: "grid g2", style: { gap: 10 } },
          E(Field, { label: "교재명 (자유 입력)", placeholder: grade === "초등" ? "Core Phonics 4" : "Insight Link L1" }),
          E(Field, { label: "레벨 / 범위", placeholder: grade === "초등" ? "Unit 7 · p.20-25" : "Unit 4 · 모의고사 3회" }))),
      E(Pin, { n: 4, x: "auto", y: -8 })),
    // 학습 목표 체크
    E(Card, { title: "학습 목표", cls: "pad-sm", action: E("span", { className: "t-xs w-faint fw6" }, Object.values(goals).filter(Boolean).length, " / ", goalItems.length, " 달성") },
      E("div", { className: "col", style: { gap: 4 } },
        goalItems.map((g, i) =>
          E("div", { key: i, className: "row gap", style: { padding: "7px 6px", borderRadius: 8, cursor: "pointer", background: goals[i] ? "var(--ok-soft)" : "transparent" },
            onClick: () => setGoals(p => ({ ...p, [i]: !p[i] })) },
            E(Check, { on: !!goals[i] }),
            E("span", { className: "t-sm", style: { textDecoration: goals[i] ? "none" : "none", color: goals[i] ? "var(--ink)" : "var(--ink-2)" } }, g))))),
    // 숙제 + 숙제검사
    E("div", { className: "grid g2", style: { gap: 12 } },
      E(Card, { title: "숙제 (자유 입력)", cls: "pad-sm" },
        E("textarea", { className: "w-textarea", readOnly: true, placeholder: "예) 워크북 p.30-33 / 단어 Day 12 암기 / 본문 받아쓰기" })),
      E("div", { className: "rel" },
        E(Card, { title: "숙제 검사", cls: "pad-sm col gap2" },
          E("div", { className: "row gap", style: { gap: 6 } },
            ["완료", "미흡", "미제출"].map(s =>
              E("span", { key: s, className: "w-chip" + (hwState === s ? " on" : ""), onClick: () => setHwState(s),
                style: hwState === s && s !== "완료" ? { background: s === "미흡" ? "var(--warn)" : "var(--bad)", borderColor: "transparent" } : null }, s))),
          E("input", { className: "w-input", readOnly: true, placeholder: "검사 메모 (선택)" })),
        E(Pin, { n: 1, x: "auto", y: -8 }))),
    // 단어시험 + 코멘트
    E("div", { className: "grid g2", style: { gap: 12 } },
      E("div", { className: "rel" },
        E(Card, { title: "단어 시험", cls: "pad-sm" },
          E("div", { className: "row gap", style: { gap: 10, alignItems: "flex-end" } },
            E(Field, { label: "점수", placeholder: "18", grow: false }),
            E("span", { className: "fw7", style: { paddingBottom: 10, color: "var(--ink-3)" } }, "/ 20"),
            E(Field, { label: "비고", placeholder: "오답 단어 재시험" }))),
        E(Pin, { n: 5, x: "auto", y: -8 })),
      E(Card, { title: "코멘트", cls: "pad-sm" },
        E("textarea", { className: "w-textarea", readOnly: true, placeholder: "수업 태도 · 특이사항 · 학부모 전달 사항" }))),
    // 자료 배부
    E(Card, { title: "자료 배부", cls: "pad-sm" },
      E("div", { className: "row gap wrap", style: { gap: 8 } },
        E("div", { className: "w-dashed", style: { flex: 1, minWidth: 200, height: 64, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--ink-3)", fontSize: 12 } },
          E(Icon, { name: "download", size: 16 }), "파일 드래그 · 링크 첨부 (학습지/음원)"),
        E("div", { className: "col gap", style: { gap: 6 } },
          E("span", { className: "w-chip" }, E(Icon, { name: "link", size: 13 }), "Day12_단어장.pdf"),
          E("span", { className: "w-chip" }, E(Icon, { name: "link", size: 13 }), "본문_음원.mp3")))),
    // 저장
    E("div", { className: "row gap", style: { gap: 8, paddingBottom: 4 } },
      E("button", { className: "w-btn pri grow", onClick: () => showToast(cur[0] + " · 일일기록 저장됨", { undo: true }) }, E(Icon, { name: "check", size: 16 }), "일일기록 저장 (앱 자체 저장)"),
      E("button", { className: "w-btn", onClick: () => showToast("임시 저장됨", {}) }, "임시 저장")));

  if (device === "mobile") {
    return E(ScreenShell, { ctx, active: "english", title: "오늘 일일기록", device, go },
      E("div", { className: "col gap2" },
        E("div", { className: "row between" }, gradeToggle, E("span", { className: "t-sm w-faint fw6" }, "6/12")),
        // 등원 학생 가로 선택
        E("div", { className: "rel" },
          E("div", { className: "row gap", style: { gap: 8, overflowX: "auto", paddingBottom: 4 } },
            list.map(([nm, , here], i) =>
              E("div", { key: i, onClick: () => setSel(i), className: "col center", style: { flex: "none", gap: 4, cursor: "pointer", opacity: here ? 1 : .45 } },
                E("div", { style: { position: "relative" } },
                  E(Avatar, { size: 46, label: nm[0], cls: i === sel ? "" : "" }),
                  i === sel ? E("span", { style: { position: "absolute", inset: -3, border: "2px solid var(--accent)", borderRadius: 999 } }) : null,
                  here ? E("span", { className: "w-dot ok", style: { position: "absolute", right: 0, bottom: 0, border: "2px solid var(--surface)", width: 12, height: 12 } }) : null),
                E("span", { className: "t-xs fw6" }, nm)))),
          E(Pin, { n: 3, x: "auto", y: -6 })),
        E("div", { className: "w-hr" }),
        logForm));
  }
  return E(ScreenShell, { ctx, active: "english", title: "영어 일일기록", device, go,
    actions: E("div", { className: "row gap" }, gradeToggle, E(DateNav, { label: "6.12 (금)" })) },
    E("div", { style: { display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, height: "100%" } },
      attendList, logForm));
}
English.notes = [
  { n: 1, t: "<b>학습일지 방식:</b> 학습목표(체크)·숙제(자유입력)·숙제검사·코멘트·자료배부를 한 화면에서. 영어는 <b>앱(허브) 자체 저장</b> — 노션 별도 저장 안 함." },
  { n: 2, t: "<b>초등 / 중고등 분리:</b> 학년 구분 + 강사도 분리 담당. 토글로 담당 학년만 표시." },
  { n: 3, t: "<b>출결 = 등원 선택 중심:</b> 수학(시간표 기반 출석/지각/결석)과 달리 '오늘 등원한 학생을 선택'하는 학습일지 방식." },
  { n: 4, t: "<b>진도/커리:</b> 교재명+레벨 자유 입력 (예: Core Phonics 4 / Insight Link L1 / 모의고사)." },
  { n: 5, t: "<b>테스트 성격 다름:</b> 단어시험 점수 등 영어식 평가. 수학의 경시·랭킹식 아님. 그리고 영어 대시보드에는 <b>인센티브 정산·규칙 없음.</b>" },
];
window.SCREENS.english = English;

// ============================================================
// 영어 대시보드 (인센티브 없음 — 등원/진도/숙제 현황 위주)
// ============================================================
function EnglishDash({ device, go, ctx = "english" }) {
  const rows = [
    ["중고등 A반", "12", "9", "82%", "75%"],
    ["중고등 B반", "10", "7", "70%", "60%"],
    ["초등 1반", "11", "9", "90%", "85%"],
    ["초등 2반", "9", "6", "78%", "55%"],
  ];
  return E(ScreenShell, { ctx, active: "english-dash", title: "영어 현황", device, go,
    actions: E("button", { className: "w-btn pri sm", onClick: () => go("english") }, E(Icon, { name: "star", size: 15 }), "일일기록") },
    E("div", { className: "col gap2" },
      E("div", { className: "row between wrap", style: { gap: 10 } },
        E("h2", { className: "w-h1" }, "영어 현황"),
        E("div", { className: "rel" },
          E("div", { className: "row gap" }, ["전체", "초등", "중고등"].map((t, i) => E("span", { key: t, className: "w-chip" + (i === 0 ? " on" : "") }, t))),
          E(Pin, { n: 1, x: "auto", y: -28 }))),
      E("div", { className: "grid " + (device === "mobile" ? "g2" : "g4") },
        [["오늘 등원", "38 / 54", "ok"], ["일일기록 입력", "47 / 54", "info"], ["숙제 검사율", "52%", "warn"], ["진도 입력", "87%", "info"]].map(([l, v, tone], i) =>
          E("div", { key: i, className: "stat" },
            E("span", { className: `w-dot ${tone}` }),
            E("div", { className: "num", style: { marginTop: 8, fontSize: 22 } }, v),
            E("div", { className: "lbl" }, l)))),
      E("div", { className: "grid", style: { gridTemplateColumns: device === "mobile" ? "1fr" : "1fr 1fr" } },
        E(Card, { title: "반별 현황" },
          E("table", { className: "w-table" },
            E("thead", null, E("tr", null, ["반", "등원", "기록", "숙제", "진도"].map((th, i) => E("th", { key: i }, th)))),
            E("tbody", null, rows.map(([cls, att, rec, hw, prog], i) =>
              E("tr", { key: i },
                E("td", { className: "fw7" }, cls),
                E("td", { className: "tnum w-muted" }, att),
                E("td", { className: "tnum w-muted" }, rec),
                E("td", null, E("span", { className: "w-badge " + (parseInt(hw) >= 80 ? "ok" : "warn") }, hw)),
                E("td", { className: "tnum w-muted" }, prog))))),
          ),
        E("div", { className: "rel" },
          E(Card, { title: "주의가 필요한 학생", action: E("span", { className: "t-xs", style: { color: "var(--accent)", fontWeight: 600, cursor: "pointer" }, onClick: () => go("notes") }, "특이사항") },
            E("div", { className: "col" },
              [["박하린", "숙제 2회 미흡 · 단어 14/20", "warn"], ["정시우", "3일 연속 미등원", "bad"], ["강하은", "진도 지연 (Unit 2)", "warn"]].map(([nm, tx, tone], i) =>
                E("div", { key: i, className: "lrow" },
                  E(Avatar, { size: 34, label: nm[0] }),
                  E("div", { className: "grow col", style: { gap: 1 } }, E("strong", { style: { fontSize: 13 } }, nm), E("span", { className: "t-xs w-faint" }, tx)),
                  E("span", { className: `w-dot ${tone}` }))))),
          E(Pin, { n: 2, x: "auto", y: 14 }))),
      E("div", { className: "w-dashed", style: { height: 56, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: 12, gap: 6 } },
        E(Icon, { name: "report", size: 15 }), "주간 등원·진도 추이 그래프 (영역)")));
}
EnglishDash.notes = [
  { n: 1, t: "<b>인센티브 없음:</b> 수학 대시보드의 인센티브 정산·규칙은 영어에서 전부 제외. 등원/진도/숙제 현황 위주로만 구성." },
  { n: 2, t: "<b>운영 보조:</b> 주의가 필요한 학생은 특이사항(공유 누적)과 연결되어 모든 역할이 함께 관찰." },
];
window.SCREENS["english-dash"] = EnglishDash;
