/* global React, ScreenShell, Icon, Avatar, ImagePH, Bars, Check, Pin, StatusBadge, Field, Toggle */
// ============================================================
// 코어 화면: 로그인 · 원장 대시보드 · 학생 마스터 · 학생 상세
// ============================================================
window.SCREENS = window.SCREENS || {};
const C = React.createElement;

// 공용 작은 헬퍼
function Card({ title, action, children, style, cls = "" }) {
  return C("div", { className: "w-card " + cls, style },
    (title || action) ? C("div", { className: "sec-head" },
      C("h3", { className: "w-h3" }, title), action) : null,
    children);
}
function MiniBar({ label, val, tone = "info", note }) {
  return C("div", { className: "col", style: { gap: 5 } },
    C("div", { className: "row between", style: { gap: 8 } },
      C("span", { className: "t-xs w-muted fw6 nowrap", style: { overflow: "hidden", textOverflow: "ellipsis" } }, label),
      C("span", { className: "t-xs fw7 tnum nowrap", style: { flex: "none" } }, note)),
    C("div", { style: { height: 7, borderRadius: 99, background: "var(--surface-3)", overflow: "hidden" } },
      C("div", { style: { width: val, height: "100%", borderRadius: 99, background: `var(--${tone})` } })));
}
window.Card = Card; window.MiniBar = MiniBar;

// ============================================================
// 로그인 · 역할 라우팅
// ============================================================
function Login({ device, go }) {
  const roles = [
    ["원장 · 관리자", "전체 화면 · 전 과목", "director", "admin"],
    ["수학 강사 (지현)", "수학 초등+중고등 전체", "math", "admin"],
    ["영어 강사", "중고등 영어", "english", "english"],
    ["초등영어 강사", "초등 영어", "english", "english"],
    ["데스크쌤", "전체 시간표 · 계정 · 학생", "desk", "desk"],
    ["학생", "본인 기록 조회", "student", "student"],
  ];
  const form = C("div", { className: "col gap2", style: { width: "100%", maxWidth: 360 } },
    C("div", { className: "col", style: { gap: 6 } },
      C("div", { className: "row gap", style: { gap: 10 } },
        C("div", { style: { width: 40, height: 40, borderRadius: 11, background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 19 } }, "바"),
        C("div", { className: "col" },
          C("strong", { style: { fontSize: 19, fontWeight: 800 } }, "바꿈 통합 허브"),
          C("span", { className: "t-xs w-faint fw6" }, "바꿈영수학원 통합 운영"))),
      C("p", { className: "t-sm w-muted", style: { margin: "8px 0 0", lineHeight: 1.5 } },
        "로그인하면 ", C("b", null, "역할에 맞는 화면"), "으로 자동 이동합니다.")),
    C(Field, { label: "온라인 ID", placeholder: "아이디 입력" }),
    C("div", { className: "rel" },
      C(Field, { label: "비밀번호", placeholder: "생년월일 8자리 (자동 비번)" }),
      C(Pin, { n: 2, x: "auto", y: -6 })),
    C("button", { className: "w-btn pri lg block", onClick: () => go("director", "admin") }, "로그인"),
    C("div", { className: "row gap", style: { justifyContent: "space-between" } },
      C(Check, { on: true, label: "로그인 유지" }),
      C("span", { className: "t-sm", style: { color: "var(--accent)", fontWeight: 600, cursor: "pointer" } }, "비밀번호 찾기")));

  const demo = C("div", { className: "col gap", style: { width: "100%", maxWidth: device === "mobile" ? 360 : 380 } },
    C("div", { className: "row gap", style: { gap: 10, margin: "2px 0 4px" } },
      C("div", { className: "w-hr grow" }),
      C("span", { className: "t-xs w-faint fw7", style: { letterSpacing: ".04em" } }, "데모 · 역할별 화면 미리보기"),
      C("div", { className: "w-hr grow" })),
    C("div", { className: "rel" },
      C("div", { className: "grid g2", style: { gap: 8 } },
        roles.map(([t, s, id, ctx], i) =>
          C("div", { key: i, className: "w-card pad-sm", style: { cursor: "pointer", padding: 11 },
            onClick: () => go(id, ctx) },
            C("div", { className: "row between", style: { gap: 6 } },
              C("strong", { style: { fontSize: 12.5 } }, t),
              C(Icon, { name: "chevR", size: 14, style: { color: "var(--ink-faint)" } })),
            C("span", { className: "t-xs w-faint", style: { display: "block", marginTop: 2 } }, s)))),
      C(Pin, { n: 1, x: "auto", y: -10 })));

  const inner = device === "mobile"
    ? C("div", { className: "col gap3", style: { padding: "32px 22px", alignItems: "center" } }, form, demo)
    : C("div", { className: "row", style: { height: "100%" } },
        C("div", { style: { flex: "0 0 46%", background: "var(--surface-2)", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", justifyContent: "center", padding: 48, gap: 20 } },
          C("div", { className: "col gap" },
            C("span", { className: "w-eyebrow" }, "BAKKUM INTEGRATED HUB"),
            C("h1", { style: { fontSize: 30, fontWeight: 800, lineHeight: 1.25, margin: "6px 0 0", letterSpacing: "-0.02em" } },
              "하나의 허브에서", C("br"), "역할에 맞는 화면으로."),
            C("p", { className: "w-muted", style: { fontSize: 14, lineHeight: 1.6, maxWidth: 360 } },
              "학생 마스터 · 강사 특이사항 · 업무보드를 모든 역할이 공유합니다. 수학은 기존 그대로, 영어는 신규.")),
          C("div", { className: "row gap wrap", style: { gap: 8 } },
            ["학생 마스터", "특이사항", "업무보드", "매뉴얼 위키"].map(t =>
              C("span", { key: t, className: "w-chip" }, C("span", { className: "w-dot info" }), t)))),
        C("div", { style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26, padding: 40 } }, form, demo));

  return C("div", { className: "scr", style: { display: "block", background: "var(--surface)" } }, inner);
}
Login.notes = [
  { n: 1, t: "<b>역할 기반 라우팅:</b> 실제로는 로그인 1회 → 계정 역할에 따라 자동 분기. 이 데모 패널은 검토용으로 6개 역할 진입점을 노출합니다." },
  { n: 2, t: "<b>자동 비밀번호:</b> 학생 마스터의 생년월일(8자리)이 초기 비번으로 자동 설정됩니다." },
];
window.SCREENS.login = Login;

// ============================================================
// 원장 대시보드 (전체)
// ============================================================
function Director({ device, go, ctx = "admin" }) {
  const teachers = [["김지현", "수학 · 초등+중고등", "ok"], ["이서연", "영어 · 중고등", "ok"], ["박민호", "영어 · 초등", "ok"], ["정유진", "데스크", "neutral"]];
  return C(ScreenShell, { ctx, active: "director", title: "대시보드", device, go,
    actions: C("button", { className: "w-btn pri sm", onClick: () => go("students") }, C(Icon, { name: "plus", size: 15 }), "강사 등록") },
    C("div", { className: "col gap2" },
      // 브리핑 헤더 (개선: 오늘 한 줄 브리핑 + 날짜 이동)
      C("div", { className: "col gap2" },
        C("div", { className: "row between wrap", style: { gap: 12 } },
          C("div", { className: "col", style: { gap: 2 } },
            C("span", { className: "t-sm w-faint fw6" }, "2026년 6월 12일 금요일 · 오늘의 브리핑"),
            C("h2", { className: "w-h1" }, "원장님, 오늘 등원 예정 92명이에요.")),
          device !== "mobile" ? C(DateNav, { label: "6월 12일 (금)" }) : null),
        C("div", { className: "brief" },
          C(Icon, { name: "star", size: 16, style: { color: "var(--accent)", flex: "none" } }),
          C("span", { className: "t-sm", style: { lineHeight: 1.5 } },
            "오늘은 ",
            C("b", { className: "brief-k", onClick: () => go("english") }, "92명 등원"),
            " · ",
            C("b", { className: "brief-k warn", onClick: () => go("english") }, "일일기록 7건 미입력"),
            " · ",
            C("b", { className: "brief-k bad", onClick: () => go("notes") }, "신규 특이사항 5건"),
            " 이에요."))),
      // 통계
      C("div", { className: "grid " + (device === "mobile" ? "g2" : "g4") },
        [["재원생", "238", "명", "info"], ["오늘 등원", "92", "명", "ok"], ["일일기록 미입력", "7", "건", "warn"], ["신규 특이사항", "5", "건", "bad"]].map(([l, n, u, tone], i) =>
          C("div", { key: i, className: "stat" },
            C("div", { className: "row between" }, C("span", { className: `w-dot ${tone}` }), C(Icon, { name: "chevR", size: 14, style: { color: "var(--ink-faint)" } })),
            C("div", { className: "num", style: { marginTop: 8 } }, n, C("span", { style: { fontSize: 14, fontWeight: 600, color: "var(--ink-3)", marginLeft: 3 } }, u)),
            C("div", { className: "lbl" }, l)))),
      // 본문 2열
      C("div", { className: "grid", style: { gridTemplateColumns: device === "mobile" ? "1fr" : "1.4fr 1fr" } },
        C(Card, { title: "전 과목 현황", action: C("span", { className: "t-xs", style: { color: "var(--accent)", fontWeight: 600, cursor: "pointer" } }, "자세히") },
          C("div", { className: "grid g2", style: { gap: 14 } },
            C("div", { className: "w-card flat pad-sm col gap2" },
              C("div", { className: "row between" }, C("strong", null, "수학"), C("span", { className: "w-badge neutral" }, "기존 유지")),
              C(MiniBar, { label: "오늘 등원", val: "78%", tone: "ok", note: "54 / 69" }),
              C(MiniBar, { label: "숙제 완료", val: "64%", tone: "info", note: "44 / 69" }),
              C(MiniBar, { label: "진도 입력", val: "91%", tone: "info", note: "63 / 69" })),
            C("div", { className: "w-card flat pad-sm col gap2" },
              C("div", { className: "row between" }, C("strong", null, "영어"), C("span", { className: "w-badge info" }, "신규")),
              C(MiniBar, { label: "오늘 등원", val: "70%", tone: "ok", note: "38 / 54" }),
              C(MiniBar, { label: "숙제 검사", val: "52%", tone: "warn", note: "28 / 54" }),
              C(MiniBar, { label: "일일기록", val: "87%", tone: "info", note: "47 / 54" })))),
        C("div", { className: "rel" },
          C(Card, { title: "강사 관리", action: C("button", { className: "w-btn sm", onClick: () => go("students") }, "배분") },
            C("div", { className: "col" },
              teachers.map(([nm, role, tone], i) =>
                C("div", { key: i, className: "lrow" },
                  C(Avatar, { size: 34, label: nm[0] }),
                  C("div", { className: "grow col", style: { gap: 1 } },
                    C("strong", { style: { fontSize: 13 } }, nm),
                    C("span", { className: "t-xs w-faint" }, role)),
                  C("span", { className: `w-dot ${tone}` }))),
              C("button", { className: "w-btn block sm", style: { marginTop: 6 }, onClick: () => go("students") },
                C(Icon, { name: "plus", size: 14 }), "강사 계정 등록 · 담당 배분"))),
          C(Pin, { n: 2, x: "auto", y: 14 }))),
      // 공유 위젯
      C("div", { className: "rel" },
        C("div", { className: "grid", style: { gridTemplateColumns: device === "mobile" ? "1fr" : "1fr 1fr" } },
          C(Card, { title: "강사 특이사항 (최근)", action: C("span", { className: "t-xs", style: { color: "var(--accent)", fontWeight: 600, cursor: "pointer" }, onClick: () => go("notes") }, "전체 보기") },
            C("div", { className: "col gap" },
              [["이준호", "수학 김지현", "숙제 2회 연속 미제출, 학부모 연락 필요"], ["최서아", "영어 이서연", "단어시험 만점, 레벨업 검토"]].map(([nm, by, tx], i) =>
                C("div", { key: i, className: "row gap", style: { padding: "8px 0", borderBottom: i === 0 ? "1px solid var(--line)" : 0, alignItems: "flex-start" } },
                  C("span", { className: "w-dot info", style: { marginTop: 6 } }),
                  C("div", { className: "grow col", style: { gap: 2 } },
                    C("div", { className: "row gap", style: { gap: 6 } }, C("strong", { style: { fontSize: 13 } }, nm), C("span", { className: "t-xs w-faint" }, by, " · 2시간 전")),
                    C("span", { className: "t-sm w-muted" }, tx)))))),
          C(Card, { title: "업무보드 (실시간)", action: C("span", { className: "t-xs", style: { color: "var(--accent)", fontWeight: 600, cursor: "pointer" }, onClick: () => go("board") }, "보드 열기") },
            C("div", { className: "grid g3", style: { gap: 8 } },
              [["할 일", "5", "neutral"], ["진행 중", "3", "info"], ["완료", "12", "ok"]].map(([l, n, tone], i) =>
                C("div", { key: i, className: "w-card flat pad-sm col", style: { gap: 8 } },
                  C("div", { className: "row between" }, C("span", { className: "t-xs w-faint fw7" }, l), C("span", { className: `w-dot ${tone}` })),
                  C("strong", { style: { fontSize: 20 } }, n),
                  C("span", { className: "w-bar", style: { width: "80%" } }),
                  C("span", { className: "w-bar", style: { width: "60%" } })))))),
        C(Pin, { n: 3, x: -8, y: -10 }))));
}
Director.notes = [
  { n: 2, t: "<b>원장 전용:</b> 강사 계정 <b>등록</b> + 담당(과목/학년) <b>배분</b>. 다른 역할에는 노출되지 않습니다." },
  { n: 3, t: "<b>공유 레이어 위젯:</b> 특이사항·업무보드는 모든 역할이 공유. 대시보드에는 읽기용 미리보기로 올리고 클릭 시 전체 화면으로 이동." },
];
window.SCREENS.director = Director;

// ============================================================
// 공통 학생 마스터
// ============================================================
function Students({ device, go, ctx = "admin" }) {
  const rows = [
    ["이준호", "junho07", "바꿈중 2", "2025.03.04", "수학", "재원"],
    ["최서아", "seoa_m", "영재고 1", "2024.09.01", "수학·영어", "재원"],
    ["김도윤", "doyoon11", "바꿈초 5", "2025.11.20", "영어", "재원"],
    ["박하린", "harin_k", "한빛중 3", "2023.05.15", "수학·영어", "휴원"],
    ["정시우", "siwoo_e", "바꿈초 3", "2026.01.08", "영어", "대기"],
    ["한예린", "yerin22", "성일고 2", "2024.02.27", "수학", "재원"],
    ["오지안", "jian_m", "바꿈중 1", "2025.06.30", "수학·영어", "재원"],
    ["서민준", "minjun9", "은하중 2", "2022.08.19", "수학", "퇴원"],
  ];
  const subjDots = s => C("div", { className: "row gap", style: { gap: 5 } },
    s.includes("수학") ? C("span", { className: "w-chip sm" }, "수학") : null,
    s.includes("영어") ? C("span", { className: "w-chip sm", style: { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "transparent" } }, "영어") : null);

  if (device === "mobile") {
    return C(ScreenShell, { ctx, active: "students", title: "학생 마스터", device, go },
      C("div", { className: "col gap" },
        C("div", { className: "row gap wrap", style: { gap: 6, marginBottom: 4 } },
          ["전체", "재원", "휴원", "대기"].map((t, i) => C("span", { key: t, className: "w-chip" + (i === 0 ? " on" : "") }, t))),
        rows.slice(0, 6).map(([nm, id, sch, , subj, st], i) =>
          C("div", { key: i, className: "w-card pad-sm", onClick: () => go("student-detail"), style: { cursor: "pointer" } },
            C("div", { className: "row gap" },
              C(Avatar, { size: 38, label: nm[0] }),
              C("div", { className: "grow col", style: { gap: 2 } },
                C("div", { className: "row between" }, C("strong", { style: { fontSize: 14 } }, nm), C(StatusBadge, { s: st })),
                C("span", { className: "t-xs w-faint" }, sch, " · @", id)),
              ),
            C("div", { style: { marginTop: 8 } }, subjDots(subj)))),
        C("button", { className: "w-btn pri block", style: { marginTop: 6 } }, C(Icon, { name: "plus", size: 16 }), "학생 등록")));
  }
  return C(ScreenShell, { ctx, active: "students", title: "학생 마스터", device, go,
    actions: C("button", { className: "w-btn pri sm" }, C(Icon, { name: "plus", size: 15 }), "학생 등록") },
    C("div", { className: "col gap2" },
      C("div", { className: "rel" },
        C("div", { className: "row between wrap", style: { gap: 10 } },
          C("div", { className: "row gap wrap", style: { gap: 6 } },
            ["전체 238", "재원 201", "휴원 18", "퇴원 12", "대기 7"].map((t, i) => C("span", { key: t, className: "w-chip" + (i === 0 ? " on" : "") }, t)),
            C("span", { className: "w-vr", style: { height: 20, margin: "0 4px" } }),
            ["수학", "영어"].map(t => C("span", { key: t, className: "w-chip" }, t))),
          C("button", { className: "w-btn sm" }, C(Icon, { name: "filter", size: 14 }), "정렬 · 필터")),
        C(Pin, { n: 1, x: "auto", y: -28 })),
      C("div", { className: "w-card", style: { padding: 0, overflow: "hidden" } },
        C("table", { className: "w-table" },
          C("thead", null, C("tr", null, ["이름", "온라인 ID", "학교 · 학년", "첫 수업일", "수강 과목", "상태", ""].map((th, i) => C("th", { key: i }, th)))),
          C("tbody", null, rows.map(([nm, id, sch, first, subj, st], i) =>
            C("tr", { key: i, onClick: () => go("student-detail") },
              C("td", null, C("div", { className: "row gap" }, C(Avatar, { size: 30, label: nm[0] }), C("strong", { style: { fontSize: 13 } }, nm))),
              C("td", { className: "w-muted" }, "@", id),
              C("td", { className: "w-muted" }, sch),
              C("td", { className: "w-muted tnum" }, first),
              C("td", null, subjDots(subj)),
              C("td", null, C(StatusBadge, { s: st })),
              C("td", null, C(Icon, { name: "chevR", size: 15, style: { color: "var(--ink-faint)" } })))))))));
}
Students.notes = [
  { n: 1, t: "<b>한 학생 = 한 번 등록.</b> 노션 학생 DB 구조를 따름. 항목: 이름·온라인ID·생년월일·학교·학년(자동)·첫수업일·연락처·상태(재원/휴원/퇴원/대기)·생일(자동)." },
  { n: 2, t: "<b>과목 공유:</b> 한 학생이 수학·영어를 모두 들으면 같은 학생 레코드에 양쪽 기록이 함께 붙습니다." },
];
window.SCREENS.students = Students;

// ============================================================
// 학생 상세
// ============================================================
function StudentDetail({ device, go, ctx = "admin" }) {
  const [tab, setTab] = React.useState("영어");
  const enLogs = [
    ["6.12", "Insight Link L1 · Unit 4", "단어 18/20", "숙제 완료", "ok"],
    ["6.10", "Insight Link L1 · Unit 3", "단어 20/20", "숙제 완료", "ok"],
    ["6.07", "Insight Link L1 · Unit 3", "단어 14/20", "숙제 미흡", "warn"],
  ];
  return C(ScreenShell, { ctx, active: "students", title: "학생 상세", device, go,
    actions: C("div", { className: "row gap" }, C("button", { className: "w-btn sm", onClick: () => go("students") }, "목록"), C("button", { className: "w-btn sm" }, C(Icon, { name: "edit", size: 14 }), "수정")) },
    C("div", { className: "col gap2" },
      // 프로필 헤더
      C("div", { className: "rel" },
        C("div", { className: "w-card" },
          C("div", { className: "row gap2 wrap", style: { alignItems: "flex-start" } },
            C(Avatar, { size: 64, label: "사진" }),
            C("div", { className: "grow col", style: { gap: 6, minWidth: 200 } },
              C("div", { className: "row gap", style: { gap: 10 } },
                C("h2", { className: "w-h1", style: { fontSize: 20 } }, "최서아"),
                C(StatusBadge, { s: "재원" }),
                C("span", { className: "w-chip sm" }, "수학"),
                C("span", { className: "w-chip sm", style: { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "transparent" } }, "영어")),
              C("div", { className: "row wrap", style: { gap: "4px 22px" } },
                [["온라인 ID", "@seoa_m"], ["학교 · 학년", "영재고 1학년"], ["첫 수업일", "2024.09.01"], ["연락처(학생)", "010-1234-****"], ["연락처(학부모)", "010-5678-****"], ["생일", "11월 03일"]].map(([k, v], i) =>
                  C("div", { key: i, className: "col", style: { gap: 1, minWidth: 130 } },
                    C("span", { className: "t-xs w-faint fw6" }, k), C("span", { className: "t-sm fw6" }, v))))),
            C("div", { className: "w-card flat pad-sm col", style: { gap: 2, minWidth: 150 } },
              C("span", { className: "t-xs w-faint fw6" }, "초기 비밀번호 (자동)"),
              C("strong", { className: "tnum", style: { fontSize: 16 } }, "081103••"),
              C("span", { className: "t-xs w-faint" }, "생년월일 8자리 기반"))),
        ),
        C(Pin, { n: 1, x: "auto", y: 14 })),
      // 탭
      C("div", { className: "row gap", style: { gap: 6 } },
        ["영어", "수학", "특이사항"].map(t =>
          C("span", { key: t, className: "w-chip" + (tab === t ? " on" : ""), onClick: () => setTab(t) }, t, " 기록"))),
      // 탭 내용
      tab === "영어" ? C("div", { className: "rel" },
        C(Card, { title: "영어 일일기록", action: C("button", { className: "w-btn sm", onClick: () => go("english") }, "기록 입력") },
          C("table", { className: "w-table" },
            C("thead", null, C("tr", null, ["날짜", "진도 · 교재", "단어시험", "숙제검사", ""].map((th, i) => C("th", { key: i }, th)))),
            C("tbody", null, enLogs.map(([d, prog, word, hw, tone], i) =>
              C("tr", { key: i },
                C("td", { className: "tnum fw7" }, d),
                C("td", { className: "w-muted" }, prog),
                C("td", { className: "tnum fw6" }, word),
                C("td", null, C("span", { className: `w-badge ${tone}` }, hw)),
                C("td", null, C(Icon, { name: "chevR", size: 14, style: { color: "var(--ink-faint)" } }))))))),
        C(Pin, { n: 2, x: -8, y: -10 }))
      : tab === "수학" ? C(Card, { title: "수학 기록 (기존 앱)", action: C("button", { className: "w-btn sm", onClick: () => go("math") }, "수학 앱 열기") },
          C("div", { className: "col gap2" },
            C("div", { className: "grid g3", style: { gap: 12 } },
              [["출결률", "94%", "ok"], ["숙제 완료", "88%", "info"], ["최근 테스트", "92점", "ok"]].map(([l, v, tone], i) =>
                C("div", { key: i, className: "w-card flat pad-sm col", style: { gap: 4 } },
                  C("span", { className: "t-xs w-faint fw6" }, l), C("strong", { style: { fontSize: 18 } }, v), C("span", { className: `w-dot ${tone}` })))),
            C("div", { className: "w-dashed", style: { height: 90, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: 12 } }, "수학 진도 그래프 · 인센티브 정산 (기존 bakkum-class 화면)")))
      : C(Card, { title: "특이사항 (과목 공통 · 누적)" },
          C("div", { className: "tl", style: { marginTop: 4 } },
            [["이서연 (영어)", "2시간 전", "단어시험 만점 3회 연속. 레벨업(L2) 검토 요청.", "info"],
             ["김지현 (수학)", "어제", "도형 단원 어려워함. 보충 자료 배부.", "warn"],
             ["정유진 (데스크)", "3일 전", "학부모 상담 예약 — 6/15 오후 4시.", "neutral"]].map(([who, when, tx, tone], i) =>
              C("div", { key: i, className: "tl-item" },
                C("div", { className: "row gap", style: { gap: 8 } }, C("strong", { style: { fontSize: 13 } }, who), C("span", { className: "t-xs w-faint" }, when)),
                C("p", { className: "t-sm w-muted", style: { margin: "3px 0 0" } }, tx)))))));
}
StudentDetail.notes = [
  { n: 1, t: "<b>자동 비밀번호:</b> 생년월일에서 초기 비번 자동 생성. <b>자동 항목</b>(학년·생일·비번)은 입력 불필요." },
  { n: 2, t: "<b>양쪽 기록 통합:</b> 같은 학생 레코드에 수학·영어 기록이 탭으로 함께 표시. 영어는 일일기록(학습일지)에서 누적." },
];
window.SCREENS["student-detail"] = StudentDetail;
