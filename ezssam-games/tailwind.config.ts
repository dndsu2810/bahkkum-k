import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    // .json 도 포함 — games.json 안의 그라데이션 클래스를 스캔해야 함
    "./src/**/*.{js,ts,jsx,tsx,mdx,json}",
  ],
  theme: {
    extend: {
      colors: {
        // ezssam 브랜드 팔레트 — 하늘색 메인 (지현 선택, 2026-05-22)
        brand: {
          DEFAULT: "#5DADE2", // 메인 (하늘)
          light: "#AED6F1",
          dark: "#3498C8",
        },
        navy: "#1F2937", // 보조 (텍스트/헤더)
        accent: "#F59E0B", // 강조 (호박) — Tailwind 기본 amber 색상표와 겹치지 않게 별도 이름
        mint: "#10B981", // 성공
      },
      fontFamily: {
        sans: ["Pretendard", "Inter", "system-ui", "sans-serif"],
        num: ["Inter", "Pretendard", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
        "card-hover":
          "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
      },
    },
  },
  plugins: [],
};

export default config;
