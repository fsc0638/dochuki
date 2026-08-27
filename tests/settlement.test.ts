import { describe, expect, it } from "vitest";
import { Money } from "@/lib/money/decimal";
import {
  computeSettlement,
  type SettlementMemberInput,
  type SettlementTransfer,
} from "@/lib/money/settlement";

/** 驗證套用全部轉帳後，每個人的淨結餘（paidHome − shareHome）精確歸零 */
function expectFullyBalanced(
  members: SettlementMemberInput[],
  transfers: SettlementTransfer[],
): void {
  const net = new Map(
    members.map((m) => [m.memberId, new Money(m.paidHome).minus(new Money(m.shareHome))]),
  );
  for (const t of transfers) {
    net.set(t.fromMemberId, net.get(t.fromMemberId)!.plus(t.amountHome));
    net.set(t.toMemberId, net.get(t.toMemberId)!.minus(t.amountHome));
  }
  for (const [memberId, remaining] of net) {
    expect(remaining.toString(), `${memberId} 淨結餘應歸零`).toBe("0");
  }
}

describe("computeSettlement", () => {
  it("三人鏈式債務：A 欠 B、B 欠 C，應直接合併成 A 轉給 C 一筆", () => {
    // A 代墊 0、該分攤 100（欠 100）；B 代墊 100、該分攤 100（淨額 0，中間人）；
    // C 代墊 100、該分攤 0（該收 100）
    const members: SettlementMemberInput[] = [
      { memberId: "A", paidHome: 0, shareHome: 100 },
      { memberId: "B", paidHome: 100, shareHome: 100 },
      { memberId: "C", paidHome: 100, shareHome: 0 },
    ];
    const transfers = computeSettlement(members);
    expect(transfers).toHaveLength(1);
    expect(transfers[0].fromMemberId).toBe("A");
    expect(transfers[0].toMemberId).toBe("C");
    expect(transfers[0].amountHome.toString()).toBe("100");
    expectFullyBalanced(members, transfers);
  });

  it("全部人淨結餘為 0 時，回傳空清單", () => {
    const members: SettlementMemberInput[] = [
      { memberId: "A", paidHome: 500, shareHome: 500 },
      { memberId: "B", paidHome: 0, shareHome: 0 },
    ];
    const transfers = computeSettlement(members);
    expect(transfers).toHaveLength(0);
  });

  it("空成員清單回傳空清單", () => {
    expect(computeSettlement([])).toHaveLength(0);
  });

  it("兩債權人兩債務人，且金額無法一對一整除時仍正確拆分並守恆", () => {
    // A 欠 150、B 欠 50；C 該收 100、D 該收 100
    const members: SettlementMemberInput[] = [
      { memberId: "A", paidHome: 0, shareHome: 150 },
      { memberId: "B", paidHome: 0, shareHome: 50 },
      { memberId: "C", paidHome: 100, shareHome: 0 },
      { memberId: "D", paidHome: 100, shareHome: 0 },
    ];
    const transfers = computeSettlement(members);
    expectFullyBalanced(members, transfers);
    // 貪心法：最大債務人(A,150) 配最大債權人(C 或 D，同額時取 memberId 較小者)
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers.length).toBeLessThanOrEqual(3);
  });

  it("金額有 6 位小數尾差時仍精確守恆，不出現浮點誤差", () => {
    // 100 元 3 人均分：33.333333 / 33.333333 / 33.333334（尾差歸付款人）
    const members: SettlementMemberInput[] = [
      { memberId: "payer", paidHome: 100, shareHome: "33.333334" },
      { memberId: "m2", paidHome: 0, shareHome: "33.333333" },
      { memberId: "m3", paidHome: 0, shareHome: "33.333333" },
    ];
    const transfers = computeSettlement(members);
    expectFullyBalanced(members, transfers);
    const total = transfers.reduce((acc, t) => acc.plus(t.amountHome), new Money(0));
    expect(total.toString()).toBe("66.666666");
  });

  it("排除公費支付的支出：呼叫端應在算 paidHome/shareHome 前就濾掉 fundSpend 支出", () => {
    // 這裡直接驗證 computeSettlement 本身不做任何幣別/公費相關的特殊判斷——
    // 排除邏輯的責任在 src/lib/trips/load.ts 的查詢條件（where fundSpend:false），
    // 純函式只認 paidHome/shareHome 這兩個已經算好的數字。
    const members: SettlementMemberInput[] = [
      { memberId: "A", paidHome: 1000, shareHome: 500 },
      { memberId: "B", paidHome: 0, shareHome: 500 },
    ];
    const transfers = computeSettlement(members);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ fromMemberId: "B", toMemberId: "A" });
    expect(transfers[0].amountHome.toString()).toBe("500");
  });

  it("同額淨結餘時，配對結果依 memberId 字典序穩定可重現", () => {
    const members: SettlementMemberInput[] = [
      { memberId: "z-debtor", paidHome: 0, shareHome: 100 },
      { memberId: "a-debtor", paidHome: 0, shareHome: 100 },
      { memberId: "creditor", paidHome: 200, shareHome: 0 },
    ];
    const first = computeSettlement(members);
    const second = computeSettlement(members);
    expect(first).toEqual(second);
    // 同額債務人之間，字典序較小的 a-debtor 應先被配對
    expect(first[0].fromMemberId).toBe("a-debtor");
  });
});
