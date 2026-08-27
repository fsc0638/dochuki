"use client";

import { useEffect, useState } from "react";
import type { OutboxExpenseRecord } from "@/lib/offline/db";
import { listOutboxForTrip, syncOutbox } from "@/lib/offline/outbox";

/** payload 是 parseExpenseFormData() 的輸出，還沒過 zod 驗證，型別是 unknown——
 * 這裡只是純顯示用途，用不到的欄位或格式異常一律安全退回空字串，不讓元件壞掉 */
function displayFields(payload: unknown): { description: string; amount: string; currency: string } {
  if (typeof payload !== "object" || payload === null) {
    return { description: "（資料格式錯誤）", amount: "", currency: "" };
  }
  const p = payload as Record<string, unknown>;
  return {
    description: typeof p.description === "string" ? p.description : "",
    amount: typeof p.amountOriginal === "string" ? p.amountOriginal : "",
    currency: typeof p.currency === "string" ? p.currency : "",
  };
}

/**
 * 顯示這個行程目前還沒送出成功的離線支出。伺服器端渲染時完全看不到這些
 * 資料（純存在使用者本機的 IndexedDB），掛載後才讀取，SSR 階段不顯示
 * 任何東西是預期行為，不是 bug。
 */
export function OutboxStatus({ tripId }: { tripId: string }) {
  const [items, setItems] = useState<OutboxExpenseRecord[]>([]);
  const [syncing, setSyncing] = useState(false);

  async function refresh() {
    setItems(await listOutboxForTrip(tripId));
  }

  useEffect(() => {
    void refresh();
    // 同步常常是在別處觸發的（OutboxAutoSync、SW background sync），
    // 視窗重新取得焦點時順便重新整理一次，不用使用者手動按重試才看得到結果
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh 只依賴 tripId，重新宣告非必要
  }, [tripId]);

  async function handleRetry() {
    setSyncing(true);
    await syncOutbox();
    await refresh();
    setSyncing(false);
  }

  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-dashed border-stamp-mid bg-stamp-pale p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-stamp">
          {items.length} 筆離線新增，待連線同步
        </h2>
        <button
          type="button"
          onClick={handleRetry}
          disabled={syncing}
          className="flex-shrink-0 rounded-full border border-dashed border-stamp-mid px-3 py-1 text-xs text-stamp disabled:opacity-50"
        >
          {syncing ? "同步中…" : "立即重試"}
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const { description, amount, currency } = displayFields(item.payload);
          return (
            <li key={item.id} className="text-xs text-ink-soft">
              {description} · {amount} {currency}
              {item.lastError !== undefined && (
                <span className="ml-2 text-red-600">{item.lastError}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
