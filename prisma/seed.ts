import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { convertToHome, resolveRate } from "../src/lib/money/convert";
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
        amountOriginal: expense.amountOriginal,
        rateSource: resolution.source,
        rateUsed: resolution.rate.toString(),
        amountHome: amountHome.toString(),
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
        shareHome: share.shareHome.toString(),
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
      amount: input.fund.contributionPerMember,
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
      `  支出 ${input.expenses.length} 筆、分攤明細 ${shareCount} 列`,
      `  公費提撥 ${input.members.length} 筆 × ${input.fund.contributionPerMember} ${input.fund.currency}`,
      `  個人消費預估 ${input.personalBudget.perMember} ${input.personalBudget.currency}/人（schema 尚無對應欄位，未落地）`,
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
