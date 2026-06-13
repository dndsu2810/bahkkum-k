import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Hub } from "./Hub";
import { AuthProvider } from "./auth";
import "./styles.css";

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
