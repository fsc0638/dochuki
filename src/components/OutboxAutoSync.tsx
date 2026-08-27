"use client";

import { useEffect } from "react";
import { syncOutbox } from "@/lib/offline/outbox";

/**
 * 離線佇列的保底同步機制：連線恢復事件＋頁面重新可見時各觸發一次，
 * 掛載時也立刻跑一次。這三個是所有瀏覽器都支援的原生事件，不依賴
 * Service Worker 的 Background Sync API（Safari 完全不支援那個 API，
 * 不能只靠它）。真正的補送邏輯在 src/lib/offline/outbox.ts。
 */
export function OutboxAutoSync() {
  useEffect(() => {
    void syncOutbox();

    function handleOnline() {
      void syncOutbox();
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") void syncOutbox();
    }

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return null;
}
