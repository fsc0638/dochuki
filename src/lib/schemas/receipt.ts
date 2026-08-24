import { z } from "zod";
import { EXPENSE_CATEGORIES } from "@/lib/constants";

/**
 * 收據解析輸出 schema。依 docs/IMPLEMENTATION.md §5.2，但 `confidence`
 * 欄位從開放式的 `z.record(...)` 改成固定欄位的 object。
 *
 * 原因：這個 schema 要餵給 Anthropic API 的 Structured Outputs
 * （`output_config.format` via `zodOutputFormat`），該功能要求每個 object
 * 都要能編譯成 `additionalProperties: false` 的 JSON Schema——開放 key 的
 * record 天生不相容。改成固定欄位剛好對齊 §5.3 提示詞第 9 條本來就寫死的
 * 六個 key（store/datetime/currency/total/items/tax），schema 反而更精確。
 *
 * 另外 Structured Outputs 不支援數值/字串的邊界約束（min/max/length），
 * SDK 會把這些從送給 API 的 schema 中拿掉、但仍在收到回應後於本機（此檔）
 * 驗證一次——所以 `.min(0).max(1)`、`.positive()` 等約束保留，只是不保證
 * 生成當下就守住，退化成「生成後驗證失敗 → 觸發重試」的角色，跟系統設計
 * 的「失敗重試一次後降級手動」完全吻合，不衝突。
 */

const ConfidenceScore = z.number().min(0).max(1);

export const ReceiptLineItemParse = z.object({
  name_raw: z.string(),
  name_zh: z.string().nullable(),
  qty: z.number().positive().default(1),
  unit_price: z.number().nullable(),
  amount: z.number(),
  tax_rate: z.union([z.literal(0.08), z.literal(0.1)]).nullable(),
  category: z.enum(EXPENSE_CATEGORIES).nullable(),
});
export type ReceiptLineItemParseOutput = z.infer<typeof ReceiptLineItemParse>;

export const ReceiptTaxParse = z.object({
  rate: z.number(),
  amount: z.number(),
  mode: z.enum(["內稅(税込)", "外稅(税抜)"]).nullable(),
});

export const ReceiptParseSchema = z.object({
  store: z.string().nullable(),
  store_zh: z.string().nullable(),
  address: z.string().nullable(),
  datetime: z.string().datetime({ offset: true }).nullable(),
  currency: z.string().length(3).nullable(),
  payment_method: z.string().nullable(),
  items: z.array(ReceiptLineItemParse),
  subtotal: z.number().nullable(),
  tax: z.array(ReceiptTaxParse),
  total: z.number(),
  confidence: z.object({
    store: ConfidenceScore,
    datetime: ConfidenceScore,
    currency: ConfidenceScore,
    total: ConfidenceScore,
    items: ConfidenceScore,
    tax: ConfidenceScore,
  }),
});
export type ReceiptParseOutput = z.infer<typeof ReceiptParseSchema>;

/** confidence 物件的 key，供確認頁決定哪個表單欄位要標紅使用 */
export type ReceiptConfidenceField = keyof ReceiptParseOutput["confidence"];

export const LOW_CONFIDENCE_THRESHOLD = 0.8;

/**
 * 人工標註的正確答案格式（§5.4 評估集用）。就是 ReceiptParseSchema 拿掉
 * confidence——人工標註的東西不需要信心分數，它本身就是信心 1.0 的正確答案。
 */
export const ReceiptGroundTruthSchema = ReceiptParseSchema.omit({
  confidence: true,
});
export type ReceiptGroundTruth = z.infer<typeof ReceiptGroundTruthSchema>;
