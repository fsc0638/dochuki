import { prisma } from "@/lib/db";
import {
  LOW_CONFIDENCE_THRESHOLD,
  ReceiptParseSchema,
  type ReceiptConfidenceField,
  type ReceiptParseOutput,
} from "@/lib/schemas/receipt";

/**
 * 依 id 讀一張收據，並確認它屬於指定的行程。
 *
 * P7.0 之前只吃 receiptId 全域查找，`/trips/[id]/expenses/new?receiptId=xxx`
 * 的 receiptId 直接來自網址，等於可以把 A 行程的收據帶進 B 行程消費掉它的
 * 品項與金額（CLAUDE.md 2026-08-24 記過這個限制，當時只靠 cuid 不可猜測性
 * 擋著）。tripId 現在是 Receipt 的欄位，可以在同一次查詢裡比對。
 */
export async function loadReceipt(tripId: string, receiptId: string) {
  return prisma.receipt.findFirst({ where: { id: receiptId, tripId } });
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
