import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocuSumm",
  description: "AI 기반 텍스트/YouTube 요약 워크스페이스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
