import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { receiptStorageDir } from "@/lib/receipts/write";

/**
 * 收據原圖的保存期限（P9，2026-09-08 使用者裁示：拍完 24 小時後自動刪除）。
 *
 * **只刪磁碟上的圖檔，不刪 Receipt 資料列。** 解析結果（`parseJson`）與由它
 * 建出的品項、金額都要留著——那才是帳務資料；原圖的用途是「入帳當下讓人核對」，
 * 過了就沒有保存的必要，反而是隱私負擔（CLAUDE.md 已禁止把收據圖檔寫進 log，
 * 長期堆在磁碟上是同一個顧慮）。
 *
 * 兩個已知的降級行為，都不是錯誤：
 *   - PDF 報表的收據縮圖索引會顯示「原圖遺失」（`export/pdf/render.ts` 本來
 *     就會接住讀取失敗，不讓整份報表產不出來）
 *   - 「重新解析」會回「找不到原始圖檔，無法重新解析」
 * 也就是說：**要重新解析請在 24 小時內做**。
 */
export const RECEIPT_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface PurgeResult {
  /** 實際刪掉的檔案數 */
  deleted: number;
  /** 已經不在磁碟上（先前刪過或從未寫入）而跳過的 */
  alreadyGone: number;
  /** 刪除失敗的檔案數（權限、IO 錯誤） */
  failed: number;
  /** 磁碟上有、但沒有任何 Receipt 列指向它的孤兒檔 */
  orphanFiles: number;
}

/**
 * 刪除超過保存期限的收據原圖。可重複執行。
 *
 * 以 `Receipt.createdAt` 為準而不是檔案的 mtime——前者是「這張收據何時被拍下
 * 上傳」的權威紀錄，檔案時間會被備份、搬移、還原等操作改掉。
 */
export async function purgeExpiredReceiptImages(now: Date = new Date()): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - RECEIPT_RETENTION_MS);
  const dir = receiptStorageDir();

  const expired = await prisma.receipt.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, imagePath: true },
  });

  let deleted = 0;
  let alreadyGone = 0;
  let failed = 0;

  for (const receipt of expired) {
    try {
      await unlink(path.join(dir, receipt.imagePath));
      deleted++;
    } catch (error) {
      // ENOENT 是正常的：這支函式會被反覆執行，同一張圖第二次就已經不在了。
      // 刻意不清空 imagePath 欄位——保留檔名有助於日後追查「這筆帳的原圖
      // 曾經存在、叫什麼名字」，而讀取端本來就都會接住 ENOENT
      if ((error as NodeJS.ErrnoException).code === "ENOENT") alreadyGone++;
      else failed++;
    }
  }

  return { deleted, alreadyGone, failed, orphanFiles: await countOrphanFiles(dir) };
}

/**
 * 數一數磁碟上有幾個檔案沒有對應的 Receipt 列。
 *
 * 這種孤兒檔的來源：上傳成功寫了檔，但建立 Receipt 列失敗；或是行程／支出被
 * 刪除時連帶刪掉 Receipt 列。**只計數不刪除**——自動刪除「資料庫裡沒有紀錄
 * 的檔案」風險太高（例如有人手動放了東西進來），先讓數字浮出來，真的有累積
 * 再決定怎麼處理。
 */
async function countOrphanFiles(dir: string): Promise<number> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return 0; // 目錄還不存在（從未上傳過收據）
  }

  const known = new Set(
    (await prisma.receipt.findMany({ select: { imagePath: true } })).map((r) => r.imagePath),
  );

  let orphans = 0;
  for (const name of files) {
    if (known.has(name)) continue;
    try {
      if ((await stat(path.join(dir, name))).isFile()) orphans++;
    } catch {
      // 剛好在這個瞬間被刪掉，忽略
    }
  }
  return orphans;
}
