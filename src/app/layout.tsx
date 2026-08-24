import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "道中記 Dōchūki",
  description: "旅遊記帳 PWA：拍照收據解析、多幣別分攤、一鍵匯出彙整總表",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
