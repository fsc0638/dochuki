import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * 離線佇列的 IndexedDB 結構。範圍刻意只有「新增支出」——這是唯一支援
 * 離線的操作，見 CLAUDE.md 進度日誌的取捨說明。
 *
 * `public/sw.js` 的 background sync 處理常式需要操作同一個資料庫，但
 * Service Worker 是純手寫、未打包的 JS 檔案，沒辦法 import 這裡的 idb
 * 套件——那邊改用原生 IndexedDB API 手寫一份等價的存取邏輯，DB_NAME／
 * DB_VERSION／OUTBOX_STORE 三個常數必須跟這裡完全一致，否則兩邊會各自
 * 開出不同的資料庫。
 */

export const DB_NAME = "dochuki-offline";
export const DB_VERSION = 1;
export const OUTBOX_STORE = "outbox";
export const OUTBOX_TRIP_INDEX = "by-tripId";

export interface OutboxExpenseRecord {
  /** 本地產生的 uuid，純粹當 IndexedDB 的 key，跟伺服器端的 Expense.id 無關 */
  id: string;
  tripId: string;
  /** parseExpenseFormData() 的輸出——跟線上路徑送給 ExpenseFormSchema 驗證的是同一種形狀 */
  payload: unknown;
  /** client 端記錄的建立時間（ISO 字串），純顯示用途，不是衝突判斷依據——
   * 這次範圍只做「新增」，不存在覆蓋既有資料的情境，不需要版本欄位 */
  createdAt: string;
  /** 補送失敗時的錯誤訊息，供 UI 顯示；純網路不通造成的失敗不寫這欄，見 outbox.ts */
  lastError?: string;
}

interface DochukiOfflineDB extends DBSchema {
  [OUTBOX_STORE]: {
    key: string;
    value: OutboxExpenseRecord;
    indexes: { [OUTBOX_TRIP_INDEX]: string };
  };
}

let dbPromise: Promise<IDBPDatabase<DochukiOfflineDB>> | undefined;

/** lazy init——SSR 階段沒有 indexedDB 這個全域物件，只能在真正的 client 端呼叫時才開連線 */
export function getOfflineDb(): Promise<IDBPDatabase<DochukiOfflineDB>> {
  dbPromise ??= openDB<DochukiOfflineDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
      store.createIndex(OUTBOX_TRIP_INDEX, "tripId");
    },
  });
  return dbPromise;
}

/** 僅供測試使用：關閉現有連線並清掉快取，讓下次 getOfflineDb() 重新開一個
 * 乾淨連線。一定要先 close() 底層連線再清變數——只清變數的話連線本身仍
 * 算開著，後續 indexedDB.deleteDatabase() 會卡住等它關閉，永遠等不到 */
export async function resetOfflineDbForTests(): Promise<void> {
  if (dbPromise !== undefined) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = undefined;
}
