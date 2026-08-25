import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * parseReceipt() 的重試/降級邏輯測試（Gemini 版）。
 *
 * 用假的 @google/genai 取代真實 SDK——不需要真實 API key 也不打真的網路
 * 請求，專門驗證「失敗重試一次、兩次都失敗回 null」這條規則本身，不依賴
 * Gemini 服務是否可用。
 */

const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => ({
  // 箭頭函式不能被 `new` 呼叫——mockImplementation 必須是一般函式，才能在
  // gemini.ts 用 `new GoogleGenAI(...)` 建構時正常運作
  GoogleGenAI: vi.fn().mockImplementation(function MockGoogleGenAI() {
    return { models: { generateContent: mockGenerateContent } };
  }),
  // gemini.ts 在建 config 時讀 ThinkingLevel.LOW（真的 SDK 是 runtime enum，
  // 不只是型別）——這裡不提供的話，光是組請求參數就會拋例外，被
  // attemptParse 的 catch 吞掉，mockGenerateContent 永遠不會被呼叫到
  ThinkingLevel: { LOW: "LOW" },
}));

const { parseReceipt } = await import("@/lib/parse/gemini");

const VALID_OUTPUT = {
  store: "セブンイレブン",
  store_zh: "7-11",
  address: null,
  datetime: null,
  currency: "JPY",
  payment_method: null,
  items: [],
  subtotal: null,
  tax: [],
  total: 150,
  confidence: { store: 0.9, datetime: 0.5, currency: 0.9, total: 0.9, items: 0.9, tax: 0.9 },
};

function successResponse(output: unknown) {
  return {
    text: JSON.stringify(output),
    candidates: [{ finishReason: "STOP" }],
  };
}

beforeEach(() => {
  mockGenerateContent.mockReset();
  process.env.GEMINI_API_KEY = "test-key";
});

// ★ 必須是本檔第一個真正執行的測試：gemini.ts 把 client 快取在模組層級
// （getClient() 只在 cachedClient 為 null 時才檢查 GEMINI_API_KEY），一旦
// 任何其他測試成功建立過 client，這裡就測不到「缺 key」的路徑了——不是
// production code 的 bug（正式環境金鑰不會在執行期消失，快取是合理優化，
// 同一套模式跟 lib/db.ts 的 Prisma 單例一致），只是測試順序要小心。
describe("parseReceipt · 缺少 API key（必須排在最前面）", () => {
  it("缺少 GEMINI_API_KEY：兩次嘗試都失敗、回傳 null，不拋出讓呼叫端處理", async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toBeNull();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});

describe("parseReceipt · 成功路徑", () => {
  it("第一次就成功：回傳結果，只呼叫一次", async () => {
    mockGenerateContent.mockResolvedValueOnce(successResponse(VALID_OUTPUT));

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toEqual(VALID_OUTPUT);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});

describe("parseReceipt · 重試一次", () => {
  it("第一次拋出例外（如網路錯誤）：重試一次後成功", async () => {
    mockGenerateContent
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(successResponse(VALID_OUTPUT));

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toEqual(VALID_OUTPUT);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("第一次回應不是合法 JSON：重試一次後成功", async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ text: "not json", candidates: [{ finishReason: "STOP" }] })
      .mockResolvedValueOnce(successResponse(VALID_OUTPUT));

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toEqual(VALID_OUTPUT);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("第一次回應不符 schema（少必填欄位）：重試一次後成功", async () => {
    const { total: _total, ...invalid } = VALID_OUTPUT;
    mockGenerateContent
      .mockResolvedValueOnce(successResponse(invalid))
      .mockResolvedValueOnce(successResponse(VALID_OUTPUT));

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toEqual(VALID_OUTPUT);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("第一次遭安全機制擋下（finishReason: SAFETY）：視為失敗，重試後成功", async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ text: "", candidates: [{ finishReason: "SAFETY" }] })
      .mockResolvedValueOnce(successResponse(VALID_OUTPUT));

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toEqual(VALID_OUTPUT);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("第一次提示詞整個被安全機制擋下（promptFeedback.blockReason）：視為失敗，重試後成功", async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] })
      .mockResolvedValueOnce(successResponse(VALID_OUTPUT));

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toEqual(VALID_OUTPUT);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });
});

describe("parseReceipt · 兩次都失敗 → 降級為 null", () => {
  it("兩次都拋出例外：回傳 null，不拋出，只呼叫兩次", async () => {
    mockGenerateContent
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ETIMEDOUT"));

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("兩次都不符 schema：回傳 null", async () => {
    const { total: _total, ...invalid } = VALID_OUTPUT;
    mockGenerateContent
      .mockResolvedValueOnce(successResponse(invalid))
      .mockResolvedValueOnce(successResponse(invalid));

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("兩次都被安全機制擋下：回傳 null", async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ text: "", candidates: [{ finishReason: "SAFETY" }] })
      .mockResolvedValueOnce({ text: "", candidates: [{ finishReason: "SAFETY" }] });

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });
});
