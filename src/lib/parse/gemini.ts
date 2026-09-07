import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { RECEIPT_PARSE_PROMPT, RECEIPT_PARSE_PROMPT_FROM_TEXT } from "@/lib/parse/prompt";
import { ReceiptParseSchema, type ReceiptParseOutput } from "@/lib/schemas/receipt";

/**
 * 收據解析呼叫端（Gemini 版，取代原本的 Anthropic 實作——2026-08-25 使用者
 * 裁示改用 Gemini，見 CLAUDE.md 進度日誌）。依 docs/IMPLEMENTATION.md §5.3
 * 的抽取規則，呼叫方式改走 Google GenAI SDK：
 *
 * 1. 模型見下方 `MODEL` 常數的說明。**2026-09-07 從 pro 改為 flash**——pro
 *    系列在免費方案的額度是零，實測會回 429 且完全靜默地失敗。改成可用
 *    `GEMINI_MODEL` 環境變數覆寫，開通付費後不必重新建置就能換回 pro。
 * 2. 結構化輸出用 `responseJsonSchema`（吃標準 JSON Schema）＋ Zod v4 內建的
 *    `z.toJSONSchema()`，直接重用 `ReceiptParseSchema`，不必手刻第二份
 *    schema。但 Gemini 對 JSON Schema 只支援子集，`z.toJSONSchema()` 產出的
 *    `pattern`（datetime 的 ISO 8601 正則）與 `const`（tax_rate 的 0.08/0.1
 *    literal union）查證後風險最高，故經 `sanitizeSchemaForGemini()` 收斂：
 *    `pattern` 直接拿掉（生成時不強制格式，靠下面第 5 點的本機驗證兜底）、
 *    `const` union 收斂成語意相同但支援度一致的 `enum`。`additionalProperties`
 *    / `minimum` / `maximum` 各方文件一致列為支援，原樣送出。
 * 3. Gemini 3 系列（flash 與 pro 皆然）**無法關閉 thinking**，且 thinking
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
/**
 * 使用的模型。
 *
 * 預設是 **flash 而不是 pro**。原本寫 `gemini-3.1-pro-preview`，2026-09-07
 * 用第一張真實日文收據實測時整條解析靜默失敗，追下去是 HTTP 429：
 *
 *   Quota exceeded for metric:
 *   generativelanguage.googleapis.com/generate_content_free_tier_input_token_count,
 *   limit: 0
 *
 * 關鍵是 **limit: 0**——pro 系列在免費方案的額度是零，不是「用完了」而是
 * 「根本不開放」，要開通付費才叫得動。金鑰有效、`models` 清單裡也列得出這個
 * 模型，所以事前的所有檢查都會過，只有真的送出請求才撞得到。
 *
 * 同一張圖換 `gemini-3-flash-preview` 立刻成功（finishReason STOP、通過 zod、
 * 抽出 8 個品項），所以預設改成它。
 *
 * 之後若開通付費想換回 pro，設環境變數 `GEMINI_MODEL` 即可，不必重新建置。
 */
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
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

/**
 * 記錄解析失敗的**原因類別**，不記內容。
 *
 * 為什麼要有這個：原本五條失敗路徑全部靜默 `return null`，理由是
 * 「訊息裡可能夾帶請求內容」。但這讓 2026-09-07 那次真實收據失敗完全
 * 無法診斷——畫面只說「解析失敗」，容器日誌一片空白，最後是把原圖撈出來
 * 逐條路徑重現才發現是 HTTP 429 免費額度為零。那是純粹的維運問題，
 * 使用者與維運者都該當場知道。
 *
 * 安全性：這裡只印**類別與代碼**——HTTP 狀態碼、Google 的錯誤列舉
 * （RESOURCE_EXHAUSTED／PERMISSION_DENIED 之類）、finishReason、zod 的
 * 欄位路徑。**不印**收據圖、回應正文、欄位值，符合 CLAUDE.md「禁止把收據
 * 圖檔或解析結果寫進 log」——那條禁的是內容，不是「這次為什麼失敗」。
 */
function logParseFailure(stage: string, detail: string): void {
  console.warn(`[parse] Gemini 解析失敗 stage=${stage} ${detail}`);
}

/** 從 SDK 例外抽出狀態碼與 Google 的錯誤列舉，兩者都不含請求內容 */
function describeApiError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = /"code"\s*:\s*(\d+)/.exec(message)?.[1] ?? "?";
  const status = /"status"\s*:\s*"([A-Z_]+)"/.exec(message)?.[1] ?? "?";
  // 額度為零與額度用完是兩件事，訊息裡的 limit 值分得出來，特別標示
  const zeroQuota = /limit:\s*0\b/.test(message) ? " hint=此模型在目前方案額度為零，需開通付費或改用其他模型" : "";
  return `httpStatus=${code} apiStatus=${status}${zeroQuota}`;
}

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
  } catch (error) {
    // 網路錯誤、rate limit、4xx/5xx 都會走到這裡。仍然吞掉例外不往上拋
    // （呼叫端只需要知道「這次沒拿到結果」），但**記下原因類別**——
    // 少了這行，429 這種純維運問題會完全看不見，見 logParseFailure 的說明。
    logParseFailure("api", describeApiError(error));
    return null;
  }

  // 提示詞本身在生成開始前就被安全機制整個擋下
  if (response.promptFeedback?.blockReason !== undefined) {
    logParseFailure("blocked", `blockReason=${response.promptFeedback.blockReason}`);
    return null;
  }

  // 只信任正常結束（STOP）的回應；SAFETY/RECITATION/MAX_TOKENS 等其餘
  // finishReason 一律視為這次嘗試失敗——包含 MAX_TOKENS：這個模型會思考，
  // token 用超本來就可能發生，跟安全機制擋下一樣沒有可信的部分結果可用。
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason !== "STOP") {
    // MAX_TOKENS 與 SAFETY 分得出來了：前者要調 maxOutputTokens 或壓低
    // thinking，後者是內容被擋，兩種處置完全不同
    logParseFailure("finish", `finishReason=${finishReason ?? "(無)"}`);
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(response.text ?? "");
  } catch {
    // 只記長度不記內容——長度就足以判斷是「空回應」還是「被截斷」
    logParseFailure("json", `responseLength=${response.text?.length ?? 0}`);
    return null;
  }

  const result = ReceiptParseSchema.safeParse(raw);
  if (!result.success) {
    // 只記欄位路徑與規則代碼，不記值——足以判斷是模型少給欄位還是格式不符
    const paths = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(根)"}:${issue.code}`)
      .slice(0, 8)
      .join(" ");
    logParseFailure("schema", `issues=${paths}`);
    return null;
  }
  return result.data;
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
