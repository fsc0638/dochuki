import { describe, expect, it } from "vitest";
import { convertToHome, resolveRate } from "@/lib/money/convert";

/**
 * 匯率解析與換算。
 * CLAUDE.md 鐵律 2（rateUsed 為入帳當下快照、不得回溯）與鐵律 5（匯率語意）
 * 的實作驗證；優先序依 docs/IMPLEMENTATION.md §6。
 */

const TRIP_FIXED = { JPY: "0.25" };

describe("resolveRate · 優先序 TRIP_FIXED → MANUAL → DAILY_REF", () => {
  it("行程固定匯率優先於手動與參考匯率", () => {
    const result = resolveRate({
      currency: "JPY",
      homeCurrency: "TWD",
      tripFixedRates: TRIP_FIXED,
      manualRate: "0.30",
      dailyRefRate: "0.28",
    });
    expect(result.rate.toString()).toBe("0.25");
    expect(result.source).toBe("TRIP_FIXED");
  });

  it("無行程固定匯率時，手動優先於參考匯率", () => {
    const result = resolveRate({
      currency: "JPY",
      homeCurrency: "TWD",
      tripFixedRates: null,
      manualRate: "0.30",
      dailyRefRate: "0.28",
    });
    // Decimal 會去掉尾隨零，"0.30" 正規化為 "0.3"
    expect(result.rate.toString()).toBe("0.3");
    expect(result.source).toBe("MANUAL");
  });

  it("只有參考匯率時採用之", () => {
    const result = resolveRate({
      currency: "JPY",
      homeCurrency: "TWD",
      dailyRefRate: "0.28",
    });
    expect(result.rate.toString()).toBe("0.28");
    expect(result.source).toBe("DAILY_REF");
  });

  it("該幣別不在行程固定匯率表內時，往下一順位找", () => {
    const result = resolveRate({
      currency: "USD",
      homeCurrency: "TWD",
      tripFixedRates: TRIP_FIXED,
      manualRate: "31.5",
    });
    expect(result.rate.toString()).toBe("31.5");
    expect(result.source).toBe("MANUAL");
  });

  it("原幣即記帳幣：匯率恆為 1", () => {
    const result = resolveRate({ currency: "TWD", homeCurrency: "TWD" });
    expect(result.rate.toString()).toBe("1");
    expect(result.source).toBe("TRIP_FIXED");
  });

  it("幣別大小寫不敏感", () => {
    expect(
      resolveRate({
        currency: "jpy",
        homeCurrency: "twd",
        tripFixedRates: TRIP_FIXED,
      }).rate.toString(),
    ).toBe("0.25");
  });

  it("三源皆缺：拒絕", () => {
    expect(() =>
      resolveRate({ currency: "JPY", homeCurrency: "TWD" }),
    ).toThrow(/三者皆缺/);
  });

  it("匯率為 0 或負數：拒絕", () => {
    expect(() =>
      resolveRate({ currency: "JPY", homeCurrency: "TWD", manualRate: 0 }),
    ).toThrow(/正的有限數/);
    expect(() =>
      resolveRate({ currency: "JPY", homeCurrency: "TWD", manualRate: "-0.25" }),
    ).toThrow(/正的有限數/);
  });
});

describe("convertToHome", () => {
  it("迴歸案例逐筆：JPY × 0.25", () => {
    const cases: Array<[string, string]> = [
      ["246100", "61525"],
      ["138280", "34570"],
      ["220000", "55000"],
      ["249821", "62455.25"],
      ["30000", "7500"],
    ];
    for (const [original, home] of cases) {
      expect(
        convertToHome({ amountOriginal: original, rate: "0.25" }).toString(),
        `¥${original}`,
      ).toBe(home);
    }
  });

  it("匯率語意：1 單位原幣兌 rate 單位記帳幣（¥4 = NT$1）", () => {
    expect(convertToHome({ amountOriginal: 4, rate: "0.25" }).toString()).toBe(
      "1",
    );
  });

  it("同幣別 rate = 1 時金額不變", () => {
    expect(
      convertToHome({ amountOriginal: "14500", rate: 1 }).toString(),
    ).toBe("14500");
  });

  it("結果收斂到 6 位小數", () => {
    expect(
      convertToHome({ amountOriginal: "1", rate: "0.3333333333" }).toString(),
    ).toBe("0.333333");
  });

  it("rateUsed 快照語意：同一金額配不同匯率得不同結果，函式不讀外部狀態", () => {
    const first = convertToHome({ amountOriginal: "100000", rate: "0.25" });
    const second = convertToHome({ amountOriginal: "100000", rate: "0.22" });
    expect(first.toString()).toBe("25000");
    expect(second.toString()).toBe("22000");
    // 重複呼叫必得同值（純函式，無隱藏狀態）
    expect(
      convertToHome({ amountOriginal: "100000", rate: "0.25" }).toString(),
    ).toBe(first.toString());
  });

  it("負金額（退款）照比例換算", () => {
    expect(
      convertToHome({ amountOriginal: "-246100", rate: "0.25" }).toString(),
    ).toBe("-61525");
  });

  it("匯率非正數：拒絕", () => {
    expect(() =>
      convertToHome({ amountOriginal: "100", rate: 0 }),
    ).toThrow(/正的有限數/);
  });

  it("金額非有限數：拒絕", () => {
    expect(() =>
      convertToHome({
        amountOriginal: Number.POSITIVE_INFINITY,
        rate: "0.25",
      }),
    ).toThrow(/有限數/);
  });
});
