import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractViaSidecar } from "@/lib/parse/sidecar";

/**
 * extractViaSidecar() 的失敗降級測試——跟 gemini.ts 同一份合約：任何失敗
 * 都回傳 null，絕不拋出，交給 orchestrator.ts 決定要不要降級到 Gemini。
 * 用 vi.spyOn(globalThis, "fetch") 取代真實網路請求，比照
 * tests/fx.frankfurter.test.ts 既有慣例，不需要真的跑 sidecar 容器。
 */

const VALID_RESPONSE = {
  raw_text: "セブンイレブン\n合計 ¥150",
  ocr_confidence_mean: 0.9,
  fields: {
    store: { value: "セブンイレブン", confidence: 0.9 },
    datetime: { value: null, confidence: 0 },
    currency: { value: "JPY", confidence: 0.9 },
    total: { value: 150, confidence: 0.9 },
    tax: { value: [], confidence: 0 },
  },
  classification: { type: "single_charge", confidence: 0.6, price_token_count: 1 },
};

function mockFetchOnce(status: number, body: unknown): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.OCR_SIDECAR_URL = "http://ocr-sidecar-test:8000";
  delete process.env.OCR_SIDECAR_TIMEOUT_MS;
});

describe("extractViaSidecar · OCR_SIDECAR_URL 未設定", () => {
  it("不打 fetch，直接回 null", async () => {
    delete process.env.OCR_SIDECAR_URL;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await extractViaSidecar({
      imageBuffer: Buffer.from("fake"),
      mediaType: "image/jpeg",
    });

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("extractViaSidecar · 各種失敗路徑一律回 null", () => {
  it("連線失敗（fetch 拋出）", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await extractViaSidecar({
      imageBuffer: Buffer.from("fake"),
      mediaType: "image/jpeg",
    });

    expect(result).toBeNull();
  });

  it("逾時（AbortController 觸發）", async () => {
    process.env.OCR_SIDECAR_TIMEOUT_MS = "10";
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal;
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });

    const result = await extractViaSidecar({
      imageBuffer: Buffer.from("fake"),
      mediaType: "image/jpeg",
    });

    expect(result).toBeNull();
  });

  it("非 200 回應", async () => {
    mockFetchOnce(500, { error: "internal error" });

    const result = await extractViaSidecar({
      imageBuffer: Buffer.from("fake"),
      mediaType: "image/jpeg",
    });

    expect(result).toBeNull();
  });

  it("回應不是合法 JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response);

    const result = await extractViaSidecar({
      imageBuffer: Buffer.from("fake"),
      mediaType: "image/jpeg",
    });

    expect(result).toBeNull();
  });

  it("回應形狀不符合 schema（缺少 fields.total）", async () => {
    const { total, ...rest } = VALID_RESPONSE.fields;
    void total;
    mockFetchOnce(200, { ...VALID_RESPONSE, fields: rest });

    const result = await extractViaSidecar({
      imageBuffer: Buffer.from("fake"),
      mediaType: "image/jpeg",
    });

    expect(result).toBeNull();
  });
});

describe("extractViaSidecar · 成功路徑", () => {
  it("回傳解析後的物件，fetch 只打一次、送 multipart/form-data", async () => {
    mockFetchOnce(200, VALID_RESPONSE);

    const result = await extractViaSidecar({
      imageBuffer: Buffer.from("fake"),
      mediaType: "image/jpeg",
    });

    expect(result).toEqual(VALID_RESPONSE);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("http://ocr-sidecar-test:8000/extract");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const formData = (init as RequestInit).body as FormData;
    expect(formData.get("image")).not.toBeNull();
  });
});
