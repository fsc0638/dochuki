import { getOfflineDb, OUTBOX_STORE, OUTBOX_TRIP_INDEX, type OutboxExpenseRecord } from "./db";

/** 新增一筆離線支出，存進本機佇列。呼叫端已經確認離線（見 ExpenseForm.tsx） */
export async function saveExpenseToOutbox(tripId: string, payload: unknown): Promise<void> {
  const db = await getOfflineDb();
  const record: OutboxExpenseRecord = {
    id: crypto.randomUUID(),
    tripId,
    payload,
    createdAt: new Date().toISOString(),
  };
  await db.add(OUTBOX_STORE, record);
  // 不等待——這是錦上添花的機制，不該卡住核心的「存進佇列」流程。
  // 曾經 await 過，實測發現剛載入的分頁 navigator.serviceWorker.ready
  // 可能長時間不 resolve（例如 SW 還沒完成註冊），會拖住整個
  // saveExpenseToOutbox() 遲遲不完成
  void requestBackgroundSync();
}

export async function listOutboxForTrip(tripId: string): Promise<OutboxExpenseRecord[]> {
  const db = await getOfflineDb();
  return db.getAllFromIndex(OUTBOX_STORE, OUTBOX_TRIP_INDEX, tripId);
}

export interface SyncResult {
  succeeded: number;
  failed: number;
}

/**
 * 逐筆把佇列裡的支出補送到伺服器。呼叫端負責決定「什麼時候呼叫」（連線
 * 恢復、頁面重新可見、Service Worker background sync）——這支函式本身
 * 不判斷網路狀態，單純嘗試 fetch，失敗就留在佇列裡等下一次。
 */
export async function syncOutbox(): Promise<SyncResult> {
  const db = await getOfflineDb();
  const all = await db.getAll(OUTBOX_STORE);
  let succeeded = 0;
  let failed = 0;

  for (const item of all) {
    try {
      const response = await fetch(`/api/trips/${item.tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      if (response.ok) {
        await db.delete(OUTBOX_STORE, item.id);
        succeeded++;
        continue;
      }
      const body: unknown = await response.json().catch(() => null);
      const message =
        typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
          ? body.error
          : `送出失敗（HTTP ${response.status}）`;
      await db.put(OUTBOX_STORE, { ...item, lastError: message });
      failed++;
    } catch {
      // 網路依然不通——保留在佇列、不寫 lastError，避免把「暫時性離線」
      // 誤植成「這筆資料本身有問題」
      failed++;
    }
  }

  return { succeeded, failed };
}

interface SyncManagerRegistration extends ServiceWorkerRegistration {
  sync: { register(tag: string): Promise<void> };
}

/** Background Sync 是非標準 API，TypeScript 標準庫沒有型別、Safari 完全不支援；
 * 失敗或不支援時靜默放棄——online 事件與頁面重新可見時的主動檢查是保底機制。
 * `typeof navigator === "undefined"` 這層防禦不是多餘的：這支函式在測試環境
 * （vitest，node 執行環境沒有 navigator/window）也會被真的呼叫到 */
async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("SyncManager" in window)) return;
  try {
    // navigator.serviceWorker.ready 在 SW 還沒完成註冊／啟用時可能長時間
    // 不 resolve（開發模式甚至永遠不會，見 ServiceWorkerRegister.tsx 只在
    // production 註冊），加逾時保護，不能讓這裡無限期掛著
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    await (registration as SyncManagerRegistration).sync.register("sync-outbox");
  } catch {
    // 不支援、逾時、或註冊失敗，交給 OutboxAutoSync 的 online／visibilitychange 保底機制
  }
}
