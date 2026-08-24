import type Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { convertToHome, resolveRate } from "@/lib/money/convert";
import { Money, type MoneyInput } from "@/lib/money/decimal";
import { roundForDisplay } from "@/lib/money/round";
import { crossCheckDifference, summarizeTrip } from "@/lib/money/summary";
import { loadNiigataExpected, loadNiigataInput } from "@/lib/schemas/niigata";

/**
 * 新潟・佐渡 10 人團永久迴歸測試。
 *
 * 期望值全部來自 fixtures/niigata/expected.json，其內容抄錄自 CLAUDE.md
 * 「永久迴歸案例」——那是真實行程的正確答案。
 * ★ 測試失敗時要改的是 src/lib/money/，不是期望值。
 */

const input = loadNiigataInput();
const expected = loadNiigataExpected();
const homeCurrency = input.trip.homeCurrency;

/** 比對兩個金額是否嚴格相等（先以 Decimal 正規化字串表示，避免格式差異誤判） */
function expectMoney(
  actual: MoneyInput,
  expectedValue: string,
  label: string,
): void {
  expect(new Money(actual).toString(), label).toBe(
    new Money(expectedValue).toString(),
  );
}

function rateFor(currency: string): Decimal {
  return resolveRate({
    currency,
    homeCurrency,
    tripFixedRates: input.trip.fixedRates,
  }).rate;
}

// --- 換算：原幣 → 記帳幣，逐筆取得 rateUsed 快照 ---
const expensesHome = input.expenses.map((expense) => {
  const resolution = resolveRate({
    currency: expense.currency,
    homeCurrency,
    tripFixedRates: input.trip.fixedRates,
  });
  return {
    ...expense,
    rateUsed: resolution.rate,
    rateSource: resolution.source,
    amountHome: convertToHome({
      amountOriginal: expense.amountOriginal,
      rate: resolution.rate,
    }),
  };
});

const fundPerMemberHome = convertToHome({
  amountOriginal: input.fund.contributionPerMember,
  rate: rateFor(input.fund.currency),
});

const summary = summarizeTrip({
  members: input.members.map((member) => ({
    memberId: member.id,
    groupId: member.groupId,
  })),
  expenses: expensesHome.map((expense) => ({
    id: expense.id,
    amountHome: expense.amountHome,
    splitMode: expense.splitMode,
    payerId: expense.payerId,
    groupId: expense.groupId ?? null,
  })),
  extras: {
    fundPerMemberHome,
    personalPerMemberHome: input.personalBudget.perMember,
  },
});

const COMMON_EXPENSE_IDS = expensesHome
  .filter((expense) => expense.splitMode !== "BY_GROUP")
  .map((expense) => expense.id);

const FLIGHT_BY_GROUP = new Map(
  expensesHome
    .filter((expense) => expense.splitMode === "BY_GROUP")
    .map((expense) => [expense.groupId as string, expense]),
);

/** 取某成員在指定幾筆支出上的分攤額合計 */
function shareSum(memberId: string, expenseIds: string[]): Decimal {
  return expenseIds.reduce((acc, expenseId) => {
    const share = summary.sharesByExpense
      .get(expenseId)
      ?.find((entry) => entry.memberId === memberId);
    return acc.plus(share?.shareHome ?? 0);
  }, new Money(0));
}

describe("新潟迴歸案例 · 匯率與換算", () => {
  it("JPY 走行程固定匯率 0.25，TWD 為 1，來源皆為 TRIP_FIXED", () => {
    expectMoney(rateFor("JPY"), expected.rateUsed.JPY, "JPY 匯率");
    expectMoney(rateFor("TWD"), expected.rateUsed.TWD, "TWD 匯率");
    for (const expense of expensesHome) {
      expect(expense.rateSource, `${expense.id} 匯率來源`).toBe("TRIP_FIXED");
    }
  });

  it("每筆支出的記帳幣換算值", () => {
    for (const expense of expensesHome) {
      expectMoney(
        expense.amountHome,
        expected.expenseAmountHome[expense.id],
        `${expense.id} amountHome`,
      );
    }
  });

  it("住宿B 溯源自洽：249,821 ÷ 3 = 83,273.666̄", () => {
    const perRoom = new Money(249821).dividedBy(3);
    expectMoney(
      perRoom.toDecimalPlaces(6, Money.ROUND_HALF_UP),
      expected.lodgeBPerRoom,
      "住宿B 每間房",
    );
  });
});

describe("新潟迴歸案例 · 共同分攤", () => {
  it("共同支出合計 = 228,050.25 TWD", () => {
    const total = COMMON_EXPENSE_IDS.reduce((acc, expenseId) => {
      const expense = expensesHome.find((item) => item.id === expenseId);
      return acc.plus(expense?.amountHome ?? 0);
    }, new Money(0));
    expectMoney(total, expected.commonTotalHome, "共同支出合計");
  });

  it("每人真共同項分攤 = 22,805.025（10 人皆同，無尾差）", () => {
    for (const member of input.members) {
      expectMoney(
        shareSum(member.id, COMMON_EXPENSE_IDS),
        expected.perMemberCommonShare,
        `${member.id} 共同項分攤`,
      );
    }
  });

  it("公費 30,000 JPY/人 = 7,500 TWD", () => {
    expectMoney(fundPerMemberHome, expected.fundPerMemberHome, "每人公費");
  });

  it("每人不含機票總額 = 65,305.025（共同項 + 公費 + 個人消費）", () => {
    for (const member of summary.perMember) {
      const exFlight = shareSum(member.memberId, COMMON_EXPENSE_IDS)
        .plus(member.fund)
        .plus(member.personal);
      expectMoney(
        exFlight,
        expected.perMemberExFlight,
        `${member.memberId} 不含機票總額`,
      );
    }
  });
});

describe("新潟迴歸案例 · 機票按組計價", () => {
  it("各組每人機票分攤（非付款人）= 8,330.333333 / 7,693 / 11,438", () => {
    for (const [groupId, expense] of FLIGHT_BY_GROUP) {
      const nonPayers = input.members.filter(
        (member) => member.groupId === groupId && member.id !== expense.payerId,
      );
      expect(nonPayers.length, `${groupId} 非付款人數`).toBeGreaterThan(0);
      for (const member of nonPayers) {
        expectMoney(
          shareSum(member.id, [expense.id]),
          expected.flightPerMember[groupId],
          `${member.id} 機票分攤`,
        );
      }
    }
  });

  it("機票分攤只落在該組成員身上", () => {
    for (const [groupId, expense] of FLIGHT_BY_GROUP) {
      const shares = summary.sharesByExpense.get(expense.id) ?? [];
      const groupMemberIds = new Set(
        input.members
          .filter((member) => member.groupId === groupId)
          .map((member) => member.id),
      );
      expect(shares.length, `${groupId} 分攤人數`).toBe(groupMemberIds.size);
      for (const share of shares) {
        expect(groupMemberIds.has(share.memberId), `${share.memberId} 應屬 ${groupId}`).toBe(true);
      }
    }
  });

  it("6dp 除不盡的尾差歸付款人：G1 機票餘 0.000002 落在 m01", () => {
    const g1 = FLIGHT_BY_GROUP.get("g1");
    expect(g1, "g1 機票支出").toBeDefined();
    const payerShare = shareSum(g1!.payerId, [g1!.id]);
    const nonPayerShare = new Money(expected.flightPerMember.g1);
    expectMoney(
      payerShare.minus(nonPayerShare),
      "0.000002",
      "G1 付款人吸收的尾差",
    );
  });
});

describe("新潟迴歸案例 · 每人總計與全團合計", () => {
  it("每人總計顯示值 = 73,635 / 72,998 / 76,743（HALF_UP 取整）", () => {
    for (const member of summary.perMember) {
      const groupId = member.groupId as string;
      expectMoney(
        roundForDisplay(member.total, homeCurrency),
        expected.perMemberTotalDisplay[groupId],
        `${member.memberId}（${groupId}）總計顯示值`,
      );
    }
  });

  it("全團 10 人合計：精確 741,294.25 / 顯示 741,294", () => {
    expectMoney(summary.grandTotal, expected.grandTotalExact, "全團精確合計");
    expectMoney(
      roundForDisplay(summary.grandTotal, homeCurrency),
      expected.grandTotalDisplay,
      "全團顯示合計",
    );
  });

  it("換回日圓 = ¥2,965,177", () => {
    const jpyEquivalent = summary.grandTotal.dividedBy(rateFor("JPY"));
    expectMoney(
      jpyEquivalent,
      expected.grandTotalJpyEquivalent,
      "全團日圓約當",
    );
  });

  it("分類加總：支出 316,294.25 + 公費 75,000 + 個人消費 350,000", () => {
    expectMoney(summary.expenseTotal, expected.expenseTotalHome, "支出合計");
    expectMoney(summary.fundTotal, expected.fundTotalHome, "公費合計");
    expectMoney(summary.personalTotal, expected.personalTotalHome, "個人消費合計");
  });

  it("交叉驗證：逐人加總 ≡ 分類加總，差額為 0", () => {
    expectMoney(
      crossCheckDifference(summary),
      expected.crossCheckDifference,
      "交叉驗證差額",
    );
  });
});

describe("新潟迴歸案例 · 守恆", () => {
  it("逐筆支出的 Σshares 嚴格等於 amountHome", () => {
    for (const expense of expensesHome) {
      const shares = summary.sharesByExpense.get(expense.id) ?? [];
      const total = shares.reduce(
        (acc, share) => acc.plus(share.shareHome),
        new Money(0),
      );
      expectMoney(total, expense.amountHome.toString(), `${expense.id} 守恆`);
    }
  });

  it("全體分攤額合計 ≡ 全部支出合計", () => {
    const allShares = input.members.reduce(
      (acc, member) =>
        acc.plus(
          shareSum(
            member.id,
            expensesHome.map((expense) => expense.id),
          ),
        ),
      new Money(0),
    );
    expectMoney(allShares, expected.expenseTotalHome, "全體分攤額合計");
  });
});
