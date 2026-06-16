/* global React, ScreenShell, Icon, Avatar, Check, Pin, StatusBadge, Card, Field, MiniBar, ImagePH */
// ============================================================
// 운영 화면: 월말리포트 · SNS 관리 · 학생 화면 · 수학 연결
// ============================================================
window.SCREENS = window.SCREENS || {};
const O = React.createElement;
const { useState: uSt } = React;

// ============================================================
// 월말리포트 — 이미지 일괄 생성 (수학·영어)
// ============================================================
function Report({ device, go, ctx = "admin" }) {
  const students = ["최서아", "박하린", "김도윤", "정시우", "오지안", "한예린", "문서준", "배아윤", "강하은", "윤지호"];
  const [picked, setPicked] = uSt(() => students.map(() => true));
  const items8 = ["Listening", "Speaking", "Reading", "Spelling+Writing", "Comprehension", "Task Perf.", "Attitude", "Total"];
  const allOn = picked.every(Boolean);

  return O(ScreenShell, { ctx, active: "report", title: "월말리포트", device, go },
    O("div", { className: "col gap2" },
      O("div", { className: "row between wrap", style: { gap: 10 } },
        O("div", { className: "col", style: { gap: 2 } },
          O("h2", { className: "w-h1" }, "월말리포트 일괄 저장"),
          O("span", { className: "t-sm w-faint fw6" }, "월·반 선택 → 전체 학생 성적표 이미지를 한 번에 저장")),
        O("span", { className: "w-badge info" }, S2("eye"), "영어 담당 · 원장 실행")),
      // 컨트롤
      O("div", { className: "rel" },
        O("div", { className: "w-card pad-sm row gap wrap", style: { gap: 12, alignItems: "flex-end" } },
          O(Field, { label: "월", type: "select", placeholder: "2026년 5월" }),
          O(Field, { label: "과목", type: "select", placeholder: "영어 (초등)" }),
          O(Field, { label: "반", type: "select", placeholder: "초등 1반" }),
          O("button", { className: "w-btn", style: { height: 40 } }, S2("download", 15), "불러오기"),
          O("div", { className: "grow" }),
          O("button", { className: "w-btn pri", style: { height: 40 } }, S2("download", 16), "전체 ", picked.filter(Boolean).length, "명 이미지 일괄 저장")),
        O(Pin, { n: 1, x: "auto", y: -8 })),
      // 평가 항목 안내
      O("div", { className: "w-card flat pad-sm row gap wrap", style: { gap: 6 } },
        O("span", { className: "t-xs w-faint fw7", style: { marginRight: 4 } }, "평가 8개 항목"),
        items8.map(it => O("span", { key: it, className: "w-chip sm" }, it))),
      // 학생 그리드
      O("div", { className: "rel" },
        O(Card, { title: "성적표 미리보기", action: O(Check, { on: allOn, label: "전체 선택", onClick: () => setPicked(students.map(() => !allOn)) }) },
          O("div", { className: "grid", style: { gridTemplateColumns: device === "mobile" ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 12 } },
            students.map((nm, i) =>
              O("div", { key: i, className: "w-card pad-sm col", style: { gap: 8, padding: 10, borderColor: picked[i] ? "var(--accent)" : "var(--line)", cursor: "pointer" },
                onClick: () => setPicked(p => p.map((v, j) => j === i ? !v : v)) },
                O("div", { className: "row between" },
                  O("div", { className: "row gap", style: { gap: 6 } }, O(Check, { on: picked[i] }), O("strong", { style: { fontSize: 12 } }, nm)),
                  O("span", { className: "t-xs w-faint" }, ".png")),
                O("div", { className: "w-ph no-x", style: { height: 96, flexDirection: "column", gap: 4, padding: 8, alignItems: "stretch" } },
                  O("div", { className: "row between", style: { marginBottom: 2 } }, O("span", { className: "w-bar", style: { width: 40, height: 6 } }), O("span", { className: "w-bar", style: { width: 20, height: 6 } })),
                  [0, 1, 2].map(r => O("div", { key: r, className: "row between", style: { gap: 4 } }, O("span", { className: "w-bar", style: { width: "50%", height: 5 } }), O("span", { className: "w-bar", style: { width: 16, height: 5 } }))),
                  O("div", { style: { marginTop: "auto", height: 16, borderRadius: 4, background: "var(--accent-soft)" } })))))),
        O(Pin, { n: 2, x: "auto", y: 14 })),
      // 진행 표시
      O("div", { className: "w-card flat pad-sm col gap" },
        O("div", { className: "row between" }, O("span", { className: "t-sm fw6" }, "일괄 저장 진행"), O("span", { className: "t-xs w-faint tnum" }, "0 / ", picked.filter(Boolean).length)),
        O("div", { style: { height: 7, borderRadius: 99, background: "var(--surface-3)", overflow: "hidden" } }, O("div", { style: { width: "0%", height: "100%", background: "var(--accent)" } })),
        O("span", { className: "t-xs w-faint" }, "학생명으로 파일명 자동 지정 · 한 명씩 복붙 불필요"))));
}
function S2(name, size = 13) { return O(Icon, { name, size }); }
Report.notes = [
  { n: 1, t: "<b>핵심 개선:</b> 지금은 학생을 한 명씩 복붙해 이미지를 뽑음 → 월·반 선택 후 <b>전체 학생을 한 번에 불러와 이미지 일괄 저장</b>(학생명 파일명 자동)." },
  { n: 2, t: "<b>레이아웃 유지:</b> 성적표 레이아웃·항목명(8개 평가 항목)은 기존 성적표 시스템 그대로. 권한은 영어 담당(+원장)." },
];
window.SCREENS.report = Report;

// ============================================================
// SNS 관리 — 등록 → 데스크 복붙 업로드
// ============================================================
function Sns({ device, go, ctx = "admin" }) {
  const ST = { "업로드 대기": "neutral", "수정필요": "warn", "업로드 중지": "bad", "업로드 완료": "ok" };
  const posts = [
    ["6월 영어 특강 안내", "인스타", "이서연", "업로드 대기"],
    ["수학 경시 수상 후기", "블로그", "김지현", "업로드 완료"],
    ["초등 파닉스반 모집", "인스타", "박민호", "수정필요"],
    ["여름방학 시간표 공지", "블로그", "정유진", "업로드 중지"],
  ];
  const [sel, setSel] = uSt(0);
  const list = O("div", { className: "rel" },
    O(Card, { title: "SNS 게시물", cls: "", style: { padding: 0, overflow: "hidden" }, action: null },
      O("div", { className: "row between", style: { padding: 12 } },
        O("div", { className: "row gap", style: { gap: 6 } }, ["전체", "대기", "완료"].map((t, i) => O("span", { key: t, className: "w-chip" + (i === 0 ? " on" : "") }, t))),
        O("button", { className: "w-btn pri sm" }, S2("plus", 14), "글 등록")),
      O("table", { className: "w-table" },
        O("thead", null, O("tr", null, ["제목", "대상", "작성자", "상태"].map((th, i) => O("th", { key: i }, th)))),
        O("tbody", null, posts.map(([title, ch, by, st], i) =>
          O("tr", { key: i, onClick: () => setSel(i), style: { background: i === sel ? "var(--surface-2)" : "" } },
            O("td", { className: "fw7" }, title),
            O("td", null, O("span", { className: "w-chip sm" }, ch)),
            O("td", { className: "w-muted" }, by),
            O("td", null, O("span", { className: `w-badge ${ST[st]}` }, st))))))),
    O(Pin, { n: 1, x: "auto", y: 14 }));

  const compose = O("div", { className: "rel", style: { height: "100%" } },
    O(Card, { cls: "col gap2", style: { height: "100%" } },
      O("div", { className: "row between" }, O("strong", { style: { fontSize: 15 } }, "게시물 상세"), O("span", { className: `w-badge ${ST[posts[sel][3]]}` }, posts[sel][3])),
      O(Field, { label: "제목", placeholder: posts[sel][0] }),
      O("div", { className: "row gap", style: { gap: 10 } }, O(Field, { label: "대상 SNS", type: "select", placeholder: posts[sel][1] }), O(Field, { label: "작성자", placeholder: posts[sel][2] })),
      O("div", { className: "rel" },
        O("div", { className: "w-field" },
          O("div", { className: "row between" }, O("span", { className: "w-label" }, "본문"), O("button", { className: "w-btn sm", style: { height: 26 } }, S2("copy", 13), "본문 복사")),
          O("textarea", { className: "w-textarea", style: { minHeight: 110 }, readOnly: true, placeholder: "업로드할 본문 내용… (데스크가 이 본문을 복사해 SNS에 붙여넣어 업로드)" })),
        O(Pin, { n: 2, x: "auto", y: -4 })),
      O("div", { className: "rel" },
        O("div", { className: "row gap", style: { gap: 10, alignItems: "flex-end" } },
          O(Field, { label: "상태 변경", type: "select", placeholder: "업로드 완료", grow: true }),
          O(Field, { label: "업로드 링크", placeholder: "https://instagram.com/…", grow: true })),
        O(Pin, { n: 3, x: "auto", y: -4 })),
      O("div", { className: "row gap mta", style: { gap: 8 } }, O("button", { className: "w-btn pri grow" }, "저장"), O("button", { className: "w-btn" }, "업로드 완료 처리"))),
    null);

  if (device === "mobile") return O(ScreenShell, { ctx, active: "sns", title: "SNS 관리", device, go }, list);
  return O(ScreenShell, { ctx, active: "sns", title: "SNS 관리", device, go },
    O("div", { style: { display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16, height: "100%" } }, list, compose));
}
Sns.notes = [
  { n: 1, t: "<b>열람:</b> 데스크·강사 모두. 노션 'SNS 관리'처럼 운영. 상태값: 업로드 대기 · 수정필요 · 업로드 중지 · 업로드 완료." },
  { n: 2, t: "<b>흐름 ①②:</b> 강사/원장이 글 등록(제목·본문·대상SNS·작성자) → 데스크가 <b>본문을 복사해 업로드</b>." },
  { n: 3, t: "<b>흐름 ③:</b> 업로드 후 상태 '업로드 완료' + <b>업로드 링크 기록</b>. 대상 채널: 블로그·인스타 등." },
];
window.SCREENS.sns = Sns;

// ============================================================
// 수학 — 기존 앱 연결
// ============================================================
function MathLink({ device, go, ctx = "admin" }) {
  return O(ScreenShell, { ctx, active: null, title: "수학 강사", device, go,
    actions: O("button", { className: "w-btn pri sm" }, S2("link", 15), "수학 앱 열기") },
    O("div", { className: "col gap2" },
      O("div", { className: "rel" },
        O("div", { className: "w-card", style: { padding: device === "mobile" ? 20 : 28 } },
          O("div", { className: "row gap2 wrap between", style: { alignItems: "center" } },
            O("div", { className: "row gap2", style: { alignItems: "center" } },
              O("div", { style: { width: 56, height: 56, borderRadius: 16, background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "center" } }, S2("book", 26)),
              O("div", { className: "col", style: { gap: 4 } },
                O("h2", { className: "w-h1", style: { fontSize: 20 } }, "수학은 기존 앱 그대로"),
                O("span", { className: "t-sm w-muted" }, "현재 bakkum-class 앱을 유지하고, 허브에서 연결만 합니다."))),
            O("button", { className: "w-btn pri lg" }, S2("link", 16), "수학 앱 열기"))),
        O(Pin, { n: 1, x: "auto", y: 14 })),
      O("div", { className: "grid", style: { gridTemplateColumns: device === "mobile" ? "1fr" : "1fr 1fr", gap: 16 } },
        O(Card, { title: "그대로 유지되는 것" },
          O("div", { className: "col gap" },
            ["출결(시간표 기반 출석/지각/결석)", "숙제 · 진도 · 테스트 입력", "인센티브 정산 · 경시/랭킹", "월말리포트(기존 운영 중)"].map((t, i) =>
              O("div", { key: i, className: "row gap", style: { gap: 8 } }, O("span", { className: "w-dot ok" }), O("span", { className: "t-sm" }, t))))),
        O("div", { className: "rel" },
          O(Card, { title: "v3 화면 개선 적용", cls: "" },
            O("div", { className: "col gap" },
              ["글씨 대비 강화", "상태색(초록/앰버/빨강) 통일", "'오늘 브리핑' 추가", "다크모드"].map((t, i) =>
                O("div", { key: i, className: "row gap", style: { gap: 8 } }, O("span", { className: "w-dot info" }), O("span", { className: "t-sm" }, t))))),
          O(Pin, { n: 2, x: "auto", y: 14 }))),
      O("div", { className: "w-dashed", style: { height: 140, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: 13, gap: 8 } },
        S2("desktop", 18), "기존 수학 앱(bakkum-class) 화면 임베드 영역")));
}
MathLink.notes = [
  { n: 1, t: "<b>수학 회귀 없음:</b> 지현님의 현재 앱(bakkum-class)을 그대로 유지. 허브에서 '수학 강사' 화면으로 연결만." },
  { n: 2, t: "<b>화면 개선만:</b> 글씨 대비·상태색·오늘 브리핑·다크모드 등은 v3 기준으로 적용. 기능 회귀는 단계별 확인." },
];
window.SCREENS.math = MathLink;

// ============================================================
// 학생 화면 (조회 중심)
// ============================================================
function Student({ device, go }) {
  const tabs = [["home", "홈", "home"], ["hw", "숙제", "note"], ["prog", "진도", "book"], ["me", "내 정보", "student"]];
  const [tab, setTab] = uSt("home");
  const body = O("div", { className: "col gap2" },
    O("div", { className: "col", style: { gap: 2 } },
      O("span", { className: "t-sm w-faint fw6" }, "안녕하세요, 최서아 학생"),
      O("h2", { className: "w-h1", style: { fontSize: device === "mobile" ? 20 : 24 } }, "오늘의 학습")),
    O("div", { className: "rel" },
      O(Card, { title: "오늘의 숙제", cls: "pad-sm", action: O("span", { className: "w-badge warn" }, "2개 남음") },
        O("div", { className: "col", style: { gap: 4 } },
          [["워크북 p.30-33", true], ["단어 Day 12 암기", false], ["본문 받아쓰기", false]].map(([t, done], i) =>
            O("div", { key: i, className: "row gap", style: { padding: "8px 6px", borderRadius: 8, background: done ? "var(--ok-soft)" : "transparent" } },
              O(Check, { on: done }), O("span", { className: "t-sm", style: { textDecoration: done ? "line-through" : "none", color: done ? "var(--ink-3)" : "var(--ink)" } }, t))))),
      O(Pin, { n: 1, x: "auto", y: 14 })),
    O("div", { className: "grid g2", style: { gap: 12 } },
      O(Card, { title: "학습 목표", cls: "pad-sm" },
        O("div", { className: "col gap" }, O(MiniBar, { label: "이번 주 달성", val: "67%", tone: "info", note: "2 / 3" }),
          O("div", { className: "col", style: { gap: 4, marginTop: 4 } },
            ["단어 30개 암기", "본문 해석", "Grammar U4"].map((t, i) => O("div", { key: i, className: "row gap", style: { gap: 6 } }, O("span", { className: `w-dot ${i < 2 ? "ok" : "neutral"}` }), O("span", { className: "t-xs" }, t)))))),
      O(Card, { title: "단어시험", cls: "pad-sm col", style: { gap: 6 } },
        O("strong", { style: { fontSize: 26 } }, "18", O("span", { className: "t-sm w-faint", style: { fontWeight: 600 } }, " / 20")),
        O("span", { className: "t-xs w-faint" }, "6/12 · 오답 2개 재시험"),
        O("div", { style: { height: 6, borderRadius: 99, background: "var(--surface-3)", marginTop: 4 } }, O("div", { style: { width: "90%", height: "100%", borderRadius: 99, background: "var(--ok)" } })))),
    O("div", { className: "rel" },
      O(Card, { title: "진도", cls: "pad-sm", action: O("span", { className: "t-xs w-faint" }, "Insight Link L1") },
        O("div", { className: "row gap2 wrap" },
          O("div", { className: "grow col", style: { gap: 6, minWidth: 160 } }, O("span", { className: "t-sm fw6" }, "Unit 4 · 모의고사 3회"), O("div", { style: { height: 6, borderRadius: 99, background: "var(--surface-3)" } }, O("div", { style: { width: "55%", height: "100%", borderRadius: 99, background: "var(--accent)" } }))),
          O("span", { className: "w-badge info" }, "55% 진행"))),
      O(Pin, { n: 2, x: "auto", y: 14 })),
    O(Card, { title: "선생님 코멘트", cls: "pad-sm" },
      O("div", { className: "row gap", style: { gap: 10, alignItems: "flex-start" } }, O(Avatar, { size: 32, label: "이" }),
        O("p", { className: "t-sm w-muted", style: { margin: 0, lineHeight: 1.55 } }, "이번 주 발표 정말 좋았어요! 단어 오답만 한 번 더 정리하면 완벽합니다."))));

  // 학생 전용 셸 (위키·다른 메뉴 없음 — 조회 중심)
  if (device === "mobile") {
    return O("div", { className: "scr", style: { flexDirection: "column" } },
      O("div", { className: "scr-top", style: { height: 54, padding: "0 18px" } },
        O("strong", { style: { fontSize: 16, fontWeight: 800 } }, "바꿈"), O("div", { className: "mla" }, O(Avatar, { size: 30, label: "서" }))),
      O("div", { className: "scr-body", style: { padding: 18 } }, tab === "home" ? body : O("div", { className: "col center", style: { height: 300, color: "var(--ink-3)" } }, "조회 중심 화면 (", tabs.find(t => t[0] === tab)[1], ")")),
      O("div", { className: "scr-tabbar" }, tabs.map(([id, lbl, ic]) => O("div", { key: id, className: "tab" + (tab === id ? " on" : ""), onClick: () => setTab(id) }, O(Icon, { name: ic, size: 21 }), O("span", null, lbl)))));
  }
  return O("div", { className: "scr", style: { background: "var(--bg)" } },
    O("div", { className: "scr-side", style: { width: 200 } },
      O("div", { className: "scr-brand" }, O("div", { className: "mark" }, "바"), O("div", { className: "col" }, O("strong", { style: { fontSize: 14 } }, "바꿈 허브"), O("span", { className: "t-xs w-faint fw6" }, "학생"))),
      tabs.map(([id, lbl, ic]) => O("div", { key: id, className: "nav-item" + (tab === id ? " on" : ""), onClick: () => setTab(id) }, O(Icon, { name: ic, size: 18, className: "ic" }), O("span", null, lbl))),
      O("div", { className: "mta" }, O("div", { className: "nav-item", onClick: () => go("login") }, O(Icon, { name: "logout", size: 18, className: "ic" }), O("span", null, "로그아웃")))),
    O("div", { className: "scr-main" },
      O("div", { className: "scr-top" }, O("strong", { style: { fontSize: 16, fontWeight: 800 } }, "내 학습"), O("div", { className: "mla row gap2" }, O(Avatar, { size: 32, label: "서" }))),
      O("div", { className: "scr-body wide" }, O("div", { style: { maxWidth: 720, margin: "0 auto" } }, tab === "home" ? body : O("div", { className: "col center", style: { height: 360, color: "var(--ink-3)" } }, "조회 중심 화면 (", tabs.find(t => t[0] === tab)[1], ")")))));
}
Student.notes = [
  { n: 1, t: "<b>조회 중심:</b> 학생은 본인 기록(목표·숙제·진도 등)만 봄. 필요 시 제출. 매뉴얼 위키 등 운영 화면은 노출 안 함." },
  { n: 2, t: "<b>본인 기록만:</b> 강사가 입력한 일일기록(진도·단어시험·코멘트)이 학생 화면에 본인 것만 반영됨." },
];
window.SCREENS.student = Student;
