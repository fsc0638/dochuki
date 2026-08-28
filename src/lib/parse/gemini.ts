import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { RECEIPT_PARSE_PROMPT, RECEIPT_PARSE_PROMPT_FROM_TEXT } from "@/lib/parse/prompt";
import { ReceiptParseSchema, type ReceiptParseOutput } from "@/lib/schemas/receipt";

/**
 * 收據解析呼叫端（Gemini 版，取代原本的 Anthropic 實作——2026-08-25 使用者
 * 裁示改用 Gemini，見 CLAUDE.md 進度日誌）。依 docs/IMPLEMENTATION.md §5.3
 * 的抽取規則，呼叫方式改走 Google GenAI SDK：
 *
 * 1. 模型用 `gemini-3.1-pro-preview`——目前 Gemini 3 系列唯一的 Pro 檔位
 *    （2026-08 查證，前代 `gemini-3-pro-preview` 已於 2026-03-09 停用）。這是
 *    preview 模型，Google 有前例會在數月後汰換，之後若這個 ID 失效，只需要
 *    改這個常數，不動其餘程式碼。
 * 2. 結構化輸出用 `responseJsonSchema`（吃標準 JSON Schema）＋ Zod v4 內建的
 *    `z.toJSONSchema()`，直接重用 `ReceiptParseSchema`，不必手刻第二份
 *    schema。但 Gemini 對 JSON Schema 只支援子集，`z.toJSONSchema()` 產出的
 *    `pattern`（datetime 的 ISO 8601 正則）與 `const`（tax_rate 的 0.08/0.1
 *    literal union）查證後風險最高，故經 `sanitizeSchemaForGemini()` 收斂：
 *    `pattern` 直接拿掉（生成時不強制格式，靠下面第 5 點的本機驗證兜底）、
 *    `const` union 收斂成語意相同但支援度一致的 `enum`。`additionalProperties`
 *    / `minimum` / `maximum` 各方文件一致列為支援，原樣送出。
 * 3. Gemini 3 系列（含這裡用的 Pro 檔位）**無法關閉 thinking**，且 thinking
 *    token 會跟輸出 token 共用 `maxOutputTokens` 額度——查證後這是已知的
 *    truncation 地雷（thinking 用完額度、正文被截斷，`finishReason` 變成
 *    `MAX_TOKENS`）。應對：`thinkingConfig.thinkingLevel: "LOW"` 把 thinking
 *    壓到最低（Gemini 3 用 `thinkingLevel`，不是 2.5 系列的
 *    `thinkingBudget`，兩者不能同時給，否則 400），且 `maxOutputTokens` 從
 *    Anthropic 版沿用的 2000 上調到 8000——這個舊值是針對 Anthropic
 *    非-thinking 模型設的，直接套在會思考的 Gemini 模型上大機率不夠。
 * 4. 補上 `httpOptions.retryOptions`：`@google/genai` 不像 Anthropic SDK
 *    預設就對 429/5xx 自動重試——這個欄位不給的話完全不重試，查過
 *    SDK 原始碼確認。這裡顯式開 2 次嘗試，跟 Anthropic 版 `max_retries`
 *    預設值同量級，避免瞬時錯誤把 `parseReceipt()` 外層僅有的一次重試
 *    機會提早用掉。
 * 5. 跟 Anthropic 的 `client.messages.parse()` 不同，這個路徑不會自動把回應
 *    驗證成型別安全的物件——`response.text` 拿到的是純文字，必須自己
 *    `JSON.parse()` 再過一次 `ReceiptParseSchema.safeParse()`。驗證失敗一律
 *    當作這次嘗試失敗（回 null），跟原本「Structured Outputs 驗證不過」的
 *    角色一致，不影響外層 `parseReceipt()` 的重試/降級邏輯。
 */
const MODEL = "gemini-3.1-pro-preview";
const MAX_OUTPUT_TOKENS = 8000;

// 跟 src/lib/db.ts 的 Prisma 單例同一套理由：掛在 globalThis 上才能撐過
// Next.js dev 模式的 HMR 重新載入，否則每次存檔都會重建一個新的 client。
const globalForGemini = globalThis as unknown as { geminiClient?: GoogleGenAI };

function getClient(): GoogleGenAI {
  if (globalForGemini.geminiClient === undefined) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey === undefined || apiKey === "") {
      throw new Error("缺少環境變數 GEMINI_API_KEY（複製 .env.example 成 .env 並填入）");
    }
    globalForGemini.geminiClient = new GoogleGenAI({ apiKey });
  }
  return globalForGemini.geminiClient;
}

export interface ParseReceiptArgs {
  /** 圖片內容，base64 編碼（不含 data URL 前綴） */
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface ParseReceiptFromTextArgs {
  /** PaddleOCR sidecar 抽出的原始 OCR 文字（見 orchestrator.ts） */
  ocrText: string;
}

/**
 * 收斂 `z.toJSONSchema()` 產出中，Gemini `responseJsonSchema` 查證後判定
 * 風險最高的關鍵字（見上方模組註解第 2 點）。只處理這裡實際會遇到的兩種
 * 形狀，不追求通用 JSON Schema 轉換器的完整度。
 */
function sanitizeSchemaForGemini(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchemaForGemini);
  if (node === null || typeof node !== "object") return node;

  // z.union([z.literal(a), z.literal(b), ...]) 編譯成
  // { anyOf: [{type, const: a}, {type, const: b}, ...] }，收斂成同型別的
  // 單一 enum。
  const anyOf = (node as { anyOf?: unknown[] }).anyOf;
  if (Array.isArray(anyOf) && anyOf.length > 0 && anyOf.every(isConstBranch)) {
    return { type: anyOf[0].type, enum: anyOf.map((branch) => branch.const) };
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "pattern") continue;
    cleaned[key] = sanitizeSchemaForGemini(value);
  }
  return cleaned;
}

function isConstBranch(branch: unknown): branch is { type: string; const: unknown } {
  return (
    typeof branch === "object" &&
    branch !== null &&
    "const" in branch &&
    "type" in branch &&
    Object.keys(branch).length === 2
  );
}

const RESPONSE_JSON_SCHEMA = sanitizeSchemaForGemini(z.toJSONSchema(ReceiptParseSchema));

async function attemptParseWithContents(
  contents: Array<{ inlineData: { data: string; mimeType: string } } | { text: string }>,
): Promise<ReceiptParseOutput | null> {
  let response;
  try {
    // getClient() 必須在 try 裡面：缺 GEMINI_API_KEY 時它會同步拋出，若擺在
    // try 外面，這個失敗就不會走「重試一次後降級為 null」的路徑，而是直接
    // 把例外丟給呼叫端，等同讓整個拍照流程崩潰（同原 Anthropic 版本的教訓，
    // 見 tests/parse.gemini.test.ts 的「缺少 API key」案例）。
    const client = getClient();
    response = await client.models.generateContent({
      model: MODEL,
      contents,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        httpOptions: { retryOptions: { attempts: 2 } },
      },
    });
  } catch {
    // 網路錯誤、rate limit、4xx/5xx 一律在這裡吞掉，故意不記錄例外細節——
    // 訊息裡可能夾帶請求內容（CLAUDE.md 禁止收據內容進 log）。呼叫端只需要
    // 知道「這次沒拿到結果」，由 parseReceipt 決定要不要再試一次。
    return null;
  }

  // 提示詞本身在生成開始前就被安全機制整個擋下
  if (response.promptFeedback?.blockReason !== undefined) return null;

  // 只信任正常結束（STOP）的回應；SAFETY/RECITATION/MAX_TOKENS 等其餘
  // finishReason 一律視為這次嘗試失敗——包含 MAX_TOKENS：這個模型會思考，
  // token 用超本來就可能發生，跟安全機制擋下一樣沒有可信的部分結果可用。
  if (response.candidates?.[0]?.finishReason !== "STOP") return null;

  let raw: unknown;
  try {
    raw = JSON.parse(response.text ?? "");
  } catch {
    return null;
  }

  const result = ReceiptParseSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * 解析收據圖片。失敗（API 錯誤、schema 驗證不過、安全機制擋下）重試一次；
 * 兩次都失敗回 null。呼叫端必須把 null 視為「降級手動輸入」，不得因此擋住
 * 整個入帳流程。
 */
export async function parseReceipt(
  args: ParseReceiptArgs,
): Promise<ReceiptParseOutput | null> {
  const contents = [
    { inlineData: { data: args.imageBase64, mimeType: args.mediaType } },
    { text: RECEIPT_PARSE_PROMPT },
  ];
  const first = await attemptParseWithContents(contents);
  if (first !== null) return first;
  return attemptParseWithContents(contents);
}

/**
 * 解析 PaddleOCR sidecar 抽出的收據文字（無圖片）——見
 * `orchestrator.ts` 的「OCR 品質夠好時改送文字省 token」路徑。重試邏輯與
 * `parseReceipt` 相同。
 */
export async function parseReceiptFromText(
  args: ParseReceiptFromTextArgs,
): Promise<ReceiptParseOutput | null> {
  const contents = [{ text: `${RECEIPT_PARSE_PROMPT_FROM_TEXT}\n\nOCR text:\n${args.ocrText}` }];
  const first = await attemptParseWithContents(contents);
  if (first !== null) return first;
  return attemptParseWithContents(contents);
}
