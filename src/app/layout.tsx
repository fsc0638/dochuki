import type { Metadata, Viewport } from "next";
import { Noto_Serif_TC } from "next/font/google";
import { OutboxAutoSync } from "@/components/OutboxAutoSync";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

// 只用在標題／金額這類「有個性」的位置，一般內文維持系統字體——思源宋體
// 含完整 CJK 字符，全站鋪開會拖慢首次載入
const notoSerifTC = Noto_Serif_TC({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-noto-serif-tc",
  display: "swap",
});

export const metadata: Metadata = {
  title: "道中記 Dōchūki",
  description: "旅遊記帳 PWA：拍照收據解析、多幣別分攤、一鍵匯出彙整總表",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "道中記",
  },
};

export const viewport: Viewport = {
  themeColor: "#712b13",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className={notoSerifTC.variable}>
      <body className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        <ServiceWorkerRegister />
        <OutboxAutoSync />
        <footer className="mx-auto w-full max-w-md px-6 py-4 text-center text-xs text-ink-muted">
          Icons by{" "}
          <a href="https://openmoji.org" target="_blank" rel="noreferrer" className="underline">
            OpenMoji
          </a>
          （CC BY-SA 4.0）
        </footer>
      </body>
    </html>
  );
}
