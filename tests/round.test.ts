import { describe, expect, it } from "vitest";
import { MONEY_SCALE } from "@/lib/money/decimal";
import {
  displayScale,
  formatMoney,
  roundForDisplay,
  toStorageScale,
} from "@/lib/money/round";

/** CLAUDE.md 鐵律 3：TWD／JPY 顯示取整，且必須是 ROUND_HALF_UP 而非 banker's rounding */

describe("displayScale", () => {
  it("JPY 與 TWD 顯示為整數", () => {
    expect(displayScale("JPY")).toBe(0);
    expect(displayScale("TWD")).toBe(0);
  });

  it("大小寫不敏感", () => {
    expect(displayScale("jpy")).toBe(0);
    expect(displayScale("twd")).toBe(0);
  });

  it("未登記幣別預設 2 位小數", () => {
    expect(displayScale("USD")).toBe(2);
    expect(displayScale("EUR")).toBe(2);
    expect(displayScale("XXX")).toBe(2);
  });
});

describe("roundForDisplay · 必須是 HALF_UP，不是 banker's rounding", () => {
  it("0.5 → 1（banker's 會給 0）", () => {
    expect(roundForDisplay("0.5", "TWD").toString()).toBe("1");
  });

  it("1.5 → 2", () => {
    expect(roundForDisplay("1.5", "TWD").toString()).toBe("2");
  });

  it("2.5 → 3（banker's 會給 2，這是關鍵區別）", () => {
    expect(roundForDisplay("2.5", "TWD").toString()).toBe("3");
  });

  it("3.5 → 4、4.5 → 5（連續驗證，排除偶然吻合）", () => {
    expect(roundForDisplay("3.5", "TWD").toString()).toBe("4");
    expect(roundForDisplay("4.5", "TWD").toString()).toBe("5");
  });

  it("負數 HALF_UP 遠離零：-0.5 → -1、-2.5 → -3", () => {
    expect(roundForDisplay("-0.5", "TWD").toString()).toBe("-1");
    expect(roundForDisplay("-2.5", "TWD").toString()).toBe("-3");
  });

  it("未達 0.5 不進位：0.4999999 → 0、741,294.25 → 741,294", () => {
    expect(roundForDisplay("0.4999999", "TWD").toString()).toBe("0");
    expect(roundForDisplay("741294.25", "TWD").toString()).toBe("741294");
  });

  it("迴歸案例每人總計：73,635.358333 → 73,635", () => {
    expect(roundForDisplay("73635.358333", "TWD").toString()).toBe("73635");
    expect(roundForDisplay("72998.025", "TWD").toString()).toBe("72998");
    expect(roundForDisplay("76743.025", "TWD").toString()).toBe("76743");
  });

  it("JPY 取整數", () => {
    expect(roundForDisplay("83273.666667", "JPY").toString()).toBe("83274");
  });

  it("未登記幣別取 2 位小數", () => {
    expect(roundForDisplay("1.005", "USD").toString()).toBe("1.01");
  });
});

describe("formatMoney", () => {
  it("千分位分隔：741,294", () => {
    expect(formatMoney("741294.25", "TWD")).toBe("741,294");
  });

  it("四位數以下不加分隔", () => {
    expect(formatMoney("999", "TWD")).toBe("999");
    expect(formatMoney("1000", "TWD")).toBe("1,000");
  });

  it("百萬級：2,965,177 日圓", () => {
    expect(formatMoney("2965177", "JPY")).toBe("2,965,177");
  });

  it("負數：負號在最前，分隔正確", () => {
    expect(formatMoney("-1234567", "TWD")).toBe("-1,234,567");
  });

  it("兩位小數幣別保留小數部分", () => {
    expect(formatMoney("1234.5", "USD")).toBe("1,234.50");
  });
});

describe("toStorageScale", () => {
  it("收斂到 6 位小數", () => {
    expect(MONEY_SCALE).toBe(6);
    expect(toStorageScale("8330.3333333333").toString()).toBe("8330.333333");
  });

  it("第 7 位為 5 時 HALF_UP 進位", () => {
    expect(toStorageScale("1.0000005").toString()).toBe("1.000001");
  });

  it("負數 HALF_UP 遠離零", () => {
    expect(toStorageScale("-1.0000005").toString()).toBe("-1.000001");
  });

  it("位數不足 6 位時不補零、值不變", () => {
    expect(toStorageScale("6245.525").toString()).toBe("6245.525");
    expect(toStorageScale("61525").toString()).toBe("61525");
  });

  it("大額不轉為指數記法", () => {
    expect(toStorageScale("2965177000").toString()).toBe("2965177000");
  });
});
