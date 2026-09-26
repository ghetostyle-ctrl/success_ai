import type { NextConfig } from "next";

/**
 * Production HTML caching guard.
 *
 * Next.js 16 by default sends `Cache-Control: s-maxage=31536000` (1 year)
 * on prerendered pages. Cloudflare honors that aggressively, so a code
 * change followed by `npm run build` would leave employees seeing the
 * OLD HTML until the Cloudflare edge cache eventually expires. Disabling
 * the long s-maxage on the app root ensures every page load fetches the
 * fresh build.
 *
 * Static asset chunks (/_next/static/*) still get long cache headers
 * because their filenames are hashed — safe to cache forever.
 */
const nextConfig: NextConfig = {
  // Next.js 16 보안 가드 — dev mode에서 localhost 외 origin 들어오면
  // HMR/RSC 등 클라이언트 기능 차단. 외부 도메인 (Cloudflare
  // Tunnel을 통한 외부 접근)에서 화면이 깨지는 원인이라 명시적 허용.
  allowedDevOrigins: ["127.0.0.1", "your-domain.example.com", "*.example.com" /* 배포 도메인으로 교체 */],
  // Response compression — 명시적으로 켬. /api/ads 응답이 12MB 인데
  // 한국 → Singapore latency 80ms + 그 용량 다운로드가 첫 화면 로딩의
  // 가장 큰 병목이었음. gzip 압축 시 약 1/6 (12MB → 2MB)로 줄어 한국에서
  // 체감 4~5배 빠름.
  compress: true,
  async headers() {
    return [
      {
        // App pages (not /_next/static/* or /api/*) — never let CDN
        // hold an old HTML render after a rebuild.
        source: "/((?!_next/static|_next/image|api).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, s-maxage=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
