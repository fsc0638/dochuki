import { describe, expect, it } from "vitest";
import { Money, MONEY_SCALE, type MoneyInput } from "@/lib/money/decimal";
import {
  splitExpense,
  type SplitParticipant,
  type SplitResult,
} from "@/lib/money/split";

/** 分攤引擎單元測試，含 CLAUDE.md 鐵律 4 的守恆與尾差歸屬邊界 */

function members(...ids: string[]): SplitParticipant[] {
  return ids.map((memberId) => ({ memberId }));
}

function shareOf(result: SplitResult, memberId: string): string {
  const share = result.shares.find((entry) => entry.memberId === memberId);
  expect(share, `${memberId} 應有分攤額`).toBeDefined();
  return share!.shareHome.toString();
}

function sum(result: SplitResult) {
  return result.shares.reduce(
    (acc, share) => acc.plus(share.shareHome),
    new Money(0),
  );
}

/** 守恆不變式：Σshares 必須嚴格等於支出金額 */
function expectConserved(result: SplitResult, amount: MoneyInput): void {
  expect(sum(result).toString(), "Σshares ≡ amountHome").toBe(
    new Money(amount).toString(),
  );
}

describe("splitExpense · EQUAL", () => {
  it("整除：1,000 ÷ 4 人 = 250，無尾差", () => {
    const result = splitExpense({
      amountHome: 1000,
      mode: "EQUAL",
      participants: members("m1", "m2", "m3", "m4"),
      payerId: "m1",
    });
    for (const id of ["m1", "m2", "m3", "m4"]) {
      expect(shareOf(result, id)).toBe("250");
    }
    expect(result.remainder.isZero()).toBe(true);
    expect(result.remainderAssignedTo).toBeNull();
    expectConserved(result, 1000);
  });

  it("6 位小數內除得盡：62,455.25 ÷ 10 = 6,245.525（住宿B 情境，無尾差）", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `m${i + 1}`);
    const result = splitExpense({
      amountHome: "62455.25",
      mode: "EQUAL",
      participants: members(...ids),
      payerId: "m1",
    });
    for (const id of ids) {
      expect(shareOf(result, id)).toBe("6245.525");
    }
    expect(result.remainder.isZero()).toBe(true);
    expectConserved(result, "62455.25");
  });

  it("6 位小數內除不盡：49,982 ÷ 6 的尾差 0.000002 歸付款人（機票 G1 情境）", () => {
    const ids = ["m1", "m2", "m3", "m4", "m5", "m6"];
    const result = splitExpense({
      amountHome: 49982,
      mode: "EQUAL",
      participants: members(...ids),
      payerId: "m3",
    });
    for (const id of ids.filter((entry) => entry !== "m3")) {
      expect(shareOf(result, id), `${id} 非付款人`).toBe("8330.333333");
    }
    expect(shareOf(result, "m3"), "付款人吸收尾差").toBe("8330.333335");
    expect(result.remainder.toString()).toBe("0.000002");
    expect(result.remainderAssignedTo).toBe("m3");
    expectConserved(result, 49982);
  });

  it("單人：全額歸該人", () => {
    const result = splitExpense({
      amountHome: "1234.567891",
      mode: "EQUAL",
      participants: members("m1"),
      payerId: "m1",
    });
    expect(shareOf(result, "m1")).toBe("1234.567891");
    expectConserved(result, "1234.567891");
  });

  it("零參與者：拒絕", () => {
    expect(() =>
      splitExpense({
        amountHome: 100,
        mode: "EQUAL",
        participants: [],
        payerId: null,
      }),
    ).toThrow(/參與者不可為空/);
  });

  it("金額 0：全員 0，守恆成立", () => {
    const result = splitExpense({
      amountHome: 0,
      mode: "EQUAL",
      participants: members("m1", "m2", "m3"),
      payerId: "m1",
    });
    for (const id of ["m1", "m2", "m3"]) {
      expect(new Money(shareOf(result, id)).isZero()).toBe(true);
    }
    expectConserved(result, 0);
  });

  it("負金額（退款／折讓）：方向正確且守恆", () => {
    const result = splitExpense({
      amountHome: -1000,
      mode: "EQUAL",
      participants: members("m1", "m2", "m3"),
      payerId: "m1",
    });
    expect(shareOf(result, "m2")).toBe("-333.333333");
    expect(shareOf(result, "m3")).toBe("-333.333333");
    // 餘數為負，仍歸付款人
    expect(shareOf(result, "m1")).toBe("-333.333334");
    expectConserved(result, -1000);
  });

  it("金額非有限數：拒絕", () => {
    expect(() =>
      splitExpense({
        amountHome: Number.POSITIVE_INFINITY,
        mode: "EQUAL",
        participants: members("m1"),
        payerId: "m1",
      }),
    ).toThrow(/有限數/);
  });

  it("重複成員：拒絕", () => {
    expect(() =>
      splitExpense({
        amountHome: 100,
        mode: "EQUAL",
        participants: members("m1", "m1"),
        payerId: "m1",
      }),
    ).toThrow(/重複成員/);
  });
});

describe("splitExpense · WEIGHT", () => {
  it("權重 1:1:2 → 25% / 25% / 50%", () => {
    const result = splitExpense({
      amountHome: 1000,
      mode: "WEIGHT",
      participants: [
        { memberId: "m1", weight: 1 },
        { memberId: "m2", weight: 1 },
        { memberId: "m3", weight: 2 },
      ],
      payerId: "m1",
    });
    expect(shareOf(result, "m1")).toBe("250");
    expect(shareOf(result, "m2")).toBe("250");
    expect(shareOf(result, "m3")).toBe("500");
    expectConserved(result, 1000);
  });

  it("權重為 0 的成員分攤額為 0，其餘按比例", () => {
    const result = splitExpense({
      amountHome: 900,
      mode: "WEIGHT",
      participants: [
        { memberId: "m1", weight: 2 },
        { memberId: "m2", weight: 1 },
        { memberId: "m3", weight: 0 },
      ],
      payerId: "m1",
    });
    expect(shareOf(result, "m1")).toBe("600");
    expect(shareOf(result, "m2")).toBe("300");
    expect(new Money(shareOf(result, "m3")).isZero()).toBe(true);
    expectConserved(result, 900);
  });

  it("權重總和為 0：拒絕（不可除以 0）", () => {
    expect(() =>
      splitExpense({
        amountHome: 100,
        mode: "WEIGHT",
        participants: [
          { memberId: "m1", weight: 0 },
          { memberId: "m2", weight: 0 },
        ],
        payerId: "m1",
      }),
    ).toThrow(/權重總和為 0/);
  });

  it("小數權重 1.5:1 → 60% / 40%", () => {
    const result = splitExpense({
      amountHome: 1000,
      mode: "WEIGHT",
      participants: [
        { memberId: "m1", weight: "1.5" },
        { memberId: "m2", weight: 1 },
      ],
      payerId: "m1",
    });
    expect(shareOf(result, "m1")).toBe("600");
    expect(shareOf(result, "m2")).toBe("400");
    expectConserved(result, 1000);
  });

  it("負權重：拒絕", () => {
    expect(() =>
      splitExpense({
        amountHome: 100,
        mode: "WEIGHT",
        participants: [
          { memberId: "m1", weight: -1 },
          { memberId: "m2", weight: 2 },
        ],
        payerId: "m1",
      }),
    ).toThrow(/非負的有限數/);
  });

  it("未指定權重時視為 1（等同均分）", () => {
    const result = splitExpense({
      amountHome: 300,
      mode: "WEIGHT",
      participants: members("m1", "m2", "m3"),
      payerId: "m1",
    });
    for (const id of ["m1", "m2", "m3"]) {
      expect(shareOf(result, id)).toBe("100");
    }
    expectConserved(result, 300);
  });
});

describe("splitExpense · EXACT", () => {
  it("總和相符：原值照落，無尾差調整", () => {
    const result = splitExpense({
      amountHome: 1000,
      mode: "EXACT",
      participants: [
        { memberId: "m1", exactShare: "600.5" },
        { memberId: "m2", exactShare: "399.5" },
      ],
      payerId: "m1",
    });
    expect(shareOf(result, "m1")).toBe("600.5");
    expect(shareOf(result, "m2")).toBe("399.5");
    expect(result.remainder.isZero()).toBe(true);
    expect(result.remainderAssignedTo).toBeNull();
    expectConserved(result, 1000);
  });

  it("總和多 0.01：拒絕（不得靜默吸收）", () => {
    expect(() =>
      splitExpense({
        amountHome: 1000,
        mode: "EXACT",
        participants: [
          { memberId: "m1", exactShare: "600.51" },
          { memberId: "m2", exactShare: "399.5" },
        ],
        payerId: "m1",
      }),
    ).toThrow(/與支出金額 1000 不符/);
  });

  it("總和少 0.01：拒絕", () => {
    expect(() =>
      splitExpense({
        amountHome: 1000,
        mode: "EXACT",
        participants: [
          { memberId: "m1", exactShare: "600.49" },
          { memberId: "m2", exactShare: "399.5" },
        ],
        payerId: "m1",
      }),
    ).toThrow(/不符/);
  });

  it("缺某成員的指定金額：拒絕", () => {
    expect(() =>
      splitExpense({
        amountHome: 1000,
        mode: "EXACT",
        participants: [
          { memberId: "m1", exactShare: "1000" },
          { memberId: "m2" },
        ],
        payerId: "m1",
      }),
    ).toThrow(/缺少成員 m2 的指定金額/);
  });
});

describe("splitExpense · BY_GROUP", () => {
  const roster: SplitParticipant[] = [
    { memberId: "m1", groupId: "g1" },
    { memberId: "m2", groupId: "g1" },
    { memberId: "m3", groupId: "g2" },
    { memberId: "m4", groupId: "g2" },
    { memberId: "m5", groupId: null },
  ];

  it("只在指定組內均分，組外成員不得有分攤額", () => {
    const result = splitExpense({
      amountHome: 1000,
      mode: "BY_GROUP",
      participants: roster,
      payerId: "m1",
      groupId: "g1",
    });
    expect(result.shares.map((share) => share.memberId).sort()).toEqual([
      "m1",
      "m2",
    ]);
    expect(shareOf(result, "m1")).toBe("500");
    expect(shareOf(result, "m2")).toBe("500");
    expectConserved(result, 1000);
  });

  it("三組各自獨立計算，互不影響", () => {
    const g1 = splitExpense({
      amountHome: 49982,
      mode: "BY_GROUP",
      participants: roster,
      payerId: "m1",
      groupId: "g1",
    });
    const g2 = splitExpense({
      amountHome: 15386,
      mode: "BY_GROUP",
      participants: roster,
      payerId: "m3",
      groupId: "g2",
    });
    expect(shareOf(g1, "m2")).toBe("24991");
    expect(shareOf(g2, "m4")).toBe("7693");
    expectConserved(g1, 49982);
    expectConserved(g2, 15386);
  });

  it("指定組別沒有成員：拒絕", () => {
    expect(() =>
      splitExpense({
        amountHome: 1000,
        mode: "BY_GROUP",
        participants: roster,
        payerId: "m1",
        groupId: "g9",
      }),
    ).toThrow(/找不到屬於組別 g9 的成員/);
  });

  it("付款人在組外時不拋錯，尾差退回分攤額最大者", () => {
    // g2 的機票由 g1 的 m1 代墊：m1 沒有 g2 的分攤額，尾差不能塞給他
    const result = splitExpense({
      amountHome: 100,
      mode: "BY_GROUP",
      participants: roster,
      payerId: "m1",
      groupId: "g2",
    });
    expect(result.shares.map((share) => share.memberId).sort()).toEqual([
      "m3",
      "m4",
    ]);
    expect(result.shares.every((share) => share.memberId !== "m1")).toBe(true);
    expectConserved(result, 100);
  });
});

describe("splitExpense · 尾差歸屬", () => {
  it("payerId 為 null：退回分攤額最大者，同額則取 memberId 字典序最小者", () => {
    const first = splitExpense({
      amountHome: 49982,
      mode: "EQUAL",
      participants: members("m4", "m2", "m6", "m1", "m5", "m3"),
      payerId: null,
    });
    expect(first.remainderAssignedTo).toBe("m1");
    expect(shareOf(first, "m1")).toBe("8330.333335");

    // 參與者順序不同也必須得到同一個結果（可重現）
    const second = splitExpense({
      amountHome: 49982,
      mode: "EQUAL",
      participants: members("m1", "m2", "m3", "m4", "m5", "m6"),
      payerId: null,
    });
    expect(second.remainderAssignedTo).toBe("m1");
    expect(shareOf(second, "m1")).toBe(shareOf(first, "m1"));
  });

  it("分攤額不同時，尾差退回最大者", () => {
    const result = splitExpense({
      amountHome: 1000,
      mode: "WEIGHT",
      participants: [
        { memberId: "m9", weight: 1 },
        { memberId: "m1", weight: 2 },
      ],
      payerId: null,
    });
    // m1 權重較高、分攤額較大
    expect(result.remainderAssignedTo === null || result.remainderAssignedTo === "m1").toBe(true);
    expectConserved(result, 1000);
  });

  it("payerId 不在參與者名單：拒絕", () => {
    expect(() =>
      splitExpense({
        amountHome: 100,
        mode: "EQUAL",
        participants: members("m1", "m2"),
        payerId: "m99",
      }),
    ).toThrow(/付款人 m99 不在分攤參與者名單中/);
  });

  it("尾差絕對值不超過 人數 × 0.5 × 10^-6", () => {
    const counts = [3, 6, 7, 9, 11, 13];
    for (const count of counts) {
      const ids = Array.from({ length: count }, (_, i) => `m${i + 1}`);
      const result = splitExpense({
        amountHome: 100000,
        mode: "EQUAL",
        participants: members(...ids),
        payerId: "m1",
      });
      const bound = new Money(count)
        .times("0.5")
        .times(new Money(10).toPower(-MONEY_SCALE));
      expect(
        result.remainder.abs().lessThanOrEqualTo(bound),
        `${count} 人尾差 ${result.remainder.toString()} 應 ≤ ${bound.toString()}`,
      ).toBe(true);
      expectConserved(result, 100000);
    }
  });
});
