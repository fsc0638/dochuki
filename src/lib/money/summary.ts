import type Decimal from "decimal.js";
import { Money, type MoneyInput } from "./decimal";
import { toStorageScale } from "./round";
import { splitExpense, type SplitMode, type SplitShare } from "./split";

/**
 * 行程彙總。
 *
 * 為什麼彙總邏輯要放在 money/ 而不是寫在報表或測試裡：迴歸測試必須驗證
 * 「正式產出報表時真正跑的那段程式」。若測試自己加總一次、P3 報表再各自
 * 加總一次，兩邊會分歧，迴歸就守不住產品程式碼。依 CLAUDE.md 程式慣例
 * 「任何金額計算集中在 src/lib/money/」，這裡是唯一入口。
 */

export interface SummaryMember {
  memberId: string;
  groupId?: string | null;
  /** WEIGHT 模式使用 */
  weight?: MoneyInput;
}

export interface SummaryExpense {
  id: string;
  /** 記帳幣金額（已由 convert.ts 換算） */
  amountHome: MoneyInput;
  splitMode: SplitMode;
  payerId: string | null;
  /** BY_GROUP 模式使用 */
  groupId?: string | null;
  /** EXACT 模式使用：memberId → 指定金額 */
  exactShares?: Record<string, MoneyInput>;
  /** true = 由公費支付，不進個人分攤（schema Expense.fundSpend） */
  fundSpend?: boolean;
}

export interface SummaryExtras {
  /** 每人公費提撥，記帳幣約當 */
  fundPerMemberHome?: MoneyInput;
  /** 每人個人消費（預估或實際），記帳幣 */
  personalPerMemberHome?: MoneyInput;
}

export interface MemberTotal {
  memberId: string;
  groupId: string | null;
  /** 各筆支出分攤額合計 */
  expenseShare: Decimal;
  fund: Decimal;
  personal: Decimal;
  total: Decimal;
}

export interface TripSummary {
  perMember: MemberTotal[];
  /** expenseId → 該筆的分攤明細，供落地成 ExpenseShare 與報表明細使用 */
  sharesByExpense: Map<string, SplitShare[]>;
  /** 分類加總：全部支出的記帳幣合計（不含 fundSpend 筆） */
  expenseTotal: Decimal;
  fundTotal: Decimal;
  personalTotal: Decimal;
  /** 分類加總總計 = expenseTotal + fundTotal + personalTotal */
  grandTotal: Decimal;
}

export function summarizeTrip(args: {
  members: SummaryMember[];
  expenses: SummaryExpense[];
  extras?: SummaryExtras;
}): TripSummary {
  const { members, expenses } = args;
  const fundPerMember = toStorageScale(args.extras?.fundPerMemberHome ?? 0);
  const personalPerMember = toStorageScale(
    args.extras?.personalPerMemberHome ?? 0,
  );

  const shareTotals = new Map<string, Decimal>(
    members.map((m) => [m.memberId, new Money(0)]),
  );
  const sharesByExpense = new Map<string, SplitShare[]>();
  let expenseTotal = new Money(0);

  for (const expense of expenses) {
    // 公費支付的支出不進個人分攤（CLAUDE.md 公費池語意）
    if (expense.fundSpend === true) continue;

    const participants = members.map((member) => ({
      memberId: member.memberId,
      groupId: member.groupId ?? null,
      weight: member.weight,
      exactShare: expense.exactShares?.[member.memberId],
    }));

    const result = splitExpense({
      amountHome: expense.amountHome,
      mode: expense.splitMode,
      participants,
      payerId: expense.payerId,
      groupId: expense.groupId ?? null,
    });

    sharesByExpense.set(expense.id, result.shares);
    expenseTotal = expenseTotal.plus(expense.amountHome);

    for (const share of result.shares) {
      const previous = shareTotals.get(share.memberId);
      if (previous === undefined) {
        throw new Error(
          `支出 ${expense.id} 的分攤出現不在成員名單中的 ${share.memberId}`,
        );
      }
      shareTotals.set(share.memberId, previous.plus(share.shareHome));
    }
  }

  const perMember: MemberTotal[] = members.map((member) => {
    const expenseShare = shareTotals.get(member.memberId) ?? new Money(0);
    return {
      memberId: member.memberId,
      groupId: member.groupId ?? null,
      expenseShare,
      fund: fundPerMember,
      personal: personalPerMember,
      total: expenseShare.plus(fundPerMember).plus(personalPerMember),
    };
  });

  const memberCount = new Money(members.length);
  const fundTotal = fundPerMember.times(memberCount);
  const personalTotal = personalPerMember.times(memberCount);

  return {
    perMember,
    sharesByExpense,
    expenseTotal,
    fundTotal,
    personalTotal,
    grandTotal: expenseTotal.plus(fundTotal).plus(personalTotal),
  };
}

/**
 * 交叉驗證（CLAUDE.md 迴歸案例最後一列）：逐人加總 ≡ 分類加總。
 * 回傳差額，正確時必須為 0。
 */
export function crossCheckDifference(summary: TripSummary): Decimal {
  const byMember = summary.perMember.reduce(
    (acc, member) => acc.plus(member.total),
    new Money(0),
  );
  return byMember.minus(summary.grandTotal);
}
