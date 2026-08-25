import { describe, expect, it } from "vitest";
import { Money } from "@/lib/money/decimal";
import { summarizeFund } from "@/lib/money/fund";

describe("summarizeFund", () => {
  it("只有提撥：spendTotal 為 0，balance 等於提撥合計", () => {
    const result = summarizeFund([
      { type: "CONTRIBUTION", amount: 30000 },
      { type: "CONTRIBUTION", amount: 30000 },
    ]);
    expect(result.contributionTotal.toString()).toBe("60000");
    expect(result.spendTotal.toString()).toBe("0");
    expect(result.balance.toString()).toBe("60000");
  });

  it("提撥與支用混合：balance = 提撥 − 支用", () => {
    const result = summarizeFund([
      { type: "CONTRIBUTION", amount: 300000 },
      { type: "SPEND", amount: 120000 },
      { type: "SPEND", amount: 45000 },
    ]);
    expect(result.contributionTotal.toString()).toBe("300000");
    expect(result.spendTotal.toString()).toBe("165000");
    expect(result.balance.toString()).toBe("135000");
  });

  it("空清單：三者皆為 0", () => {
    const result = summarizeFund([]);
    expect(result.contributionTotal.toString()).toBe("0");
    expect(result.spendTotal.toString()).toBe("0");
    expect(result.balance.toString()).toBe("0");
  });

  it("支用超過提撥：balance 為負，允許透支（不擋，由 UI 層決定要不要警示）", () => {
    const result = summarizeFund([
      { type: "CONTRIBUTION", amount: 1000 },
      { type: "SPEND", amount: 1500 },
    ]);
    expect(result.balance.toString()).toBe("-500");
  });

  it("金額收斂到 6 位小數（MONEY_SCALE），不因輸入精度更高而失真", () => {
    const result = summarizeFund([
      { type: "CONTRIBUTION", amount: new Money("83273.6666666") },
    ]);
    expect(result.contributionTotal.toString()).toBe("83273.666667");
  });
});
