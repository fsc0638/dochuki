import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { convertToHome, resolveRate } from "../src/lib/money/convert";
import { toDbAmount, toDbRate } from "../src/lib/money/fromDb";
import { splitExpense } from "../src/lib/money/split";
import { loadNiigataInput } from "../src/lib/schemas/niigata";

/**
 * 匯入新潟・佐渡 10 人團迴歸 fixture。
 *
 * 資料來源與 tests/money.regression.test.ts 共用 fixtures/niigata/input.json，
 * 兩者不得各自持有一份輸入——否則 DB 內容與測試斷言會在無人察覺下分歧。
 *
 * 可重複執行：只清除並重建本行程（trip-niigata-2026）的資料，不動其他行程。
 */

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === "") {
  throw new Error("缺少環境變數 DATABASE_URL（複製 .env.example 成 .env）");
}

// Prisma 7 的 Rust-free client 必須搭配 driver adapter，不能直接 new PrismaClient()。
// P2 接上 Server Actions／RSC 時要抽成共用的 client 模組，避免每處各自建連線池。
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main(): Promise<void> {
  const input = loadNiigataInput();
  const tripId = input.trip.id;
  const homeCurrency = input.trip.homeCurrency;

  // --- 清除本行程既有資料（外鍵安全順序）---
  await prisma.expenseShare.deleteMany({ where: { expense: { tripId } } });
  await prisma.lineItem.deleteMany({ where: { expense: { tripId } } });
  await prisma.receipt.deleteMany({ where: { expense: { tripId } } });
  await prisma.fundEntry.deleteMany({ where: { fund: { tripId } } });
  await prisma.fund.deleteMany({ where: { tripId } });
  await prisma.expense.deleteMany({ where: { tripId } });
  await prisma.member.deleteMany({ where: { tripId } });
  await prisma.group.deleteMany({ where: { tripId } });
  await prisma.trip.deleteMany({ where: { id: tripId } });

  // --- 行程 ---
  await prisma.trip.create({
    data: {
      id: tripId,
      name: input.trip.name,
      startDate: new Date(input.trip.startDate),
      endDate: new Date(input.trip.endDate),
      homeCurrency,
      fixedRates: input.trip.fixedRates,
    },
  });

  // --- 組別與成員 ---
  for (const group of input.groups) {
    await prisma.group.create({
      data: { id: group.id, tripId, name: group.name },
    });
  }
  for (const member of input.members) {
    await prisma.member.create({
      data: {
        id: member.id,
        tripId,
        groupId: member.groupId,
        name: member.name,
      },
    });
  }

  // --- 支出與分攤 ---
  const participants = input.members.map((member) => ({
    memberId: member.id,
    groupId: member.groupId,
  }));

  for (const expense of input.expenses) {
    const resolution = resolveRate({
      currency: expense.currency,
      homeCurrency,
      tripFixedRates: input.trip.fixedRates,
    });
    const amountHome = convertToHome({
      amountOriginal: expense.amountOriginal,
      rate: resolution.rate,
    });

    await prisma.expense.create({
      data: {
        id: expense.id,
        tripId,
        payerId: expense.payerId,
        paidAt: new Date(expense.paidAt),
        category: expense.category,
        description: expense.description,
        currency: expense.currency,
        // 寫入一律經 toDb*：金額 6 位、匯率 8 位，不把捨入交給 PostgreSQL 隱式處理
        amountOriginal: toDbAmount(expense.amountOriginal),
        rateSource: resolution.source,
        rateUsed: toDbRate(resolution.rate),
        amountHome: toDbAmount(amountHome),
        splitMode: expense.splitMode,
      },
    });

    const result = splitExpense({
      amountHome,
      mode: expense.splitMode,
      participants,
      payerId: expense.payerId,
      groupId: expense.groupId ?? null,
    });

    await prisma.expenseShare.createMany({
      data: result.shares.map((share) => ({
        expenseId: expense.id,
        memberId: share.memberId,
        shareHome: toDbAmount(share.shareHome),
      })),
    });
  }

  // --- 個人消費：每人各一筆單人 Expense（splitMode EQUAL、參與者只有自己）---
  // P4 裁示：不新增 schema 欄位（維持 P2「不做個人消費預估欄位」的決定），
  // 個人消費就是一筆一人參與的普通支出，跟其他支出走同一套 resolveRate／
  // splitExpense 路徑，見 fixtures/niigata/input.json 的 personalBudget._comment。
  for (const member of input.members) {
    const resolution = resolveRate({
      currency: input.personalBudget.currency,
      homeCurrency,
      tripFixedRates: input.trip.fixedRates,
    });
    const amountHome = convertToHome({
      amountOriginal: input.personalBudget.perMember,
      rate: resolution.rate,
    });

    const expense = await prisma.expense.create({
      data: {
        tripId,
        payerId: member.id,
        paidAt: new Date(input.trip.startDate),
        category: "雜項",
        description: "個人消費（預估）",
        currency: input.personalBudget.currency,
        amountOriginal: toDbAmount(input.personalBudget.perMember),
        rateSource: resolution.source,
        rateUsed: toDbRate(resolution.rate),
        amountHome: toDbAmount(amountHome),
        splitMode: "EQUAL",
      },
    });

    const result = splitExpense({
      amountHome,
      mode: "EQUAL",
      participants: [{ memberId: member.id, groupId: member.groupId }],
      payerId: member.id,
      groupId: null,
    });
    await prisma.expenseShare.createMany({
      data: result.shares.map((share) => ({
        expenseId: expense.id,
        memberId: share.memberId,
        shareHome: toDbAmount(share.shareHome),
      })),
    });
  }

  // --- 公費池：每人提撥一筆 CONTRIBUTION ---
  const fund = await prisma.fund.create({
    data: {
      tripId,
      name: input.fund.name,
      currency: input.fund.currency,
    },
  });
  await prisma.fundEntry.createMany({
    data: input.members.map((member) => ({
      fundId: fund.id,
      memberId: member.id,
      type: "CONTRIBUTION" as const,
      amount: toDbAmount(input.fund.contributionPerMember),
      note: `${input.fund.name}提撥`,
    })),
  });

  // --- 摘要（不含任何金額明細以外的資訊，避免把收據內容寫進 log）---
  const shareCount = await prisma.expenseShare.count({
    where: { expense: { tripId } },
  });
  console.log(
    [
      `已匯入行程「${input.trip.name}」（${tripId}）`,
      `  組別 ${input.groups.length}／成員 ${input.members.length}`,
      `  支出 ${input.expenses.length + input.members.length} 筆（共同 ${input.expenses.length}＋個人消費 ${input.members.length}）、分攤明細 ${shareCount} 列`,
      `  公費提撥 ${input.members.length} 筆 × ${input.fund.contributionPerMember} ${input.fund.currency}`,
      `  個人消費 ${input.members.length} 筆 × ${input.personalBudget.perMember} ${input.personalBudget.currency}/人（真實 Expense，非 schema 欄位）`,
    ].join("\n"),
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
