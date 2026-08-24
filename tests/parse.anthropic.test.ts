import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * parseReceipt() 的重試/降級邏輯測試。
 *
 * 用假的 @anthropic-ai/sdk 取代真實 SDK——不需要真實 API key 也不打真的
 * 網路請求，專門驗證「失敗重試一次、兩次都失敗回 null」這條規則本身，
 * 不依賴 Anthropic 服務是否可用。
 */

const mockParse = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  // 箭頭函式不能被 `new` 呼叫——mockImplementation 必須是一般函式，
  // 才能在 anthropic.ts 用 `new Anthropic(...)` 建構時正常運作
  default: vi.fn().mockImplementation(function MockAnthropic() {
    return { messages: { parse: mockParse } };
  }),
}));

vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: vi.fn().mockReturnValue({ type: "json_schema" }),
}));

const { parseReceipt } = await import("@/lib/parse/anthropic");

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

beforeEach(() => {
  mockParse.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

// ★ 必須是本檔第一個真正執行的測試：anthropic.ts 把 client 快取在模組層級
// （getClient() 只在 cachedClient 為 null 時才檢查 ANTHROPIC_API_KEY），一旦
// 任何其他測試成功建立過 client，這裡就測不到「缺 key」的路徑了——不是
// production code 的 bug（正式環境金鑰不會在執行期消失，快取是合理優化，
// 同一套模式跟 lib/db.ts 的 Prisma 單例一致），只是測試順序要小心。
describe("parseReceipt · 缺少 API key（必須排在最前面）", () => {
  it("缺少 ANTHROPIC_API_KEY：兩次嘗試都失敗、回傳 null，不拋出讓呼叫端處理", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });
});

describe("parseReceipt · 成功路徑", () => {
  it("第一次就成功：回傳結果，只呼叫一次", async () => {
    mockParse.mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: VALID_OUTPUT });

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toEqual(VALID_OUTPUT);
    expect(mockParse).toHaveBeenCalledTimes(1);
  });
});

describe("parseReceipt · 重試一次", () => {
  it("第一次拋出例外（如網路錯誤）：重試一次後成功", async () => {
    mockParse
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: VALID_OUTPUT });

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toEqual(VALID_OUTPUT);
    expect(mockParse).toHaveBeenCalledTimes(2);
  });

  it("第一次 parsed_output 為 null（schema 驗證不過）：重試一次後成功", async () => {
    mockParse
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: null })
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: VALID_OUTPUT });

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toEqual(VALID_OUTPUT);
    expect(mockParse).toHaveBeenCalledTimes(2);
  });

  it("第一次遭安全分類器拒答（stop_reason: refusal）：視為失敗，重試後成功", async () => {
    mockParse
      .mockResolvedValueOnce({ stop_reason: "refusal", parsed_output: null })
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: VALID_OUTPUT });

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toEqual(VALID_OUTPUT);
    expect(mockParse).toHaveBeenCalledTimes(2);
  });
});

describe("parseReceipt · 兩次都失敗 → 降級為 null", () => {
  it("兩次都拋出例外：回傳 null，不拋出，只呼叫兩次", async () => {
    mockParse
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ETIMEDOUT"));

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toBeNull();
    expect(mockParse).toHaveBeenCalledTimes(2);
  });

  it("兩次 parsed_output 都是 null：回傳 null", async () => {
    mockParse
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: null })
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: null });

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toBeNull();
    expect(mockParse).toHaveBeenCalledTimes(2);
  });

  it("兩次都被拒答：回傳 null", async () => {
    mockParse
      .mockResolvedValueOnce({ stop_reason: "refusal", parsed_output: null })
      .mockResolvedValueOnce({ stop_reason: "refusal", parsed_output: null });

    const result = await parseReceipt({ imageBase64: "abc", mediaType: "image/jpeg" });

    expect(result).toBeNull();
    expect(mockParse).toHaveBeenCalledTimes(2);
  });
});
