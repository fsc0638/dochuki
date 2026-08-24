import { prisma } from "@/lib/db";
import {
  LOW_CONFIDENCE_THRESHOLD,
  ReceiptParseSchema,
  type ReceiptConfidenceField,
  type ReceiptParseOutput,
} from "@/lib/schemas/receipt";

export async function loadReceipt(receiptId: string) {
  return prisma.receipt.findUnique({ where: { id: receiptId } });
}

/**
 * 把 Receipt.parseJson（存進 DB 時已型別抹平成 JsonValue）還原成
 * ReceiptParseOutput，並重新過 zod 驗證——資料庫內容不可信任是「送進去時
 * 驗過的那份」，讀回來一樣要驗一次。驗不過視同沒有解析結果。
 */
export function parseReceiptJson(parseJson: unknown): ReceiptParseOutput | null {
  if (parseJson === null || parseJson === undefined) return null;
  const result = ReceiptParseSchema.safeParse(parseJson);
  return result.success ? result.data : null;
}

/** confidence < 0.8 的欄位集合，供確認表單標紅使用 */
export function lowConfidenceFields(
  parsed: ReceiptParseOutput,
): Set<ReceiptConfidenceField> {
  const fields = Object.entries(parsed.confidence).filter(
    ([, score]) => score < LOW_CONFIDENCE_THRESHOLD,
  );
  return new Set(fields.map(([field]) => field as ReceiptConfidenceField));
}
