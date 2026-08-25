import type Decimal from "decimal.js";
import { Money, type MoneyInput } from "./decimal";
import { toStorageScale } from "./round";

/**
 * 公費池彙總。跟 split.ts／summary.ts 同一套分工：純函式，只吃已經是
 * 公費幣別（Fund.currency）的金額，不做任何幣別換算——換算成記帳幣是
 * 呼叫端（報表讀取層）用 convert.ts 的責任，這裡只負責同幣別金額的加總。
 */

export interface FundEntryInput {
  type: "CONTRIBUTION" | "SPEND";
  /** 公費幣別金額（Fund.currency） */
  amount: MoneyInput;
}

export interface FundBalance {
  contributionTotal: Decimal;
  spendTotal: Decimal;
  /** = contributionTotal − spendTotal */
  balance: Decimal;
}

/** 公費收支總覽：Σ提撥、Σ支用、餘額（公費幣別） */
export function summarizeFund(entries: FundEntryInput[]): FundBalance {
  let contributionTotal = new Money(0);
  let spendTotal = new Money(0);
  for (const entry of entries) {
    const amount = toStorageScale(entry.amount);
    if (entry.type === "CONTRIBUTION") {
      contributionTotal = contributionTotal.plus(amount);
    } else {
      spendTotal = spendTotal.plus(amount);
    }
  }
  return {
    contributionTotal,
    spendTotal,
    balance: contributionTotal.minus(spendTotal),
  };
}
