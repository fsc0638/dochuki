import path from "node:path";
import { prisma } from "@/lib/db";
import type { ReceiptParseOutput } from "@/lib/schemas/receipt";
import type { Prisma, ParseEngine } from "@/generated/prisma/client";

export function receiptStorageDir(): string {
  const configured = process.env.RECEIPT_STORAGE_DIR ?? "./data/receipts";
  return path.resolve(process.cwd(), configured);
}

/** 依副檔名推斷 media type，供重新解析既有檔案時使用（初次上傳已知道 media type，不需要用到這個） */
export function mediaTypeForPath(
  imagePath: string,
): "image/jpeg" | "image/png" | "image/webp" {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

/**
 * 把一次解析嘗試的結果寫回 Receipt。無論成功失敗都更新 `parsedAt`
 * （代表「嘗試過」）與 `engine`（代表「這次實際用哪個引擎」，見
 * orchestrator.ts 的路由決策——即使這次解析失敗，也如實記錄失敗當下
 * 嘗試過的引擎，不留在建立時的佔位值）；只有成功（非 null）才覆寫
 * parseJson／confidence——失敗不清空既有資料，讓「重新解析」失敗時不會把
 * 先前好不容易拿到的結果沖掉，使用者最壞情況只是白等一次，不會倒退。
 */
export async function persistParseResult(
  receiptId: string,
  parsed: ReceiptParseOutput | null,
  engine: ParseEngine,
): Promise<void> {
  await prisma.receipt.update({
    where: { id: receiptId },
    data: {
      parsedAt: new Date(),
      engine,
      ...(parsed !== null
        ? {
            parseJson: parsed as unknown as Prisma.InputJsonValue,
            confidence: parsed.confidence as unknown as Prisma.InputJsonValue,
          }
        : {}),
    },
  });
}
