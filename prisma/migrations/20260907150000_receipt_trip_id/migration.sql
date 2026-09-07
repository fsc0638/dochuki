-- P7.0：Receipt 補上 tripId。
--
-- 手寫而非 `prisma migrate dev` 產生：需要「先加可空欄位 → 回填 → 清孤兒 →
-- 設 NOT NULL」這串自訂步驟，migrate dev 產不出回填 SQL（同 20260901120000
-- 的做法，見 CLAUDE.md 2026-09-01 進度日誌）。

-- 1) 先加可空欄位，既有列才不會因為缺值而擋下 ALTER
ALTER TABLE "Receipt" ADD COLUMN "tripId" TEXT;

-- 2) 已綁支出的收據：歸屬從 Expense.tripId 推回去
UPDATE "Receipt" r
SET "tripId" = e."tripId"
FROM "Expense" e
WHERE r."expenseId" = e."id"
  AND r."tripId" IS NULL;

-- 3) 孤兒收據（上傳後從未建立支出）推不出歸屬，直接刪除。
--    這些是使用者放棄的上傳，沒有行程關聯就永遠不可存取也無法稽核。
--    ⚠️ 磁碟上的原圖不會被這行刪掉（imagePath 指向 RECEIPT_STORAGE_DIR），
--    如有清理需求需另外處理；本次執行時兩個資料庫的 Receipt 皆為 0 筆，
--    實際上是空操作。
DELETE FROM "Receipt" WHERE "tripId" IS NULL;

-- 4) 收斂成必填，之後不可能再出現沒有行程歸屬的收據
ALTER TABLE "Receipt" ALTER COLUMN "tripId" SET NOT NULL;

-- 5) 外鍵與索引
ALTER TABLE "Receipt"
  ADD CONSTRAINT "Receipt_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Receipt_tripId_idx" ON "Receipt"("tripId");
