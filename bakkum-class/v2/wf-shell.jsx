/* global React, Icon, Avatar */
// ============================================================
// 와이어프레임 셸: 인-프로덕트 크롬 + 디바이스 프레임 + 컨트롤 레일 + 주석
// ============================================================
const { createElement: e } = React;

// ---------- 컨트롤 레일(와이어프레임 브라우저)의 화면 목록 ----------
const NAV = [
  { group: "진입 · 라우팅", items: [
    { id: "login", label: "로그인 · 역할 라우팅", icon: "logout" },
    { id: "student", label: "학생 화면", icon: "student" },
  ]},
  { group: "대시보드", items: [
    { id: "director", label: "원장 대시보드(전체)", icon: "grid" },
  ]},
  { group: "과목", items: [
    { id: "math", label: "수학 강사(기존 연결)", icon: "book" },
    { id: "english", label: "영어 일일기록", icon: "star" },
    { id: "english-dash", label: "영어 대시보드", icon: "report" },
  ]},
  { group: "공유 레이어", items: [
    { id: "students", label: "공통 학생 마스터", icon: "users" },
    { id: "student-detail", label: "학생 상세", icon: "note" },
    { id: "notes", label: "강사 특이사항(누적)", icon: "note" },
    { id: "board", label: "공유 업무보드(칸반)", icon: "board" },
  ]},
  { group: "운영", items: [
    { id: "desk", label: "데스크쌤 화면", icon: "desk" },
    { id: "wiki", label: "매뉴얼 위키", icon: "wiki" },
    { id: "report", label: "월말리포트 일괄 저장", icon: "report" },
    { id: "sns", label: "SNS 관리", icon: "sns" },
  ]},
];
const ALL_IDS = NAV.flatMap(g => g.items.map(i => i.id));
const LABEL = Object.fromEntries(NAV.flatMap(g => g.items.map(i => [i.id, i.label])));

// ---------- 제품 내부 사이드바 컨텍스트 ----------
const NAV_CTX = {
  admin: { brand: "바꿈 허브", role: "원장 · 관리자", items: [
    { id: "director", label: "대시보드", icon: "grid" },
    { id: "students", label: "학생 마스터", icon: "users" },
    { id: "english", label: "영어 일일기록", icon: "star" },
    { id: "notes", label: "강사 특이사항", icon: "note" },
    { id: "board", label: "업무보드", icon: "board" },
    { id: "desk", label: "데스크 · 운영", icon: "desk" },
    { id: "report", label: "월말리포트", icon: "report" },
    { id: "sns", label: "SNS 관리", icon: "sns" },
    { id: "wiki", label: "매뉴얼 위키", icon: "wiki" },
  ]},
  english: { brand: "바꿈 허브", role: "영어 강사 · 중고등", items: [
    { id: "english-dash", label: "영어 현황", icon: "grid" },
    { id: "english", label: "오늘 일일기록", icon: "star" },
    { id: "students", label: "학생", icon: "users" },
    { id: "notes", label: "특이사항", icon: "note" },
    { id: "board", label: "업무보드", icon: "board" },
    { id: "sns", label: "SNS 관리", icon: "sns" },
    { id: "wiki", label: "매뉴얼 위키", icon: "wiki" },
  ]},
  desk: { brand: "바꿈 허브", role: "데스크쌤", items: [
    { id: "desk", label: "데스크 홈", icon: "desk" },
    { id: "students", label: "학생 정보", icon: "users" },
    { id: "board", label: "업무보드", icon: "board" },
    { id: "sns", label: "SNS 관리", icon: "sns" },
    { id: "wiki", label: "매뉴얼 위키", icon: "wiki" },
  ]},
};
// 모바일 하단 탭(컨텍스트별 4개)
const TABS = {
  admin: ["director", "students", "english", "board"],
  english: ["english-dash", "english", "students", "notes"],
  desk: ["desk", "students", "board", "sns"],
};

// ---------- 인-프로덕트 화면 셸 ----------
function ScreenShell({ ctx = "admin", active, title, actions, children, go, device, search = true }) {
  const cfg = NAV_CTX[ctx] || NAV_CTX.admin;
  if (device === "mobile") {
    const tabs = TABS[ctx] || TABS.admin;
    return e("div", { className: "scr", style: { flexDirection: "column" } },
      e("div", { className: "scr-top", style: { height: 54, padding: "0 16px" } },
        e("div", { className: "scr-brand", style: { padding: 0, gap: 8 } },
          e("div", { className: "mark", style: { width: 26, height: 26, fontSize: 13 } }, "바"),
          e("strong", { style: { fontSize: 15 } }, title || cfg.brand)),
        e("div", { className: "mla row gap" },
          e("div", { className: "w-btn ghost sm", style: { width: 34, padding: 0 } }, e(Icon, { name: "bell", size: 18 })))),
      e("div", { className: "scr-body", style: { padding: 16 } }, children),
      e("div", { className: "scr-tabbar" },
        tabs.map(id => {
          const it = cfg.items.find(x => x.id === id) || { id, label: LABEL[id] || id, icon: "grid" };
          return e("div", { key: id, className: "tab" + (id === active ? " on" : ""), onClick: () => go(id) },
            e(Icon, { name: it.icon, size: 21 }), e("span", null, it.label));
        })));
  }
  return e("div", { className: "scr" },
    e("div", { className: "scr-side" },
      e("div", { className: "scr-brand" },
        e("div", { className: "mark" }, "바"),
        e("div", { className: "col" },
          e("strong", { style: { fontSize: 14, lineHeight: 1.2 } }, "바꿈 통합 허브"),
          e("span", { className: "t-xs w-faint", style: { fontWeight: 600 } }, cfg.role))),
      cfg.items.map(it =>
        e("div", { key: it.id, className: "nav-item" + (it.id === active ? " on" : ""), onClick: () => go(it.id) },
          e(Icon, { name: it.icon, size: 18, className: "ic" }), e("span", null, it.label))),
      e("div", { className: "mta" },
        e("div", { className: "nav-item", onClick: () => go("login") },
          e(Icon, { name: "logout", size: 18, className: "ic" }), e("span", null, "로그아웃")))),
    e("div", { className: "scr-main" },
      e("div", { className: "scr-top" },
        e("strong", { style: { fontSize: 16, fontWeight: 800 } }, title),
        search ? e("div", { className: "w-search", style: { maxWidth: 280, marginLeft: 8 } },
          e(Icon, { name: "search", size: 15 }), e("input", { placeholder: "학생·강사 검색", readOnly: true })) : null,
        e("div", { className: "mla row gap2" },
          actions,
          e("div", { className: "w-btn ghost sm", style: { width: 36, padding: 0 } }, e(Icon, { name: "bell", size: 18 })),
          e(Avatar, { size: 32, label: "쌤" }))),
      e("div", { className: "scr-body wide" }, children)));
}

// ---------- 디바이스 프레임 ----------
// 데스크탑: 1240px 고정 설계 → 좁은 창에서는 프레임 전체를 비율 축소(scale-to-fit).
//          내부 UI 밀도/여백을 그대로 유지하므로 텍스트 압축·잘림이 발생하지 않음.
function DesktopFrame({ children }) {
  const frameRef = React.useRef(null);
  const scalerRef = React.useRef(null);
  React.useLayoutEffect(() => {
    const frame = frameRef.current, scaler = scalerRef.current;
    if (!frame || !scaler) return;
    const stage = scaler.closest(".stage");
    const apply = () => {
      frame.style.transform = "none";
      const FW = frame.offsetWidth || 1240;
      const FH = frame.offsetHeight || 800;
      const avail = (stage ? stage.clientWidth : window.innerWidth) - 72;
      const s = Math.min(1, avail / FW);
      frame.style.transformOrigin = "top center";
      frame.style.transform = `translateX(-50%) scale(${s})`;
      scaler.style.width = (FW * s) + "px";
      scaler.style.height = (FH * s) + "px";
    };
    apply();
    const ro = new ResizeObserver(apply);
    if (stage) ro.observe(stage);
    window.addEventListener("resize", apply);
    return () => { ro.disconnect(); window.removeEventListener("resize", apply); };
  }, []);
  return e("div", { className: "dev-scaler", ref: scalerRef },
    e("div", { className: "dev-desktop", ref: frameRef },
      e("div", { className: "dev-bar" },
        e("div", { className: "row gap", style: { gap: 6 } },
          e("span", { className: "dev-dot" }), e("span", { className: "dev-dot" }), e("span", { className: "dev-dot" })),
        e("div", { className: "dev-url" }, "hub.bakkum.app")),
      e("div", { className: "dev-desktop-screen" }, children)));
}

function DeviceFrame({ device, children }) {
  if (device === "mobile") {
    return e("div", { className: "dev-phone" },
      e("div", { className: "dev-notch" }),
      e("div", { className: "dev-phone-screen" }, children));
  }
  return e(DesktopFrame, null, children);
}

// ---------- 주석 패널 ----------
function AnnoPanel({ notes, screenLabel }) {
  return e("div", { className: "anno-panel" },
    e("div", { className: "anno-head" },
      e(Icon, { name: "note", size: 17 }),
      e("div", { className: "col" },
        e("strong", { style: { fontSize: 13 } }, "핸드오프 주석"),
        e("span", { className: "t-xs w-faint" }, screenLabel))),
    e("div", { className: "anno-list" },
      (notes && notes.length) ? notes.map(nt =>
        e("div", { key: nt.n, className: "anno-note" },
          e("div", { className: "n" }, nt.n),
          e("div", { className: "tx", dangerouslySetInnerHTML: { __html: nt.t } }))) :
        e("div", { className: "t-sm w-faint", style: { padding: 16, textAlign: "center" } }, "이 화면에는 주석이 없습니다.")));
}

Object.assign(window, { NAV, ALL_IDS, LABEL, NAV_CTX, TABS, ScreenShell, DeviceFrame, AnnoPanel, e });
