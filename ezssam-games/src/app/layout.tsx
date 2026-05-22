import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ezssam 게임 — 수학을 몸으로 배우다",
  description: "ezssam이 만든 초등 수학 게임을 한곳에 모은 페이지",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* 한글 폰트: Pretendard (기획서 지정 CDN) */}
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
        />
        {/* 영문/숫자 폰트: Inter */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-gray-50 font-sans text-navy antialiased">
        {children}
      </body>
    </html>
  );
}
