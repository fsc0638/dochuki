import type Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { convertToHome, resolveRate } from "@/lib/money/convert";
import { Money } from "@/lib/money/decimal";
import { fromDb } from "@/lib/money/fromDb";
import { summarizeFund } from "@/lib/money/fund";
import { ReceiptParseSchema } from "@/lib/schemas/receipt";

/**
 * 報表讀取層。CSV／Excel／PDF 三種格式共用同一個 loadReportData()——
 * CLAUDE.md §P4 要求「三檔數字必須互相一致且與畫面一致（同一計算入口）」，
 * 三個 renderer 各自吃同一份 ReportData，不得各自重新查詢或重新加總。
 *
 * 跟 load.ts 的 loadMemberTotals() 同一套原則：彙總已落地的 ExpenseShare／
 * FundEntry，不重新呼叫 money/summary.ts 的分攤引擎（那是寫入當下才做的事）。
 *
 * 個人消費（P4 裁示）：不是獨立 schema 欄位，就是「只有一位參與者的支出」
 * ——用 shares.length === 1 判斷，不看 category 或 description。
 */

export interface ReportLineItemRow {
  expenseId: string;
  date: Date;
  tripName: string;
  groupName: string | null;
  payerName: string | null;
  category: string;
  description: string;
  itemNameRaw: string | null;
  itemNameZh: string | null;
  qty: Decimal | null;
  unitPrice: Decimal | null;
  currency: string;
  amountOriginal: Decimal;
  rateUsed: Decimal;
  amountTwd: Decimal;
  taxRate: Decimal | null;
  store: string | null;
  address: string | null;
  paymentMethod: string | null;
  splitMode: string;
  fundSpend: boolean;
  receiptId: string | null;
}

export interface ReportExpense {
  id: string;
  date: Date;
  category: string;
  description: string;
  currency: string;
  amountOriginal: Decimal;
  amountHome: Decimal;
  splitMode: string;
  fundSpend: boolean;
  groupId: string | null;
  groupName: string | null;
  payerId: string | null;
  payerName: string | null;
  shares: Array<{ memberId: string; shareHome: Decimal }>;
  /** 只有一位參與者＝個人消費（P4 裁示，見檔頭註解） */
  isPersonal: boolean;
}

export interface ReportMemberTotal {
  memberId: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  expenseShareTotal: Decimal;
  fundContribution: Decimal;
  total: Decimal;
}

export interface ReportFundEntry {
  id: string;
  memberId: string | null;
  memberName: string | null;
  type: "CONTRIBUTION" | "SPEND";
  amount: Decimal;
  linkedExpenseId: string | null;
  linkedExpenseDescription: string | null;
  note: string | null;
  occurredAt: Date;
}

export interface ReportFxRateUsed {
  currency: string;
  rateUsed: Decimal;
  rateSource: string;
}

export interface ReportCategoryTotal {
  category: string;
  currency: string;
  amountTwd: Decimal;
}

export interface ReportReceipt {
  receiptId: string;
  expenseId: string;
  expenseDescription: string;
  /** 相對於 RECEIPT_STORAGE_DIR 的檔名，PDF 縮圖索引頁用來讀取原圖 */
  imagePath: string;
}

export interface ReportData {
  trip: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    homeCurrency: string;
  };
  expenses: ReportExpense[];
  lineItemRows: ReportLineItemRow[];
  perMember: ReportMemberTotal[];
  fund: { id: string; name: string; currency: string } | null;
  fundEntries: ReportFundEntry[];
  fundBalance: { contributionTotal: Decimal; spendTotal: Decimal; balance: Decimal };
  fxRatesUsed: ReportFxRateUsed[];
  categoryTotals: ReportCategoryTotal[];
  receipts: ReportReceipt[];
  /** 共同項目（非 BY_GROUP、非個人消費、非公費支付） */
  commonExpenses: ReportExpense[];
  /** 按組計價項目（splitMode BY_GROUP） */
  byGroupExpenses: ReportExpense[];
  /** 個人消費（只有一位參與者，見檔頭註解） */
  personalExpenses: ReportExpense[];
  expenseTotal: Decimal;
  fundTotal: Decimal;
  personalTotal: Decimal;
  grandTotal: Decimal;
}

export async function loadReportData(tripId: string): Promise<ReportData> {
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    include: {
      members: { include: { group: true }, orderBy: { name: "asc" } },
      funds: { include: { entries: { include: { member: true } } } },
      expenses: {
        include: {
          payer: true,
          shares: { include: { member: { include: { group: true } } } },
          lineItems: true,
          receipts: true,
        },
        orderBy: { paidAt: "asc" },
      },
    },
  });

  // 組名不用再查一次 DB——trip.members[].group 跟 expense.shares[].member.group
  // 已經把「行程裡出現過的每個組別」的名字帶回來了，同一個請求裡兩份資料
  // 本來就是同一批列，直接組一個查找表即可
  const groupNameById = new Map<string, string>();
  for (const member of trip.members) {
    if (member.group !== null) groupNameById.set(member.group.id, member.group.name);
  }

  // BY_GROUP 支出的所有分攤者屬於同一組；其餘模式（含個人消費）沒有單一對應組別。
  // 個人消費＝「只有一位參與者的支出」，但 BY_GROUP 排在判斷之前——組別剛好只剩
  // 一人時，該筆仍然是「按組計價」，不能被 isPersonal 搶去分類成個人消費（否則
  // PDF 會同時出現在區塊一的機票表與區塊三，重複列出）。
  function resolveExpenseGroup(
    splitMode: string,
    shares: { member: { groupId: string | null } }[],
  ): { groupId: string | null; groupName: string | null } {
    if (splitMode !== "BY_GROUP") return { groupId: null, groupName: null };
    const groupId = shares[0]?.member.groupId ?? null;
    return { groupId, groupName: groupId === null ? null : (groupNameById.get(groupId) ?? null) };
  }

  const expenses: ReportExpense[] = trip.expenses.map((expense) => {
    const shares = expense.shares.map((share) => ({
      memberId: share.memberId,
      shareHome: fromDb(share.shareHome),
    }));
    const { groupId, groupName } = resolveExpenseGroup(expense.splitMode, expense.shares);
    return {
      id: expense.id,
      date: expense.paidAt,
      category: expense.category,
      description: expense.description,
      currency: expense.currency,
      amountOriginal: fromDb(expense.amountOriginal),
      amountHome: fromDb(expense.amountHome),
      splitMode: expense.splitMode,
      fundSpend: expense.fundSpend,
      groupId,
      groupName,
      payerId: expense.payerId,
      payerName: expense.payer?.name ?? null,
      shares,
      isPersonal: expense.splitMode !== "BY_GROUP" && shares.length === 1,
    };
  });
  const expenseById = new Map(expenses.map((e) => [e.id, e]));

  // --- 逐品項明細列（CSV／Excel 明細表共用）---
  const lineItemRows: ReportLineItemRow[] = trip.expenses.flatMap((expense) => {
    const receipt = expense.receipts[0];
    const parsed = receipt?.parseJson === null || receipt?.parseJson === undefined
      ? null
      : ReceiptParseSchema.safeParse(receipt.parseJson);
    const store = parsed?.success === true ? parsed.data.store_zh ?? parsed.data.store : null;
    const address = parsed?.success === true ? parsed.data.address : null;
    const paymentMethod = parsed?.success === true ? parsed.data.payment_method : null;
    const rateUsed = fromDb(expense.rateUsed);
    // 跟上面 expenses 陣列算的是同一筆支出，直接查表取用，不重算一次
    const resolved = expenseById.get(expense.id);

    const base = {
      expenseId: expense.id,
      date: expense.paidAt,
      tripName: trip.name,
      groupName: resolved?.groupName ?? null,
      payerName: expense.payer?.name ?? null,
      category: expense.category,
      description: expense.description,
      currency: expense.currency,
      rateUsed,
      store: store ?? null,
      address: address ?? null,
      paymentMethod: paymentMethod ?? null,
      splitMode: expense.splitMode,
      fundSpend: expense.fundSpend,
      receiptId: receipt?.id ?? null,
    };

    if (expense.lineItems.length === 0) {
      const row: ReportLineItemRow = {
        ...base,
        itemNameRaw: null,
        itemNameZh: null,
        qty: null,
        unitPrice: null,
        taxRate: null,
        amountOriginal: fromDb(expense.amountOriginal),
        amountTwd: fromDb(expense.amountHome),
      };
      return [row];
    }

    return expense.lineItems.map((item): ReportLineItemRow => {
      const itemAmount = fromDb(item.amount);
      return {
        ...base,
        itemNameRaw: item.nameRaw,
        itemNameZh: item.nameZh,
        qty: fromDb(item.qty),
        unitPrice: fromDb(item.unitPrice),
        taxRate: item.taxRate === null ? null : fromDb(item.taxRate),
        amountOriginal: itemAmount,
        amountTwd: itemAmount.times(rateUsed),
      };
    });
  });

  // --- 公費 ---
  const fund = trip.funds[0] ?? null;
  const fundEntries: ReportFundEntry[] = (fund?.entries ?? []).map((entry) => {
    const linkedExpense =
      entry.linkedExpenseId === null
        ? null
        : (expenses.find((e) => e.id === entry.linkedExpenseId) ?? null);
    return {
      id: entry.id,
      memberId: entry.memberId,
      memberName: entry.member?.name ?? null,
      type: entry.type,
      amount: fromDb(entry.amount),
      linkedExpenseId: entry.linkedExpenseId,
      linkedExpenseDescription: linkedExpense?.description ?? null,
      note: entry.note,
      occurredAt: entry.occurredAt,
    };
  });
  const fundBalance = summarizeFund(fundEntries.map((e) => ({ type: e.type, amount: e.amount })));

  // 公費幣別 → 記帳幣：跟其他支出同一套 resolveRate，行程固定匯率優先
  let fundContributionByMemberHome = new Map<string, Decimal>();
  if (fund !== null) {
    const tripFixedRates = parseTripFixedRates(trip.fixedRates);
    const resolution = resolveRate({
      currency: fund.currency,
      homeCurrency: trip.homeCurrency,
      tripFixedRates,
    });
    fundContributionByMemberHome = new Map(
      fundEntries
        .filter((e) => e.type === "CONTRIBUTION" && e.memberId !== null)
        .map((e) => [
          e.memberId as string,
          convertToHome({ amountOriginal: e.amount, rate: resolution.rate }),
        ]),
    );
  }

  // --- 每人總計：分攤（含個人消費，已經是同一個 shares 陣列）＋公費提撥 ---
  const shareTotalByMember = new Map<string, Decimal>();
  for (const expense of expenses) {
    if (expense.fundSpend) continue;
    for (const share of expense.shares) {
      shareTotalByMember.set(
        share.memberId,
        (shareTotalByMember.get(share.memberId) ?? new Money(0)).plus(share.shareHome),
      );
    }
  }
  const perMember: ReportMemberTotal[] = trip.members.map((member) => {
    const expenseShareTotal = shareTotalByMember.get(member.id) ?? new Money(0);
    const fundContribution = fundContributionByMemberHome.get(member.id) ?? new Money(0);
    return {
      memberId: member.id,
      name: member.name,
      groupId: member.groupId,
      groupName: member.group?.name ?? null,
      expenseShareTotal,
      fundContribution,
      total: expenseShareTotal.plus(fundContribution),
    };
  });

  // --- 分類彙總（category × 幣別，記帳幣金額）---
  // key 只用來去重，category／currency 兩個欄位各自存在 value 裡、不從 key
  // 反切出來——category 是使用者自由輸入的文字（見 schemas/expense.ts），
  // 可能含空白（例如「住宿 民宿」），拿單一空白組 key 再 split(" ") 反切
  // 會切錯，把 currency 那格吃掉、category 也被截斷。
  const categoryMap = new Map<string, ReportCategoryTotal>();
  for (const expense of expenses) {
    if (expense.fundSpend) continue;
    const key = `${expense.category} ${expense.currency}`;
    const amountTwd = (categoryMap.get(key)?.amountTwd ?? new Money(0)).plus(expense.amountHome);
    categoryMap.set(key, { category: expense.category, currency: expense.currency, amountTwd });
  }
  const categoryTotals: ReportCategoryTotal[] = [...categoryMap.values()];

  // --- 採用匯率清單（去重）---
  const fxRatesUsed: ReportFxRateUsed[] = [];
  const seenRates = new Set<string>();
  for (const expense of trip.expenses) {
    const key = `${expense.currency} ${expense.rateUsed.toString()} ${expense.rateSource}`;
    if (seenRates.has(key)) continue;
    seenRates.add(key);
    fxRatesUsed.push({
      currency: expense.currency,
      rateUsed: fromDb(expense.rateUsed),
      rateSource: expense.rateSource,
    });
  }

  // --- 收據縮圖索引（僅列有連結收據的支出）---
  const receipts: ReportReceipt[] = trip.expenses.flatMap((expense) =>
    expense.receipts.map((receipt) => ({
      receiptId: receipt.id,
      expenseId: expense.id,
      expenseDescription: expense.description,
      imagePath: receipt.imagePath,
    })),
  );

  const commonExpenses = expenses.filter(
    (e) => !e.fundSpend && e.splitMode !== "BY_GROUP" && !e.isPersonal,
  );
  const byGroupExpenses = expenses.filter((e) => !e.fundSpend && e.splitMode === "BY_GROUP");
  const personalExpenses = expenses.filter((e) => !e.fundSpend && e.isPersonal);

  const expenseTotal = expenses
    .filter((e) => !e.fundSpend)
    .reduce((acc, e) => acc.plus(e.amountHome), new Money(0));
  const fundTotal = perMember.reduce((acc, m) => acc.plus(m.fundContribution), new Money(0));
  // personalTotal 只是給報表拆分區塊用的「標籤」，它已經是 expenseTotal 的子集
  // （個人消費本來就是一筆普通 Expense），grandTotal 不得再把它加第二次。
  const personalTotal = personalExpenses.reduce((acc, e) => acc.plus(e.amountHome), new Money(0));

  return {
    trip: {
      id: trip.id,
      name: trip.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      homeCurrency: trip.homeCurrency,
    },
    expenses,
    lineItemRows,
    perMember,
    fund: fund === null ? null : { id: fund.id, name: fund.name, currency: fund.currency },
    fundEntries,
    fundBalance,
    fxRatesUsed,
    categoryTotals,
    receipts,
    commonExpenses,
    byGroupExpenses,
    personalExpenses,
    expenseTotal,
    fundTotal,
    personalTotal,
    grandTotal: expenseTotal.plus(fundTotal),
  };
}

function parseTripFixedRates(json: unknown): Record<string, string> {
  if (json === null || typeof json !== "object") return {};
  const result: Record<string, string> = {};
  for (const [currency, rate] of Object.entries(json as Record<string, unknown>)) {
    if (typeof rate === "string") result[currency] = rate;
  }
  return result;
}
