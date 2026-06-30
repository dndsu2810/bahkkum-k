import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Hub } from "./Hub";
import { AuthProvider } from "./auth";
import "./styles.css";

// 숫자 입력칸(수업시간·지각분·점수 등) 위에서 마우스 휠을 굴리면 값이 멋대로 바뀌던 문제 방지 —
// 포커스된 number 입력칸은 휠이 오면 포커스를 풀어, 페이지만 스크롤되고 값은 안 바뀌게 한다.
document.addEventListener(
  "wheel",
  () => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === "number") el.blur();
  },
  { passive: true }
);

// 테마 조기 적용 — 로그인 화면도 저장된 다크모드를 따르도록(Header 마운트 전).
try {
  const saved = localStorage.getItem("theme");
  const dark = saved === "dark" || (saved !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
} catch {
  /* ignore */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <Hub />
    </AuthProvider>
  </StrictMode>
);
