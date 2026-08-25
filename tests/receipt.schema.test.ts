import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  LOW_CONFIDENCE_THRESHOLD,
  ReceiptParseSchema,
} from "@/lib/schemas/receipt";

/**
 * ReceiptParseSchema 測試。
 *
 * 重點不是「zod 驗證邏輯本身對不對」（那是 zod 自己的職責），是這份 schema
 * 是否真的能轉成 Gemini `responseJsonSchema` 吃的標準 JSON Schema
 * （`z.toJSONSchema()`，見 src/lib/parse/gemini.ts）——confidence 從
 * §5.2 原文的 `z.record(...)` 改成固定欄位就是為了讓這份 schema 保持封閉、
 * 可靠地轉換，這裡要有測試釘住，不然日後有人「順手」把它改回 record，會在
 * 跑到真的 API 呼叫時才爆炸。
 */

const VALID_SAMPLE = {
  store: "セブンイレブン",
  store_zh: "7-11",
  address: "東京都渋谷区",
  datetime: "2026-09-13T10:30:00+09:00",
  currency: "JPY",
  payment_method: "現金",
  items: [
    {
      name_raw: "おにぎり",
      name_zh: "飯糰",
      qty: 1,
      unit_price: 150,
      amount: 150,
      tax_rate: 0.08,
      category: "餐飲",
    },
  ],
  subtotal: 150,
  tax: [{ rate: 0.08, amount: 12, mode: "內稅(税込)" }],
  total: 150,
  confidence: {
    store: 0.95,
    datetime: 0.9,
    currency: 0.99,
    total: 0.98,
    items: 0.85,
    tax: 0.8,
  },
};

describe("ReceiptParseSchema · 結構化輸出相容性", () => {
  it("★ z.toJSONSchema 轉換不拋出", () => {
    expect(() => z.toJSONSchema(ReceiptParseSchema)).not.toThrow();
  });

  it("★ confidence 是封閉物件（additionalProperties: false）——不拋出這件事本身不夠：" +
    "z.toJSONSchema 對 z.record(...) 也不會拋出，只是不會產生這個約束，" +
    "所以要直接斷言這個值才能真的釘住「confidence 不得改回 record」", () => {
    const jsonSchema = z.toJSONSchema(ReceiptParseSchema) as unknown as {
      properties: { confidence: { additionalProperties: unknown } };
    };
    expect(jsonSchema.properties.confidence.additionalProperties).toBe(false);
  });
});

describe("ReceiptParseSchema · 驗證", () => {
  it("完整範例通過驗證", () => {
    const result = ReceiptParseSchema.safeParse(VALID_SAMPLE);
    expect(result.success).toBe(true);
  });

  it("所有 nullable 欄位可為 null（讀不到時的正常狀態）", () => {
    const result = ReceiptParseSchema.safeParse({
      ...VALID_SAMPLE,
      store: null,
      store_zh: null,
      address: null,
      datetime: null,
      currency: null,
      payment_method: null,
      subtotal: null,
    });
    expect(result.success).toBe(true);
  });

  it("datetime 缺時區 offset：拒絕（§5.3 規則 4 要求 ISO 8601 with offset）", () => {
    const result = ReceiptParseSchema.safeParse({
      ...VALID_SAMPLE,
      datetime: "2026-09-13T10:30:00",
    });
    expect(result.success).toBe(false);
  });

  it("tax_rate 只接受 0.08 或 0.10，其他值拒絕", () => {
    const result = ReceiptParseSchema.safeParse({
      ...VALID_SAMPLE,
      items: [{ ...VALID_SAMPLE.items[0], tax_rate: 0.05 }],
    });
    expect(result.success).toBe(false);
  });

  it("confidence 分數超出 0–1 範圍：拒絕", () => {
    const result = ReceiptParseSchema.safeParse({
      ...VALID_SAMPLE,
      confidence: { ...VALID_SAMPLE.confidence, total: 1.5 },
    });
    expect(result.success).toBe(false);
  });

  it("confidence 缺任何一個固定 key：拒絕", () => {
    const { tax: _tax, ...incomplete } = VALID_SAMPLE.confidence;
    const result = ReceiptParseSchema.safeParse({
      ...VALID_SAMPLE,
      confidence: incomplete,
    });
    expect(result.success).toBe(false);
  });

  it("category 只接受 §5.3 規則 7 定義的六類，其他字串拒絕", () => {
    const result = ReceiptParseSchema.safeParse({
      ...VALID_SAMPLE,
      items: [{ ...VALID_SAMPLE.items[0], category: "3C" }],
    });
    expect(result.success).toBe(false);
  });

  it("items 可為空陣列（例如只有一筆總額、沒有明細的收據）", () => {
    const result = ReceiptParseSchema.safeParse({ ...VALID_SAMPLE, items: [] });
    expect(result.success).toBe(true);
  });

  it("qty 未提供時預設為 1", () => {
    const { qty: _qty, ...itemWithoutQty } = VALID_SAMPLE.items[0];
    const result = ReceiptParseSchema.safeParse({
      ...VALID_SAMPLE,
      items: [itemWithoutQty],
    });
    expect(result.success && result.data.items[0]?.qty).toBe(1);
  });
});

describe("LOW_CONFIDENCE_THRESHOLD", () => {
  it("等於 0.8（§5.1「confidence < 0.8 的欄位標紅」）", () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.8);
  });
});
