import { z } from "zod";

/**
 * PaddleOCR sidecar（`services/ocr-sidecar/`）呼叫端。跟 `gemini.ts` 同一份
 * 合約：任何失敗都回傳 `null`，絕不拋出，由呼叫端（`orchestrator.ts`）決定
 * 要不要降級到 Gemini。
 *
 * `OCR_SIDECAR_URL` 未設定時直接回 null、連 fetch 都不打——這讓本機
 * `pnpm dev`（只起 `docker compose up -d db`，沒有 sidecar 容器）的行為
 * 與加這支模組之前完全一致，零 opt-in 成本。
 */

const FieldResultSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({ value: valueSchema.nullable(), confidence: z.number().min(0).max(1) });

const TaxEntrySchema = z.object({
  rate: z.number(),
  // 內稅/外稅只憑關鍵字判斷、附近沒有配對到金額時，tax.py 會誠實回傳
  // amount: null（不捏造）——這裡若沒有 .nullable()，整包回應（含已經
  // 抽對的 store/total/currency）都會因為這一個欄位驗證失敗而被
  // safeParse 判定失敗、整個 sidecar 結果被丟棄退回 Gemini，等於讓最
  // 常見的日本稅制標示（税込/内税）系統性地讓快速路徑失效（對抗式審查
  // 抓到的問題）
  amount: z.number().nullable(),
  mode: z.enum(["內稅(税込)", "外稅(税抜)"]).nullable(),
});

export const SidecarExtractResponseSchema = z.object({
  raw_text: z.string(),
  ocr_confidence_mean: z.number().min(0).max(1),
  fields: z.object({
    store: FieldResultSchema(z.string()),
    datetime: FieldResultSchema(z.string()),
    currency: FieldResultSchema(z.string()),
    total: FieldResultSchema(z.number()),
    // tax 不比照其他欄位用 nullable——「沒找到」的表示法是空陣列，不是 null
    // （見 services/ocr-sidecar 的 tax.py：找不到就回 []，不強加一個假的
    // null 語意），這樣 orchestrator.ts 组 buildSingleChargeOutput() 時
    // ReceiptParseSchema 的 tax: z.array(...)（非 nullable）才對得上
    tax: z.object({ value: z.array(TaxEntrySchema), confidence: z.number().min(0).max(1) }),
  }),
  classification: z.object({
    type: z.enum(["single_charge", "itemized", "unknown"]),
    confidence: z.number().min(0).max(1),
    price_token_count: z.number().int().min(0),
  }),
});
export type SidecarExtractResponse = z.infer<typeof SidecarExtractResponseSchema>;

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * `Number(undefined ?? DEFAULT_TIMEOUT_MS)` 這種寫法有兩個安靜的失敗模式
 * （對抗式審查抓到的問題）：非數字字串（如 "abc"）會被 `Number()` 轉成
 * `NaN`，`setTimeout` 對 `NaN` 不會拋錯，只會把逾時鐘壓到近乎 0ms 立刻
 * 觸發；空字串 `""` 不會被 `??` 攔到（`??` 只認 null/undefined），
 * `Number("")` 又剛好等於 0，同樣立刻觸發。兩種都會讓每次呼叫 sidecar
 * 都幾乎瞬間逾時、永遠降級到 Gemini，卻沒有任何錯誤訊號能看出是環境變數
 * 設錯——這裡明確擋掉這兩種輸入，退回預設值。
 */
function resolveTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export interface ExtractViaSidecarArgs {
  imageBuffer: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export async function extractViaSidecar(
  args: ExtractViaSidecarArgs,
): Promise<SidecarExtractResponse | null> {
  const baseUrl = process.env.OCR_SIDECAR_URL;
  if (baseUrl === undefined || baseUrl === "") return null;

  const timeoutMs = resolveTimeoutMs(process.env.OCR_SIDECAR_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const formData = new FormData();
    formData.append(
      "image",
      new Blob([new Uint8Array(args.imageBuffer)], { type: args.mediaType }),
      "receipt",
    );

    const response = await fetch(`${baseUrl}/extract`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const raw: unknown = await response.json();
    const result = SidecarExtractResponseSchema.safeParse(raw);
    return result.success ? result.data : null;
  } catch {
    // 連線失敗、逾時（AbortController）、JSON 解析失敗——一律視為
    // 「這次沒拿到結果」，交給 orchestrator 降級到 Gemini
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
