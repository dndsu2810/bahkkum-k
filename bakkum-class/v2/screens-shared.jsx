/* global React, ScreenShell, Icon, Avatar, Pin, StatusBadge, Card, Field */
// ============================================================
// 공유 화면: 강사 특이사항 · 업무보드(칸반) · 데스크쌤 · 매뉴얼 위키
// ============================================================
window.SCREENS = window.SCREENS || {};
const S = React.createElement;
const { useState: uS } = React;

// ============================================================
// 강사 특이사항 (공용 누적)
// ============================================================
function Notes({ device, go, ctx = "admin" }) {
  const students = [
    ["박하린", "수학·영어", 6, "warn"], ["최서아", "수학·영어", 4, "info"], ["이준호", "수학", 3, "bad"],
    ["정시우", "영어", 2, "warn"], ["오지안", "수학·영어", 1, "neutral"], ["한예린", "수학", 1, "neutral"],
  ];
  const [sel, setSel] = uS(0);
  const timeline = [
    ["이서연", "영어", "2시간 전", "숙제 2회 연속 미흡. 단어시험도 14/20. 학부모 상담 필요해 보입니다."],
    ["김지현", "수학", "어제 18:20", "도형 단원 많이 어려워함. 보충 자료 배부하고 다음주 재점검 예정."],
    ["정유진", "데스크", "3일 전", "학부모님 전화 — 6/15(토) 오후 4시 상담 예약 잡았습니다."],
    ["이서연", "영어", "1주 전", "수업 태도 매우 좋아짐. 발표 적극적."],
  ];
  const studentList = S("div", { className: "rel", style: { height: "100%" } },
    S(Card, { title: "학생 선택", cls: "col", style: { height: "100%", padding: 14 } },
      S("div", { className: "w-search", style: { marginBottom: 10 } }, S(Icon, { name: "search", size: 15 }), S("input", { placeholder: "학생 검색", readOnly: true })),
      S("div", { className: "col", style: { gap: 3, overflowY: "auto" } },
        students.map(([nm, subj, cnt, tone], i) =>
          S("div", { key: i, className: "row gap", onClick: () => setSel(i),
            style: { padding: "9px 10px", borderRadius: 10, cursor: "pointer", background: i === sel ? "var(--accent-soft)" : "transparent" } },
            S(Avatar, { size: 32, label: nm[0] }),
            S("div", { className: "grow col", style: { gap: 1 } },
              S("strong", { style: { fontSize: 13, color: i === sel ? "var(--accent)" : "var(--ink)" } }, nm),
              S("span", { className: "t-xs w-faint" }, subj)),
            S("span", { className: `w-badge ${tone}`, style: { minWidth: 22, justifyContent: "center" } }, cnt))))),
    S(Pin, { n: 1, x: "auto", y: 14 }));

  const thread = S("div", { className: "col gap2", style: { height: "100%" } },
    S("div", { className: "row between" },
      S("div", { className: "row gap" }, S(Avatar, { size: 40, label: students[sel][0][0] }),
        S("div", { className: "col" }, S("strong", { style: { fontSize: 16 } }, students[sel][0]),
          S("span", { className: "t-xs w-faint" }, "특이사항 ", students[sel][2], "건 누적 · 과목 공통"))),
      S("span", { className: "w-badge neutral" }, S(Icon, { name: "eye", size: 12 }), "전원 열람")),
    // 입력
    S("div", { className: "rel" },
      S("div", { className: "w-card pad-sm col gap" },
        S("textarea", { className: "w-textarea", readOnly: true, placeholder: "특이사항 기록 (누가·언제·무엇이 자동 기록됩니다)" }),
        S("div", { className: "row between" },
          S("div", { className: "row gap", style: { gap: 6 } }, ["수학", "영어", "생활", "학부모"].map(t => S("span", { key: t, className: "w-chip sm" }, t))),
          S("button", { className: "w-btn pri sm" }, S(Icon, { name: "plus", size: 14 }), "기록 추가"))),
      S(Pin, { n: 2, x: "auto", y: -8 })),
    // 타임라인
    S("div", { className: "rel grow", style: { overflowY: "auto" } },
      S(Card, { title: "기록 (시간순 누적)", cls: "" },
        S("div", { className: "tl", style: { marginTop: 4 } },
          timeline.map(([who, subj, when, tx], i) =>
            S("div", { key: i, className: "tl-item" },
              S("div", { className: "row gap wrap", style: { gap: 6 } },
                S("strong", { style: { fontSize: 13 } }, who),
                S("span", { className: "w-chip sm" }, subj),
                S("span", { className: "t-xs w-faint" }, when)),
              S("p", { className: "t-sm w-muted", style: { margin: "4px 0 0", lineHeight: 1.55 } }, tx))))),
      S(Pin, { n: 3, x: "auto", y: 14 })));

  if (device === "mobile") {
    return S(ScreenShell, { ctx, active: "notes", title: "특이사항", device, go },
      S("div", { className: "col gap2" },
        S("div", { className: "row gap", style: { gap: 8, overflowX: "auto", paddingBottom: 4 } },
          students.map(([nm, , cnt, tone], i) =>
            S("div", { key: i, onClick: () => setSel(i), className: "col center", style: { flex: "none", gap: 4, cursor: "pointer" } },
              S("div", { style: { position: "relative" } }, S(Avatar, { size: 46, label: nm[0] }),
                S("span", { className: `w-badge ${tone}`, style: { position: "absolute", top: -4, right: -6, padding: "0 6px", minWidth: 18, height: 18, justifyContent: "center" } }, cnt),
                i === sel ? S("span", { style: { position: "absolute", inset: -3, border: "2px solid var(--accent)", borderRadius: 999 } }) : null),
              S("span", { className: "t-xs fw6" }, nm))),
          ),
        thread));
  }
  return S(ScreenShell, { ctx, active: "notes", title: "강사 특이사항", device, go },
    S("div", { style: { display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, height: "100%" } }, studentList, thread));
}
Notes.notes = [
  { n: 1, t: "<b>학생별 모아 보기:</b> 어떤 강사가 남긴 특이사항이든 학생 단위로 모아 봄. 과목 공통(수학·영어 구분 없음)." },
  { n: 2, t: "<b>누적 기록:</b> 누가·언제·무엇이 자동 기록. 기록은 <b>사라지지 않고 계속 쌓임</b>(수정·삭제 대신 누적)." },
  { n: 3, t: "<b>전원 공유·열람:</b> 원장이 전반을 관찰할 수 있도록 모든 강사·데스크가 함께 보고, 시간순으로 정렬." },
];
window.SCREENS.notes = Notes;

// ============================================================
// 공유 업무보드 (칸반 · 실시간)
// ============================================================
function Board({ device, go, ctx = "admin" }) {
  const initial = {
    todo: [
      { id: "t1", title: "박하린 학부모 상담 준비", by: "이서연", tag: "영어", auto: false },
      { id: "t2", title: "6월 단어시험지 인쇄", by: "박민호", tag: "초등영어", auto: false },
      { id: "t5", title: "정시우 보강 일정 잡기", by: "시스템", tag: "보강", auto: true },
    ],
    doing: [
      { id: "d1", title: "중고등 A반 진도표 업데이트", by: "이서연", tag: "영어", auto: false },
      { id: "d2", title: "신규생 3명 계정 등록", by: "정유진", tag: "데스크", auto: false },
    ],
    done: [
      { id: "n1", title: "5월 월말리포트 발송", by: "김지현", tag: "리포트", auto: false },
      { id: "n2", title: "인스타 피드 업로드", by: "정유진", tag: "SNS", auto: false },
    ],
  };
  const [cols, setCols] = uS(initial);
  const [drag, setDrag] = uS(null);
  const COLS = [["todo", "할 일", "neutral"], ["doing", "진행 중", "info"], ["done", "완료", "ok"]];

  const move = (cardId, from, to) => {
    if (from === to) return;
    setCols(prev => {
      const card = prev[from].find(c => c.id === cardId);
      if (!card) return prev;
      return { ...prev, [from]: prev[from].filter(c => c.id !== cardId), [to]: [card, ...prev[to]] };
    });
  };

  const CardEl = (card, colKey) => S("div", { key: card.id, className: "kb-card", draggable: true,
    onDragStart: () => setDrag({ id: card.id, from: colKey }), onDragEnd: () => setDrag(null) },
    S("div", { className: "row between", style: { gap: 6, marginBottom: 8 } },
      S("span", { className: "w-chip sm", style: card.auto ? { background: "var(--warn-soft)", color: "var(--warn)", borderColor: "transparent" } : null },
        card.auto ? "자동" : card.tag),
      S(Icon, { name: "drag", size: 14, style: { color: "var(--ink-faint)" } })),
    S("strong", { style: { fontSize: 13, display: "block", lineHeight: 1.4 } }, card.title),
    S("div", { className: "row between", style: { marginTop: 10 } },
      S("div", { className: "row gap", style: { gap: 6 } }, S(Avatar, { size: 24, label: card.by[0] }), S("span", { className: "t-xs w-faint fw6" }, card.by)),
      card.auto ? S("span", { className: "w-badge warn", style: { fontSize: 10 } }, "결석→보강") : null),
    device === "mobile" ? S("div", { className: "row gap", style: { gap: 4, marginTop: 8 } },
      COLS.filter(c => c[0] !== colKey).map(([k, l]) => S("button", { key: k, className: "w-btn sm", style: { flex: 1, fontSize: 11, height: 26 }, onClick: () => move(card.id, colKey, k) }, l, " →"))) : null);

  const column = ([key, label, tone]) => S("div", { key: key, className: "kb-col", style: { flex: 1, minWidth: device === "mobile" ? 240 : 0 },
    onDragOver: e => e.preventDefault(), onDrop: () => drag && move(drag.id, drag.from, key) },
    S("div", { className: "row between", style: { padding: "2px 4px 6px" } },
      S("div", { className: "row gap", style: { gap: 7 } }, S("span", { className: `w-dot ${tone}` }), S("strong", { style: { fontSize: 13 } }, label),
        S("span", { className: "w-badge neutral", style: { minWidth: 20, justifyContent: "center" } }, cols[key].length)),
      key === "todo" ? S(Icon, { name: "plus", size: 16, style: { color: "var(--ink-3)", cursor: "pointer" } }) : null),
    cols[key].map(c => CardEl(c, key)));

  return S(ScreenShell, { ctx, active: "board", title: "업무보드", device, go,
    actions: S("div", { className: "row gap" }, S("button", { className: "w-btn sm" }, S(Icon, { name: "archive", size: 14 }), "보관함"), S("button", { className: "w-btn pri sm" }, S(Icon, { name: "plus", size: 15 }), "카드")) },
    S("div", { className: "col gap2", style: { height: "100%" } },
      S("div", { className: "rel" },
        S("div", { className: "w-card flat pad-sm row between wrap", style: { gap: 8 } },
          S("div", { className: "row gap", style: { gap: 8 } },
            S("span", { className: "w-dot ok", style: { animation: "none" } }),
            S("span", { className: "t-sm fw6" }, "실시간 공유 중"),
            S("span", { className: "t-xs w-faint" }, "· 모든 선생님이 함께 보는 보드")),
          S("div", { className: "row gap", style: { gap: -6 } },
            ["김", "이", "박", "정"].map((n, i) => S("div", { key: i, style: { marginLeft: i ? -8 : 0 } }, S(Avatar, { size: 26, label: n }))))),
        S(Pin, { n: 1, x: "auto", y: -8 })),
      S("div", { className: "rel grow" },
        S("div", { className: "row", style: { gap: 12, height: "100%", overflowX: device === "mobile" ? "auto" : "visible", alignItems: "stretch" } },
          COLS.map(column)),
        S(Pin, { n: 2, x: 4, y: -8 }),
        S(Pin, { n: 3, x: "auto", y: -8 }))));
}
Board.notes = [
  { n: 1, t: "<b>1인 전용 → 전원 공유:</b> 모든 선생님이 실시간으로 함께 보는 보드. 누가 카드를 옮기면 다른 선생님 화면에도 곧 반영." },
  { n: 2, t: "<b>칸반 3칸 + 드래그:</b> 할 일 / 진행 중 / 완료. 카드를 끌어 이동(데스크탑은 드래그, 모바일은 버튼)." },
  { n: 3, t: "<b>완료 자동 보관 + 결석→보강 자동 카드:</b> 완료 7일 후 자동 보관(보관함에서 되살리기). 담당 과목 결석 시 보강 카드가 자동 생성." },
];
window.SCREENS.board = Board;

// ============================================================
// 데스크쌤 화면
// ============================================================
function Desk({ device, go, ctx = "desk" }) {
  const [tab, setTab] = uS("시간표");
  const days = ["월", "화", "수", "목", "금", "토"];
  const slots = ["15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];
  const cell = (d, t) => {
    const seed = (d * 7 + t) % 5;
    if (seed === 0) return null;
    const subj = seed % 2 ? "수학" : "영어";
    return S("div", { style: { background: subj === "수학" ? "var(--surface-3)" : "var(--accent-soft)", borderRadius: 6, padding: "4px 6px", fontSize: 10, fontWeight: 700, color: subj === "수학" ? "var(--ink-2)" : "var(--accent)" } },
      subj, S("span", { style: { fontWeight: 500, display: "block", fontSize: 9 } }, seed + 5, "명"));
  };
  const accounts = [
    ["김지현", "수학 강사", "jihyun_m", "••••••", "원장 겸임"],
    ["이서연", "영어 강사(중고등)", "seoyeon_e", "••••••", "강사"],
    ["박민호", "영어 강사(초등)", "minho_e", "••••••", "강사"],
    ["정유진", "데스크쌤", "yujin_d", "••••••", "데스크"],
  ];
  const tabs = ["시간표", "강사 계정", "학생 정보"];
  const tabBar = S("div", { className: "row gap", style: { gap: 6 } },
    tabs.map(t => S("span", { key: t, className: "w-chip" + (tab === t ? " on" : ""), onClick: () => setTab(t) }, t)));

  const timetable = S("div", { className: "rel" },
    S(Card, { title: "전체 학생 시간표 (수학·영어 통합)", action: S("div", { className: "row gap", style: { gap: 6 } }, S("span", { className: "w-chip sm" }, "수학"), S("span", { className: "w-chip sm", style: { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "transparent" } }, "영어")) },
      S("div", { style: { display: "grid", gridTemplateColumns: `54px repeat(${days.length}, 1fr)`, gap: 6, minWidth: device === "mobile" ? 520 : 0 } },
        S("div", null), days.map(d => S("div", { key: d, className: "t-xs fw7 w-faint", style: { textAlign: "center", paddingBottom: 4 } }, d)),
        slots.map((t, ti) => [
          S("div", { key: "h" + t, className: "t-xs w-faint tnum", style: { paddingTop: 4 } }, t),
          ...days.map((d, di) => S("div", { key: t + d, style: { minHeight: 34 } }, cell(di, ti)))
        ]))),
    S(Pin, { n: 1, x: "auto", y: 14 }));

  const accountsTab = S("div", { className: "rel" },
    S(Card, { title: "강사 계정 리스트", cls: "", style: { padding: 0, overflow: "hidden" }, action: null },
      S("table", { className: "w-table" },
        S("thead", null, S("tr", null, ["이름", "담당", "로그인 ID", "비밀번호", "권한", ""].map((th, i) => S("th", { key: i }, th)))),
        S("tbody", null, accounts.map(([nm, role, id, pw, perm], i) =>
          S("tr", { key: i },
            S("td", null, S("div", { className: "row gap" }, S(Avatar, { size: 28, label: nm[0] }), S("strong", { style: { fontSize: 13 } }, nm))),
            S("td", { className: "w-muted" }, role),
            S("td", { className: "w-muted tnum" }, "@", id),
            S("td", null, S("div", { className: "row gap", style: { gap: 6 } }, S("span", { className: "tnum w-muted" }, pw), S(Icon, { name: "eye", size: 14, style: { color: "var(--ink-faint)" } }))),
            S("td", null, S("span", { className: "w-badge neutral" }, perm)),
            S("td", null, S(Icon, { name: "copy", size: 14, style: { color: "var(--ink-faint)" } }))))))),
    S(Pin, { n: 2, x: "auto", y: 14 }));

  const studentsTab = S(Card, { title: "학생 정보 조회", action: S("button", { className: "w-btn sm", onClick: () => go("students") }, "학생 마스터 열기") },
    S("div", { className: "col gap" },
      S("p", { className: "t-sm w-muted", style: { margin: 0 } }, "데스크는 운영·안내 보조용으로 ", S("b", null, "조회 중심"), "입니다. 민감 정보는 원장이 권한 관리."),
      S("div", { className: "grid g3", style: { gap: 12 } },
        [["재원생", "238"], ["오늘 상담 예약", "3"], ["대기 등록", "7"]].map(([l, v], i) =>
          S("div", { key: i, className: "w-card flat pad-sm col", style: { gap: 2 } }, S("span", { className: "t-xs w-faint fw6" }, l), S("strong", { style: { fontSize: 20 } }, v))))));

  return S(ScreenShell, { ctx, active: "desk", title: "데스크", device, go },
    S("div", { className: "col gap2" },
      S("div", { className: "row between wrap", style: { gap: 10 } }, S("h2", { className: "w-h1" }, "데스크"), tabBar),
      device === "mobile" ? S("div", { style: { overflowX: "auto" } }, tab === "시간표" ? timetable : tab === "강사 계정" ? accountsTab : studentsTab)
        : (tab === "시간표" ? timetable : tab === "강사 계정" ? accountsTab : studentsTab)));
}
Desk.notes = [
  { n: 1, t: "<b>전체 학생 시간표:</b> 수학·영어를 한 화면에서 통합 조회. 안내·운영 보조용." },
  { n: 2, t: "<b>강사 계정 리스트:</b> 로그인 ID/비밀번호 등 운영 정보 조회. 민감 정보라 원장이 권한 관리, 데스크는 조회 중심." },
];
window.SCREENS.desk = Desk;

// ============================================================
// 매뉴얼 위키
// ============================================================
function Wiki({ device, go, ctx = "admin" }) {
  const IMP = { 핵심: "bad", 높음: "warn", 보통: "info", 낮음: "neutral" };
  const ST = { 최신: "ok", 검토중: "info", 작성중: "warn", "업데이트 필요": "bad", 초안: "neutral" };
  const rows = [
    ["신규 학생 등록 절차", "핵심", "최신", "2026.06.10"],
    ["영어 일일기록 작성 가이드", "높음", "검토중", "2026.06.08"],
    ["월말리포트 일괄 저장 방법", "높음", "작성중", "2026.05.30"],
    ["카카오워크 봇 알림 설정", "보통", "최신", "2026.05.21"],
    ["환불 · 휴원 처리 규정", "핵심", "업데이트 필요", "2026.03.14"],
    ["SNS 업로드 체크리스트", "낮음", "초안", "2026.06.01"],
  ];
  const [sel, setSel] = uS(0);
  const list = S("div", { className: "rel" },
    S(Card, { title: "매뉴얼 목록", cls: "", style: { padding: 0, overflow: "hidden" } },
      S("div", { className: "row gap wrap", style: { gap: 6, padding: 12 } },
        S("div", { className: "w-search grow", style: { maxWidth: 260 } }, S(Icon, { name: "search", size: 15 }), S("input", { placeholder: "문서 검색", readOnly: true })),
        S("button", { className: "w-btn sm" }, S(Icon, { name: "filter", size: 14 }), "중요도"),
        S("button", { className: "w-btn sm" }, "상태")),
      S("table", { className: "w-table" },
        S("thead", null, S("tr", null, ["제목", "중요도", "상태", "최종 수정"].map((th, i) => S("th", { key: i }, th)))),
        S("tbody", null, rows.map(([title, imp, st, date], i) =>
          S("tr", { key: i, onClick: () => setSel(i), style: { background: i === sel ? "var(--surface-2)" : "" } },
            S("td", { className: "fw7" }, S("div", { className: "row gap", style: { gap: 8 } }, S(Icon, { name: "wiki", size: 15, style: { color: "var(--ink-3)" } }), title)),
            S("td", null, S("span", { className: `w-badge ${IMP[imp]}` }, imp)),
            S("td", null, S("span", { className: `w-badge ${ST[st]}` }, st)),
            S("td", { className: "w-muted tnum" }, date)))))),
    S(Pin, { n: 1, x: "auto", y: 14 }));

  const article = S("div", { className: "rel", style: { height: "100%" } },
    S(Card, { cls: "col", style: { height: "100%" } },
      S("div", { className: "row between wrap", style: { gap: 8, marginBottom: 12 } },
        S("div", { className: "row gap", style: { gap: 6 } }, S("span", { className: `w-badge ${IMP[rows[sel][1]]}` }, rows[sel][1]), S("span", { className: `w-badge ${ST[rows[sel][2]]}` }, rows[sel][2])),
        S("span", { className: "t-xs w-faint" }, "최종 수정 ", rows[sel][3])),
      S("h2", { className: "w-h1", style: { fontSize: 20 } }, rows[sel][0]),
      S("div", { className: "row gap", style: { gap: 8, margin: "8px 0 14px" } }, S(Avatar, { size: 26, label: "지" }), S("span", { className: "t-xs w-faint fw6" }, "작성 김지현 · 열람 강사·데스크")),
      S("div", { className: "w-hr", style: { marginBottom: 14 } }),
      S("div", { className: "col gap2", style: { overflowY: "auto" } },
        S("div", { className: "col gap" }, S("strong", null, "1. 개요"), S("span", { className: "w-bar t" }), S("span", { className: "w-bar t", style: { width: "92%" } }), S("span", { className: "w-bar t", style: { width: "70%" } })),
        S("div", { className: "w-dashed", style: { height: 80, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: 12 } }, "예시 이미지 / 표"),
        S("div", { className: "col gap" }, S("strong", null, "2. 절차"), S("span", { className: "w-bar t" }), S("span", { className: "w-bar t", style: { width: "85%" } }), S("span", { className: "w-bar t", style: { width: "60%" } })))),
    S(Pin, { n: 2, x: "auto", y: 14 }));

  if (device === "mobile") {
    return S(ScreenShell, { ctx, active: "wiki", title: "매뉴얼 위키", device, go }, list);
  }
  return S(ScreenShell, { ctx, active: "wiki", title: "매뉴얼 위키", device, go },
    S("div", { style: { display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, height: "100%" } }, list, article));
}
Wiki.notes = [
  { n: 1, t: "<b>목록(테이블):</b> 글마다 제목·중요도(낮음~핵심)·상태(초안/작성중/검토중/최신/업데이트 필요)·최종 수정일. 중요도·상태로 정렬·필터." },
  { n: 2, t: "<b>열람 범위:</b> 강사·데스크 모두 열람, <b>학생만 제외</b>. 노션 매뉴얼을 읽기전용 동기화 또는 허브로 이관." },
];
window.SCREENS.wiki = Wiki;
