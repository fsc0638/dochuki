import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_NAME, resetOfflineDbForTests } from "@/lib/offline/db";
import { listOutboxForTrip, saveExpenseToOutbox, syncOutbox } from "@/lib/offline/outbox";

/** fake-indexeddb 沒有內建「清空所有資料庫」的 API，用 deleteDatabase 讓
 * 每個測試從乾淨狀態開始；resetOfflineDbForTests() 清掉 outbox.ts 模組
 * 內快取的連線 promise，否則刪掉資料庫後 getOfflineDb() 仍會回傳指向舊
 * 連線的 promise */
beforeEach(async () => {
  await resetOfflineDbForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveExpenseToOutbox / listOutboxForTrip", () => {
  it("存入後可以讀回同一個 trip 的項目", async () => {
    await saveExpenseToOutbox("trip-1", { description: "拉麵", amountOriginal: "1000" });
    const items = await listOutboxForTrip("trip-1");
    expect(items).toHaveLength(1);
    expect(items[0].tripId).toBe("trip-1");
    expect(items[0].payload).toEqual({ description: "拉麵", amountOriginal: "1000" });
    expect(typeof items[0].id).toBe("string");
    expect(typeof items[0].createdAt).toBe("string");
  });

  it("不同 trip 的項目互相隔離", async () => {
    await saveExpenseToOutbox("trip-1", { description: "A" });
    await saveExpenseToOutbox("trip-2", { description: "B" });
    const trip1Items = await listOutboxForTrip("trip-1");
    const trip2Items = await listOutboxForTrip("trip-2");
    expect(trip1Items).toHaveLength(1);
    expect(trip2Items).toHaveLength(1);
    expect(trip1Items[0].payload).toEqual({ description: "A" });
  });
});

describe("syncOutbox", () => {
  it("送出成功時從佇列移除", async () => {
    await saveExpenseToOutbox("trip-1", { description: "拉麵" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "e1" }), { status: 200 })),
    );

    const result = await syncOutbox();

    expect(result).toEqual({ succeeded: 1, failed: 0 });
    expect(await listOutboxForTrip("trip-1")).toHaveLength(0);
  });

  it("伺服器回傳錯誤時保留在佇列並記錄 lastError", async () => {
    await saveExpenseToOutbox("trip-1", { description: "拉麵" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ error: "行程不存在" }), { status: 404 })),
    );

    const result = await syncOutbox();

    expect(result).toEqual({ succeeded: 0, failed: 1 });
    const items = await listOutboxForTrip("trip-1");
    expect(items).toHaveLength(1);
    expect(items[0].lastError).toBe("行程不存在");
  });

  it("網路完全不通時保留在佇列，且不寫入 lastError（跟資料本身有問題要分開）", async () => {
    await saveExpenseToOutbox("trip-1", { description: "拉麵" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const result = await syncOutbox();

    expect(result).toEqual({ succeeded: 0, failed: 1 });
    const items = await listOutboxForTrip("trip-1");
    expect(items).toHaveLength(1);
    expect(items[0].lastError).toBeUndefined();
  });

  it("多筆情境：一筆失敗不影響其他筆的處理", async () => {
    await saveExpenseToOutbox("trip-1", { description: "A" });
    await saveExpenseToOutbox("trip-1", { description: "B" });
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
        }
        return Promise.reject(new TypeError("network error"));
      }),
    );

    const result = await syncOutbox();

    expect(result).toEqual({ succeeded: 1, failed: 1 });
    expect(await listOutboxForTrip("trip-1")).toHaveLength(1);
  });
});
