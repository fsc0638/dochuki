import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { RECEIPT_PARSE_PROMPT } from "@/lib/parse/prompt";
import { ReceiptParseSchema, type ReceiptParseOutput } from "@/lib/schemas/receipt";

/**
 * 收據解析呼叫端。依 docs/IMPLEMENTATION.md §5.3，但兩點與原文不同：
 *
 * 1. 模型：原文寫 `claude-sonnet-4-6`。該 ID 不支援下面用的 Structured
 *    Outputs（見 claude-api 技能文件支援清單），改用同世代、有支援的
 *    `claude-sonnet-5`。§5.3「量大或簡單超商收據可降 claude-haiku-4-5」的
 *    自動降級路由本階段未實作——「先看過才知道是不是簡單收據」判不出
 *    觸發條件，模型字串抽成常數，之後要接手動切換或路由邏輯都不必動這裡
 *    以外的程式碼。
 * 2. 呼叫方式：改用 `client.messages.parse()` + `output_config.format`
 *    （Structured Outputs），不是「提示詞說只能輸出 JSON、之後自己
 *    JSON.parse 再過 zod」。API 端就保證回應符合 schema，比賭 Claude 有沒有
 *    乖乖聽提示詞可靠。提示詞第 1 條「只能輸出 JSON」留著沒壞處，其餘規則
 *    （幣別判斷、令和年份換算、稅制、卡號遮罩）是 Structured Outputs 管不到
 *    的抽取品質規則，仍然需要。
 */
const MODEL = "claude-sonnet-5";

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient === null) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey === undefined || apiKey === "") {
      throw new Error("缺少環境變數 ANTHROPIC_API_KEY（複製 .env.example 成 .env 並填入）");
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

export interface ParseReceiptArgs {
  /** 圖片內容，base64 編碼（不含 data URL 前綴） */
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

async function attemptParse(
  args: ParseReceiptArgs,
): Promise<ReceiptParseOutput | null> {
  let response;
  try {
    // getClient() 必須在 try 裡面：缺 ANTHROPIC_API_KEY 時它會同步拋出，
    // 若擺在 try 外面，這個失敗就不會走「重試一次後降級為 null」的路徑，
    // 而是直接把例外丟給呼叫端，等同讓整個拍照流程崩潰——實測時被
    // tests/parse.anthropic.test.ts 的「缺少 API key」案例抓到。
    const client = getClient();
    response = await client.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      output_config: { format: zodOutputFormat(ReceiptParseSchema) },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: args.mediaType,
                data: args.imageBase64,
              },
            },
            { type: "text", text: RECEIPT_PARSE_PROMPT },
          ],
        },
      ],
    });
  } catch {
    // SDK 已對 429/5xx 自動重試（max_retries 預設 2）；這裡攔到的是重試
    // 耗盡仍失敗，或 400 等不可重試錯誤。故意不記錄錯誤細節——訊息裡可能
    // 夾帶請求內容（CLAUDE.md 禁止收據內容進 log），呼叫端只需要知道
    // 「這次沒拿到結果」，由 parseReceipt 決定要不要再試一次。
    return null;
  }

  // 安全分類器拒答：HTTP 200，但 stop_reason 為 refusal，內容不可信
  if (response.stop_reason === "refusal") return null;

  return response.parsed_output;
}

/**
 * 解析收據圖片。失敗（API 錯誤、schema 驗證不過、refusal）重試一次；
 * 兩次都失敗回 null。呼叫端必須把 null 視為「降級手動輸入」，不得因此
 * 擋住整個入帳流程。
 */
export async function parseReceipt(
  args: ParseReceiptArgs,
): Promise<ReceiptParseOutput | null> {
  const first = await attemptParse(args);
  if (first !== null) return first;
  return attemptParse(args);
}
