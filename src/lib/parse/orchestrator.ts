import { extractViaSidecar, type SidecarExtractResponse } from "@/lib/parse/sidecar";
import { parseReceipt, parseReceiptFromText } from "@/lib/parse/gemini";
import { ReceiptParseSchema, type ReceiptParseOutput } from "@/lib/schemas/receipt";

/**
 * 收據解析路由決策——P6 PaddleOCR sidecar。決策依據見
 * docs/IMPLEMENTATION.md §5.3 對應日期的 blockquote（2026-08-28）：
 *
 * 1. sidecar 判斷 single_charge 且 total／currency 信心達標
 *    → 完全跳過 Gemini，本機組出結果（PADDLE_OCR）。這是唯一真正省下
 *    一次 Gemini 呼叫的路徑——items 需要翻譯與分類，regex 規則引擎做不到，
 *    因此多品項收據一律照跑 Gemini，不接受「未翻譯的品項」這種妥協。
 * 2. 其餘情況呼叫 Gemini：OCR 文字品質夠好時送文字（省輸入 token，效益
 *    有限但真實），否則送原圖（跟這支模組出現前完全一樣的行為）。
 *
 * 門檻常數是推估值，不是拿真實日文收據校準出來的數字——專案至今零真實
 * 收據影像驗證，這個缺口沒有因為多一層 OCR 而縮小，見 CLAUDE.md 進度日誌。
 */

export const SINGLE_CHARGE_CLASSIFICATION_MIN = 0.6;
export const TOTAL_CONFIDENCE_MIN = 0.7;
export const CURRENCY_CONFIDENCE_MIN = 0.6;
export const TEXT_FALLBACK_OCR_QUALITY_MIN = 0.75;
export const TEXT_FALLBACK_MIN_TEXT_LENGTH = 20;

export type ParseEngineUsed = "PADDLE_OCR" | "LLM_VISION";

export interface OrchestrateParseArgs {
  imageBuffer: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface OrchestrateParseResult {
  parsed: ReceiptParseOutput | null;
  engine: ParseEngineUsed;
}

export async function orchestrateParseReceipt(
  args: OrchestrateParseArgs,
): Promise<OrchestrateParseResult> {
  const sidecar = await extractViaSidecar(args);

  if (sidecar !== null && canSkipGemini(sidecar)) {
    const built = buildSingleChargeOutput(sidecar);
    // 不信任自己本機組出來的物件——過一次跟 Gemini 輸出同一套 schema
    // 驗證，驗證不過就照樣落到下面的 Gemini 路徑，不冒險把沒驗證過的
    // 資料存進 DB
    if (ReceiptParseSchema.safeParse(built).success) {
      return { parsed: built, engine: "PADDLE_OCR" };
    }
  }

  const canUseText =
    sidecar !== null &&
    sidecar.ocr_confidence_mean >= TEXT_FALLBACK_OCR_QUALITY_MIN &&
    sidecar.raw_text.length >= TEXT_FALLBACK_MIN_TEXT_LENGTH;

  const parsed = canUseText
    ? await parseReceiptFromText({ ocrText: sidecar.raw_text })
    : await parseReceipt({
        imageBase64: args.imageBuffer.toString("base64"),
        mediaType: args.mediaType,
      });

  return { parsed, engine: "LLM_VISION" };
}

function canSkipGemini(sidecar: SidecarExtractResponse): boolean {
  return (
    sidecar.classification.type === "single_charge" &&
    sidecar.classification.confidence >= SINGLE_CHARGE_CLASSIFICATION_MIN &&
    sidecar.fields.total.value !== null &&
    sidecar.fields.total.confidence >= TOTAL_CONFIDENCE_MIN &&
    sidecar.fields.currency.value !== null &&
    sidecar.fields.currency.confidence >= CURRENCY_CONFIDENCE_MIN
  );
}

function buildSingleChargeOutput(sidecar: SidecarExtractResponse): ReceiptParseOutput {
  // canSkipGemini 已保證 total／currency 非 null，這裡用 as 而非再判斷一次
  const total = sidecar.fields.total.value as number;
  const currency = sidecar.fields.currency.value as string;
  const singleTaxEntry =
    sidecar.fields.tax.value.length === 1 &&
    (sidecar.fields.tax.value[0].rate === 0.08 || sidecar.fields.tax.value[0].rate === 0.1)
      ? (sidecar.fields.tax.value[0].rate as 0.08 | 0.1)
      : null;

  return {
    store: sidecar.fields.store.value,
    store_zh: null,
    address: null,
    datetime: sidecar.fields.datetime.value,
    currency,
    payment_method: null,
    items: [
      {
        name_raw: sidecar.fields.store.value ?? "單筆消費",
        name_zh: null,
        qty: 1,
        unit_price: total,
        amount: total,
        tax_rate: singleTaxEntry,
        category: null,
      },
    ],
    subtotal: null,
    tax: sidecar.fields.tax.value,
    total,
    confidence: {
      store: sidecar.fields.store.confidence,
      datetime: sidecar.fields.datetime.confidence,
      currency: sidecar.fields.currency.confidence,
      total: sidecar.fields.total.confidence,
      items: 0,
      tax: sidecar.fields.tax.confidence,
    },
  };
}
