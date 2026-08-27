"use client";

import { useEffect } from "react";

/** 只負責註冊 public/sw.js，不做其他事——快取策略全部在 SW 檔案本身 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    // 只在正式環境註冊。`pnpm dev`（Turbopack）底下 /_next/static/ 的路徑
    // 不像正式建置那樣同名必同內容，SW 一旦註冊過就會用 cache-first 卡住
    // 開發當下那份舊 chunk，之後改程式碼、重啟 dev server 都看不到最新結果，
    // 只能手動去 DevTools 清 SW——開發模式乾脆不註冊，免得踩到這個問題
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 註冊失敗（例如用 http 存取非 localhost 的區網 IP）不影響應用本身
        // 可用性，靜默忽略即可
      });
    }
  }, []);

  return null;
}
