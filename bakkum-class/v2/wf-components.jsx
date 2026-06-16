/* global React */
// ============================================================
// 공용 와이어프레임 컴포넌트 + 아이콘
// ============================================================
const { useState, useEffect, useRef, createElement: h } = React;

// ---------- 아이콘 (단순 라인 아이콘) ----------
const ICONS = {
  home: "M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M22 19v-1a4 4 0 0 0-3-3.8M16 3.2A3.5 3.5 0 0 1 16 10",
  book: "M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2zM4 5v15",
  note: "M5 3h10l5 5v13H5zM15 3v5h5M9 13h7M9 17h5",
  board: "M4 4h16v16H4zM4 9h16M9 9v11M15 9v11",
  desk: "M3 21h18M4 21V8h16v13M9 21v-6h6v6M4 8 12 3l8 5",
  wiki: "M5 3h11l4 4v14H5zM16 3v4h4M8 11h8M8 15h8M8 7h4",
  report: "M5 3h9l5 5v13H5zM14 3v5h5M8 17v-4M12 17v-7M16 17v-2",
  sns: "M4 5h16v11H8l-4 4zM8 9h8M8 12h5",
  star: "M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 17l-5.3 2.6 1-5.8-4.2-4.1 5.9-.9z",
  student: "M12 3 2 8l10 5 10-5zM6 10.5V15c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4-4",
  plus: "M12 5v14M5 12h14",
  check: "M5 12l5 5L20 6",
  chevR: "M9 6l6 6-6 6",
  chevD: "M6 9l6 6 6-6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2",
  cal: "M4 5h16v16H4zM4 9h16M8 3v4M16 3v4",
  filter: "M3 5h18l-7 8v5l-4 2v-7z",
  download: "M12 4v11m0 0 4-4m-4 4-4-4M5 19h14",
  edit: "M14 5l5 5M4 20l1-4L16 5l3 3L8 19z",
  drag: "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01",
  archive: "M3 4h18v4H3zM5 8v12h14V8M9 12h6",
  link: "M10 13a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.7-5.7l-1 1M14 11a4 4 0 0 0-6-.5l-2 2A4 4 0 0 0 11.7 18l1-1",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  logout: "M14 4h5v16h-5M14 12H4m0 0 4-4m-4 4 4 4",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  sun: "M12 4V2M12 22v-2M6 6 4.5 4.5M19.5 19.5 18 18M4 12H2M22 12h-2M6 18l-1.5 1.5M19.5 4.5 18 6M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  moon: "M21 13a8 8 0 1 1-9-9 6.5 6.5 0 0 0 9 9",
  phone: "M7 2h10v20H7zM10 19h4",
  desktop: "M3 4h18v12H3zM8 20h8M12 16v4",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
};
function Icon({ name, size = 18, sw = 1.7, style, className }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round",
    style, className }, h("path", { d: ICONS[name] || ICONS.grid }));
}

// ---------- 작은 프리미티브 ----------
function Check({ on, label, onClick }) {
  return h("label", { className: "row gap", style: { cursor: "pointer", fontSize: 13 }, onClick },
    h("span", { className: "w-check" + (on ? " on" : "") }, on ? h(Icon, { name: "check", size: 13, sw: 2.6 }) : null),
    label != null ? h("span", null, label) : null);
}
function Toggle({ on, onClick }) { return h("span", { className: "w-toggle" + (on ? " on" : ""), onClick }); }

function Avatar({ size = 40, label = "사진", cls = "" }) {
  const c = size >= 56 ? "lg" : size <= 32 ? "sm" : "";
  return h("div", { className: `w-ph w-avatar ${c} ${cls}`, style: { width: size, height: size } },
    h("span", null, label));
}
function ImagePH({ w = "100%", h: hh = 120, label = "이미지", radius, noX }) {
  return h("div", { className: "w-ph" + (noX ? " no-x" : ""), style: { width: w, height: hh, borderRadius: radius } },
    h("span", null, label));
}
function Bars({ lines = 3, w = ["100%", "90%", "70%"] }) {
  return h("div", { className: "col", style: { gap: 7, width: "100%" } },
    Array.from({ length: lines }).map((_, i) =>
      h("span", { key: i, className: "w-bar", style: { width: Array.isArray(w) ? (w[i] || "80%") : w } })));
}

// ---------- 주석 핀 ----------
function Pin({ n, x, y, r }) {
  const style = { top: y };
  if (x === "auto" || x == null) style.right = (r == null ? 10 : r);
  else style.left = x;
  return h("div", { className: "anno-pin", style, title: `주석 ${n}`, "data-anno": n }, n);
}

// ---------- 상태 뱃지 헬퍼 ----------
const STATUS = {
  재원: ["ok", "재원"], 휴원: ["warn", "휴원"], 퇴원: ["bad", "퇴원"], 대기: ["neutral", "대기"],
  출석: ["ok", "출석"], 지각: ["warn", "지각"], 결석: ["bad", "결석"],
  완료: ["ok", "완료"], 진행중: ["info", "진행 중"], 할일: ["neutral", "할 일"],
};
function StatusBadge({ s }) {
  const [tone, txt] = STATUS[s] || ["neutral", s];
  return h("span", { className: `w-badge ${tone}` }, h("span", { className: `w-dot ${tone}` }), txt);
}

// ---------- 빈 행/플레이스홀더 ----------
function Field({ label, children, placeholder, type = "input", grow }) {
  const el = type === "textarea" ? h("textarea", { className: "w-textarea", placeholder, readOnly: true })
    : type === "select" ? h("div", { className: "w-select", style: { display: "flex", alignItems: "center" } }, placeholder)
    : h("input", { className: "w-input", placeholder, readOnly: true });
  return h("div", { className: "w-field", style: grow ? { flex: 1 } : null },
    label ? h("span", { className: "w-label" }, label) : null, children || el);
}

// ---------- 토스트 + 되돌리기 (개선: A-3) ----------
let _toastListeners = [];
function showToast(msg, opts = {}) { _toastListeners.forEach(f => f(msg, opts)); }
function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (msg, opts) => {
      const id = Date.now() + Math.random();
      setItems(p => [...p, { id, msg, undo: opts.undo, tone: opts.tone || "ok" }]);
      setTimeout(() => setItems(p => p.filter(x => x.id !== id)), opts.duration || 4200);
    };
    _toastListeners.push(fn);
    return () => { _toastListeners = _toastListeners.filter(f => f !== fn); };
  }, []);
  const drop = id => setItems(p => p.filter(x => x.id !== id));
  return h("div", { className: "wf-toasts" },
    items.map(it => h("div", { key: it.id, className: "wf-toast" },
      h("span", { className: "wf-toast-ic " + it.tone }, h(Icon, { name: "check", size: 14, sw: 2.6 })),
      h("span", { className: "grow t-sm fw6" }, it.msg),
      it.undo ? h("button", { className: "wf-toast-undo", onClick: () => drop(it.id) },
        h(Icon, { name: "logout", size: 13, style: { transform: "scaleX(-1)" } }), "되돌리기") : null)));
}

// ---------- 날짜 이동 컨트롤 (개선: A-4) ----------
function DateNav({ label }) {
  return h("div", { className: "date-nav" },
    h("button", { className: "dn-btn", title: "어제" }, h(Icon, { name: "chevR", size: 15, style: { transform: "rotate(180deg)" } })),
    h("span", { className: "dn-label tnum" }, label),
    h("button", { className: "dn-btn", title: "내일" }, h(Icon, { name: "chevR", size: 15 })),
    h("button", { className: "dn-today" }, "오늘로"));
}

// 내보내기
Object.assign(window, { Icon, ICONS, Check, Toggle, Avatar, ImagePH, Bars, Pin, StatusBadge, Field, showToast, ToastHost, DateNav, h, useState, useEffect, useRef });
