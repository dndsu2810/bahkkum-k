/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 순수 정적 사이트로 내보내기 (out/ 폴더) — Cloudflare 워커 정적 자산으로 배포
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
