import "dotenv/config";
import { prisma } from "../../src/lib/db";
import { purgeExpiredReceiptImages, RECEIPT_RETENTION_MS } from "../../src/lib/receipts/retention";

/**
 * 刪除超過保存期限的收據原圖（P9）。
 *
 *   pnpm receipts:purge
 *
 * 設計成可重複執行且無副作用（同一張圖第二次會是 ENOENT，計入 alreadyGone），
 * 所以掛成定時工作是安全的。正式站由 systemd timer 每小時跑一次，
 * 見 scripts/deploy/install-receipt-purge.sh。
 *
 * **只刪磁碟上的圖，不刪 Receipt 資料列**——解析結果與帳務資料要留著。
 */
async function main(): Promise<void> {
  const hours = RECEIPT_RETENTION_MS / 3_600_000;
  const result = await purgeExpiredReceiptImages();
  console.log(
    `[receipts:purge] 保存期限 ${hours} 小時｜刪除 ${result.deleted}｜` +
      `已不存在 ${result.alreadyGone}｜失敗 ${result.failed}｜孤兒檔 ${result.orphanFiles}`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(`[receipts:purge] 失敗：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
