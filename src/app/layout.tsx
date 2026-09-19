import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "마브AI — 광고 레퍼런스 아카이브",
  description:
    "구글 광고 투명성 센터 · 메타 광고 라이브러리 · YouTube 공개 데이터를 모아보는 오픈 광고 레퍼런스 도구",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        {/* 시스템 폰트 사용 — 웹폰트 CDN(1.5MB, 41 chunks)이 첫 paint 의
            가장 큰 병목. 한국 사용자 OS 기본 폰트 (Apple SD Gothic Neo /
            맑은 고딕)로 즉시 렌더. 디자인 차이 미세, 속도 차이 5초+. */}
      </head>
      <body
        className="min-h-full flex flex-col"
        style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
      >
        {children}
      </body>
    </html>
  );
}
