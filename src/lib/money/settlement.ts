import type Decimal from "decimal.js";
import { Money, type MoneyInput } from "./decimal";

export interface SettlementMemberInput {
  memberId: string;
  /** 該成員代墊總額（作為 payer，已排除公費支付的支出——那筆錢是公費池出的，不是他自己的錢） */
  paidHome: MoneyInput;
  /** 該成員應分攤總額（已排除公費支付的支出） */
  shareHome: MoneyInput;
}

export interface SettlementTransfer {
  fromMemberId: string;
  toMemberId: string;
  amountHome: Decimal;
}

interface Balance {
  memberId: string;
  remaining: Decimal;
}

/**
 * 清償計畫：把「每人代墊了多少」與「每人該分攤多少」的差額，轉成一份
 * 轉帳筆數盡量少的建議清單。
 *
 * 演算法是貪心法（每次讓目前欠最多的人轉給目前該收最多的人），不是嚴格
 * 意義上「筆數最少」的最優解（那是 NP-hard 的子集合加總問題）；但貪心法
 * 在實務金額分布下已經非常接近最優，且是 Splitwise 等主流分帳工具採用
 * 的同一類做法，用複雜度換來的筆數差距在真實旅遊團人數規模下可忽略。
 *
 * 不變式（由 assertBalanced 在回傳前實際驗證）：Σ transfers.amountHome
 * 對每個人的淨影響，必須讓所有人的淨結餘歸零。
 */
export function computeSettlement(
  members: SettlementMemberInput[],
): SettlementTransfer[] {
  const balances = members
    .map((m) => ({
      memberId: m.memberId,
      net: new Money(m.paidHome).minus(new Money(m.shareHome)),
    }))
    .filter((b) => !b.net.isZero());

  const creditors: Balance[] = balances
    .filter((b) => b.net.isPositive())
    .map((b) => ({ memberId: b.memberId, remaining: b.net }))
    .sort((a, b) => sortByAmountDescThenId(a, b));

  const debtors: Balance[] = balances
    .filter((b) => b.net.isNegative())
    .map((b) => ({ memberId: b.memberId, remaining: b.net.abs() }))
    .sort((a, b) => sortByAmountDescThenId(a, b));

  const transfers: SettlementTransfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = Money.min(creditor.remaining, debtor.remaining);

    if (!amount.isZero()) {
      transfers.push({
        fromMemberId: debtor.memberId,
        toMemberId: creditor.memberId,
        amountHome: amount,
      });
    }

    creditor.remaining = creditor.remaining.minus(amount);
    debtor.remaining = debtor.remaining.minus(amount);
    if (creditor.remaining.isZero()) ci++;
    if (debtor.remaining.isZero()) di++;
  }

  assertBalanced(members, transfers);
  return transfers;
}

function sortByAmountDescThenId(a: Balance, b: Balance): number {
  if (!a.remaining.equals(b.remaining)) {
    return a.remaining.greaterThan(b.remaining) ? -1 : 1;
  }
  return a.memberId < b.memberId ? -1 : 1;
}

/** 守恆檢查：套用全部轉帳後，每個人的淨結餘必須精確歸零 */
function assertBalanced(
  members: SettlementMemberInput[],
  transfers: SettlementTransfer[],
): void {
  const net = new Map<string, Decimal>(
    members.map((m) => [
      m.memberId,
      new Money(m.paidHome).minus(new Money(m.shareHome)),
    ]),
  );
  for (const transfer of transfers) {
    net.set(
      transfer.fromMemberId,
      (net.get(transfer.fromMemberId) ?? new Money(0)).plus(transfer.amountHome),
    );
    net.set(
      transfer.toMemberId,
      (net.get(transfer.toMemberId) ?? new Money(0)).minus(transfer.amountHome),
    );
  }
  for (const [memberId, remaining] of net) {
    if (!remaining.isZero()) {
      throw new Error(
        `清償計畫守恆失敗：成員 ${memberId} 套用轉帳後淨結餘為 ${remaining.toString()}，應為 0`,
      );
    }
  }
}
