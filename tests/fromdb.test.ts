import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { Money } from "@/lib/money/decimal";
import {
  fromDb,
  fromDbOrNull,
  toDbAmount,
  toDbFactor,
  toDbRate,
} from "@/lib/money/fromDb";

/**
 * 資料庫邊界轉換。
 * 重點是「外來的 decimal.js 實例不得直接參與運算」——Prisma 回傳的 Decimal
 * precision 為 20，與本專案的 40 不同。
 */

/** 模擬 Prisma 回傳的 Decimal：另一個建構子，precision 20（decimal.js 預設） */
const ForeignDecimal = Decimal.clone({ precision: 20 });

describe("fromDb · 正規化", () => {
  it("字串照原值解析", () => {
    expect(fromDb("62455.25").toString()).toBe("62455.25");
    expect(fromDb("8330.333335").toString()).toBe("8330.333335");
  });

  it("外來 Decimal 實例（模擬 Prisma 回傳）值不變", () => {
    const foreign = new ForeignDecimal("62455.25");
    expect(fromDb(foreign).toString()).toBe("62455.25");
  });

  it("★ 正規化後的運算落在本專案的 precision 40，而非外來的 20", () => {
    const foreign = new ForeignDecimal("62455.25");
    // 直接在外來實例上運算 → 用它的 precision 20
    const viaForeign = foreign.dividedBy(3).toString();
    // 經 fromDb 正規化 → 用我們的 precision 40
    const viaMoney = fromDb(foreign).dividedBy(3).toString();

    expect(viaForeign).toBe("20818.416666666666667");
    expect(viaMoney).toBe("20818.41666666666666666666666666666666667");
    expect(viaMoney).not.toBe(viaForeign);
  });

  it("整數 number 可接受", () => {
    expect(fromDb(61525).toString()).toBe("61525");
    expect(fromDb(0).toString()).toBe("0");
    expect(fromDb(-61525).toString()).toBe("-61525");
  });

  it("非整數 number：拒絕（可能已失真）", () => {
    expect(() => fromDb(6245.525)).toThrow(/非整數 number/);
    expect(() => fromDb(0.1)).toThrow(/非整數 number/);
  });

  it("超出安全整數範圍：拒絕", () => {
    expect(() => fromDb(Number.MAX_SAFE_INTEGER + 2)).toThrow(/安全範圍/);
  });

  it("無法解析的字串：拒絕", () => {
    expect(() => fromDb("abc")).toThrow(/無法解析為十進位數值/);
    expect(() => fromDb("")).toThrow(/無法解析為十進位數值/);
  });

  it("非有限數：拒絕", () => {
    expect(() => fromDb("Infinity")).toThrow(/有限數/);
    expect(() => fromDb(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("fromDbOrNull", () => {
  it("null 與 undefined 回傳 null", () => {
    expect(fromDbOrNull(null)).toBeNull();
    expect(fromDbOrNull(undefined)).toBeNull();
  });

  it("有值時等同 fromDb", () => {
    expect(fromDbOrNull("0.08")?.toString()).toBe("0.08");
  });
});

describe("toDbAmount · Decimal(18,6)", () => {
  it("固定輸出 6 位小數（不把捨入交給 PostgreSQL）", () => {
    expect(toDbAmount("61525")).toBe("61525.000000");
    expect(toDbAmount("6245.525")).toBe("6245.525000");
    expect(toDbAmount("8330.333335")).toBe("8330.333335");
  });

  it("超過 6 位以 HALF_UP 收斂", () => {
    expect(toDbAmount("8330.3333333333")).toBe("8330.333333");
    expect(toDbAmount("1.0000005")).toBe("1.000001");
    expect(toDbAmount("-1.0000005")).toBe("-1.000001");
  });
});

describe("toDbRate · Decimal(18,8)", () => {
  it("固定輸出 8 位小數", () => {
    expect(toDbRate("0.25")).toBe("0.25000000");
    expect(toDbRate(1)).toBe("1.00000000");
  });

  it("★ 匯率保留 8 位，不被金額用的 6 位截斷", () => {
    // 若誤用 toDbAmount，第 7、8 位會被截掉
    expect(toDbRate("0.00218765")).toBe("0.00218765");
    expect(toDbAmount("0.00218765")).toBe("0.002188");
    expect(toDbRate("0.00218765")).not.toBe(toDbAmount("0.00218765"));
  });

  it("超過 8 位以 HALF_UP 收斂", () => {
    expect(toDbRate("0.123456785")).toBe("0.12345679");
  });
});

describe("toDbFactor · Decimal(*,4)", () => {
  it("固定輸出 4 位小數（weight / qty / taxRate）", () => {
    expect(toDbFactor(1)).toBe("1.0000");
    expect(toDbFactor("1.5")).toBe("1.5000");
    expect(toDbFactor("0.08")).toBe("0.0800");
    expect(toDbFactor("0.1")).toBe("0.1000");
  });

  it("超過 4 位以 HALF_UP 收斂", () => {
    expect(toDbFactor("1.23455")).toBe("1.2346");
  });
});

describe("往返一致性", () => {
  it("寫入再讀回不失真（6 位以內的金額）", () => {
    const cases = ["61525", "62455.25", "6245.525", "8330.333335", "-333.333334"];
    for (const value of cases) {
      const persisted = toDbAmount(value);
      expect(fromDb(persisted).equals(new Money(value)), value).toBe(true);
    }
  });

  it("匯率往返不失真（8 位以內）", () => {
    for (const value of ["0.25", "1", "0.00218765", "31.5"]) {
      expect(fromDb(toDbRate(value)).equals(new Money(value)), value).toBe(true);
    }
  });
});
