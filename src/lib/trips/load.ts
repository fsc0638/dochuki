import type Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { Money } from "@/lib/money/decimal";
import { fromDb } from "@/lib/money/fromDb";
import { summarizeFund } from "@/lib/money/fund";

/**
 * 行程讀取層。
 *
 * 刻意不重新呼叫 money/summary.ts 的 splitExpense 來源計算——ExpenseShare
 * 表本身就是「分攤引擎在寫入當下算出的最終結果」（EQUAL/WEIGHT/BY_GROUP 是
 * 引擎輸出、EXACT 本身就是指定值），讀取只需要彙總已落地的資料，不必也不該
 * 重新分攤一次（重分攤還會因為成員權重之後被改掉而得到不同答案，違反「支出
 * 分攤是寫入當下的快照」原則，與 rateUsed 的快照精神一致）。
 */

export async function loadTrip(tripId: string) {
  return prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      groups: { orderBy: { name: "asc" } },
      members: {
        include: { group: true },
        orderBy: { name: "asc" },
      },
      funds: true,
    },
  });
}

export async function listTrips() {
  return prisma.trip.findMany({ orderBy: { startDate: "desc" } });
}

export interface ExpenseFilter {
  category?: string;
  /** 只顯示「這位成員有分攤」的支出 */
  memberId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function loadExpenses(tripId: string, filter: ExpenseFilter = {}) {
  return prisma.expense.findMany({
    where: {
      tripId,
      category: filter.category === undefined ? undefined : filter.category,
      paidAt: {
        gte: filter.dateFrom === undefined ? undefined : new Date(filter.dateFrom),
        lte: filter.dateTo === undefined ? undefined : new Date(filter.dateTo),
      },
      shares:
        filter.memberId === undefined
          ? undefined
          : { some: { memberId: filter.memberId } },
    },
    include: { payer: true, shares: true },
    orderBy: { paidAt: "desc" },
  });
}

export async function loadExpenseForEdit(expenseId: string) {
  return prisma.expense.findUnique({
    where: { id: expenseId },
    include: { shares: true },
  });
}

/**
 * 由既有 ExpenseShare 反推 BY_GROUP 支出當初選的組別：找出「現在成員名單」
 * 與分攤名單完全相同的組別。
 *
 * 已知限制：schema 未替 Expense 存 groupId（見 IMPLEMENTATION.md §4），若組別
 * 成員名單在建立支出【之後】被改動過，可能推不出來或推錯。推不出來時回傳
 * null，編輯頁需請使用者重新選擇組別。
 */
export async function inferByGroupSelection(
  tripId: string,
  shareMemberIds: string[],
): Promise<string | null> {
  const groups = await prisma.group.findMany({
    where: { tripId },
    include: { members: true },
  });
  const shareSet = new Set(shareMemberIds);
  for (const group of groups) {
    const groupMemberIds = new Set(group.members.map((m) => m.id));
    if (
      groupMemberIds.size === shareSet.size &&
      [...groupMemberIds].every((id) => shareSet.has(id))
    ) {
      return group.id;
    }
  }
  return null;
}

export interface MemberTotal {
  memberId: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  /** 分攤小計（不含公費、不含個人消費預估——P2 範圍就是帳本本身，見 CLAUDE.md 進度日誌） */
  expenseShareTotal: Decimal;
}

export async function loadMemberTotals(tripId: string): Promise<MemberTotal[]> {
  const members = await prisma.member.findMany({
    where: { tripId },
    include: { group: true },
    orderBy: { name: "asc" },
  });

  // 加總下推到 PostgreSQL 做（NUMERIC 加總是精確運算，不需要在 JS 端逐筆迴圈）
  const grouped = await prisma.expenseShare.groupBy({
    by: ["memberId"],
    where: { expense: { tripId, fundSpend: false } },
    _sum: { shareHome: true },
  });
  const totals = new Map(
    grouped.map((row) => [row.memberId, fromDb(row._sum.shareHome ?? 0)]),
  );

  return members.map((member) => ({
    memberId: member.id,
    name: member.name,
    groupId: member.groupId,
    groupName: member.group?.name ?? null,
    expenseShareTotal: totals.get(member.id) ?? new Money(0),
  }));
}

export interface FundEntryView {
  id: string;
  type: "CONTRIBUTION" | "SPEND";
  memberId: string | null;
  memberName: string | null;
  amount: Decimal;
  linkedExpenseId: string | null;
  linkedExpenseDescription: string | null;
  note: string | null;
  occurredAt: Date;
}

export interface FundView {
  id: string;
  name: string;
  currency: string;
  entries: FundEntryView[];
  contributionTotal: Decimal;
  spendTotal: Decimal;
  balance: Decimal;
}

export async function loadFund(tripId: string): Promise<FundView | null> {
  const fund = await prisma.fund.findFirst({
    where: { tripId },
    include: {
      entries: {
        include: { member: true },
        orderBy: { occurredAt: "desc" },
      },
    },
  });
  if (fund === null) return null;

  const linkedExpenseIds = fund.entries
    .map((e) => e.linkedExpenseId)
    .filter((id): id is string => id !== null);
  const linkedExpenses =
    linkedExpenseIds.length === 0
      ? []
      : await prisma.expense.findMany({
          where: { id: { in: linkedExpenseIds } },
          select: { id: true, description: true },
        });
  const descriptionByExpenseId = new Map(linkedExpenses.map((e) => [e.id, e.description]));

  const entries: FundEntryView[] = fund.entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    memberId: entry.memberId,
    memberName: entry.member?.name ?? null,
    amount: fromDb(entry.amount),
    linkedExpenseId: entry.linkedExpenseId,
    linkedExpenseDescription:
      entry.linkedExpenseId === null ? null : (descriptionByExpenseId.get(entry.linkedExpenseId) ?? null),
    note: entry.note,
    occurredAt: entry.occurredAt,
  }));

  const balance = summarizeFund(entries.map((e) => ({ type: e.type, amount: e.amount })));

  return {
    id: fund.id,
    name: fund.name,
    currency: fund.currency,
    entries,
    contributionTotal: balance.contributionTotal,
    spendTotal: balance.spendTotal,
    balance: balance.balance,
  };
}
