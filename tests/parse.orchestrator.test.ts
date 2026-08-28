import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptParseSchema } from "@/lib/schemas/receipt";

/**
 * orchestrateParseReceipt() 的路由決策測試——這是 P6 PaddleOCR sidecar
 * 功能的核心分歧點。把 sidecar 與 gemini 兩個呼叫端都換成假的，逐一驗證
 * 每個信心門檻的分歧路徑，不依賴真的 sidecar 容器或 Gemini API。
 */

const mockExtractViaSidecar = vi.fn();
const mockParseReceipt = vi.fn();
const mockParseReceiptFromText = vi.fn();

vi.mock("@/lib/parse/sidecar", () => ({ extractViaSidecar: mockExtractViaSidecar }));
vi.mock("@/lib/parse/gemini", () => ({
  parseReceipt: mockParseReceipt,
  parseReceiptFromText: mockParseReceiptFromText,
}));

const { orchestrateParseReceipt } = await import("@/lib/parse/orchestrator");

const GEMINI_OUTPUT = {
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

function sidecarResponse(overrides: Record<string, unknown> = {}) {
  return {
    raw_text: "セブンイレブン\n合計 ¥150",
    ocr_confidence_mean: 0.9,
    fields: {
      store: { value: "セブンイレブン", confidence: 0.9 },
      datetime: { value: null, confidence: 0 },
      currency: { value: "JPY", confidence: 0.9 },
      total: { value: 150, confidence: 0.9 },
      tax: { value: [], confidence: 0 },
    },
    classification: { type: "single_charge", confidence: 0.8, price_token_count: 1 },
    ...overrides,
  };
}

const ARGS = { imageBuffer: Buffer.from("fake"), mediaType: "image/jpeg" as const };

beforeEach(() => {
  mockExtractViaSidecar.mockReset();
  mockParseReceipt.mockReset();
  mockParseReceiptFromText.mockReset();
  mockParseReceipt.mockResolvedValue(GEMINI_OUTPUT);
  mockParseReceiptFromText.mockResolvedValue(GEMINI_OUTPUT);
});

describe("orchestrateParseReceipt · 高信心 single_charge → 完全跳過 Gemini", () => {
  it("回傳 PADDLE_OCR，本機組出的物件通過 ReceiptParseSchema，兩個 Gemini 函式都沒被呼叫", async () => {
    mockExtractViaSidecar.mockResolvedValue(sidecarResponse());

    const result = await orchestrateParseReceipt(ARGS);

    expect(result.engine).toBe("PADDLE_OCR");
    expect(result.parsed).not.toBeNull();
    expect(ReceiptParseSchema.safeParse(result.parsed).success).toBe(true);
    expect(result.parsed?.total).toBe(150);
    expect(result.parsed?.currency).toBe("JPY");
    expect(result.parsed?.items).toHaveLength(1);
    expect(result.parsed?.items[0].name_zh).toBeNull();
    expect(result.parsed?.confidence.items).toBe(0);
    expect(mockParseReceipt).not.toHaveBeenCalled();
    expect(mockParseReceiptFromText).not.toHaveBeenCalled();
  });
});

describe("orchestrateParseReceipt · itemized 一律照跑 Gemini", () => {
  it("classification 為 itemized 時改用圖片版 Gemini（OCR 品質不足以送文字）", async () => {
    mockExtractViaSidecar.mockResolvedValue(
      sidecarResponse({
        ocr_confidence_mean: 0.5,
        classification: { type: "itemized", confidence: 0.8, price_token_count: 3 },
      }),
    );

    const result = await orchestrateParseReceipt(ARGS);

    expect(result.engine).toBe("LLM_VISION");
    expect(mockParseReceipt).toHaveBeenCalledTimes(1);
    expect(mockParseReceiptFromText).not.toHaveBeenCalled();
  });
});

describe("orchestrateParseReceipt · single_charge 但欄位信心不足 → 落到 Gemini", () => {
  it("total.confidence 低於門檻，即使 classification 本身信心足夠", async () => {
    mockExtractViaSidecar.mockResolvedValue(
      sidecarResponse({
        fields: {
          store: { value: "セブンイレブン", confidence: 0.9 },
          datetime: { value: null, confidence: 0 },
          currency: { value: "JPY", confidence: 0.9 },
          total: { value: 150, confidence: 0.3 },
          tax: { value: [], confidence: 0 },
        },
      }),
    );

    const result = await orchestrateParseReceipt(ARGS);

    expect(result.engine).toBe("LLM_VISION");
    expect(mockParseReceipt).toHaveBeenCalledTimes(1);
  });
});

describe("orchestrateParseReceipt · sidecar 不可用", () => {
  it("回傳 null 時行為與加這功能之前完全一樣：直接呼叫圖片版 Gemini", async () => {
    mockExtractViaSidecar.mockResolvedValue(null);

    const result = await orchestrateParseReceipt(ARGS);

    expect(result.engine).toBe("LLM_VISION");
    expect(mockParseReceipt).toHaveBeenCalledTimes(1);
    expect(mockParseReceiptFromText).not.toHaveBeenCalled();
  });
});

describe("orchestrateParseReceipt · OCR 文字品質夠好時改送文字給 Gemini", () => {
  it("itemized + 高 OCR 信心 + 文字夠長 → 呼叫文字版而非圖片版", async () => {
    mockExtractViaSidecar.mockResolvedValue(
      sidecarResponse({
        raw_text: "セブンイレブン\nおにぎり ¥150\nお茶 ¥120\n合計 ¥270",
        ocr_confidence_mean: 0.85,
        classification: { type: "itemized", confidence: 0.8, price_token_count: 2 },
      }),
    );

    const result = await orchestrateParseReceipt(ARGS);

    expect(result.engine).toBe("LLM_VISION");
    expect(mockParseReceiptFromText).toHaveBeenCalledTimes(1);
    expect(mockParseReceipt).not.toHaveBeenCalled();
  });

  it("OCR 文字太短時，即使信心夠高也不送文字，改送圖片", async () => {
    mockExtractViaSidecar.mockResolvedValue(
      sidecarResponse({
        raw_text: "短",
        ocr_confidence_mean: 0.9,
        classification: { type: "itemized", confidence: 0.8, price_token_count: 2 },
      }),
    );

    const result = await orchestrateParseReceipt(ARGS);

    expect(result.engine).toBe("LLM_VISION");
    expect(mockParseReceipt).toHaveBeenCalledTimes(1);
    expect(mockParseReceiptFromText).not.toHaveBeenCalled();
  });
});

describe("orchestrateParseReceipt · 本機組出的物件驗證不過時，不冒險直接用", () => {
  it("sidecar 回傳格式怪異的 datetime，safeParse 失敗後落到 Gemini", async () => {
    mockExtractViaSidecar.mockResolvedValue(
      sidecarResponse({
        fields: {
          store: { value: "セブンイレブン", confidence: 0.9 },
          datetime: { value: "not-a-valid-iso-datetime", confidence: 0.9 },
          currency: { value: "JPY", confidence: 0.9 },
          total: { value: 150, confidence: 0.9 },
          tax: { value: [], confidence: 0 },
        },
      }),
    );

    const result = await orchestrateParseReceipt(ARGS);

    expect(result.engine).toBe("LLM_VISION");
    expect(mockParseReceipt).toHaveBeenCalledTimes(1);
  });
});
