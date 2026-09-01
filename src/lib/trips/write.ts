import type Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { getDailyRate } from "@/lib/fx/frankfurter";
import { Money } from "@/lib/money/decimal";
import { convertToHome, resolveRate } from "@/lib/money/convert";
import { toDbAmount, toDbFactor, toDbRate } from "@/lib/money/fromDb";
import { splitExpense, type SplitParticipant } from "@/lib/money/split";
import type {
  GroupFormInput,
  MemberFormInput,
  TripFormInput,
} from "@/lib/schemas/trip";
import type { ExpenseFormInput } from "@/lib/schemas/expense";

/**
 * 行程／成員／組別／支出的寫入層。
 *
 * 為何獨立於 Server Actions：Server Action 只能在 Next.js 執行環境跑，若把
 * 「解析匯率 → 換算 → 分攤 → 落地」直接寫在 action 函式裡，這段最關鍵的邏輯
 * 就無法像 P1 的 money/ 模組那樣被單獨測試。這裡的函式是純 Node 可測的。
 *
 * ★ 匯率快照原則（CLAUDE.md 鐵律 2）：updateTrip 只改 Trip 欄位本身，絕不
 * 回頭改寫既有 Expense 的 rateUsed／amountHome。行程固定匯率變更只影響
 * 「之後新建的支出」。
 */

/** 把 Trip.fixedRates（Json）正規化成 Record<幣別, 匯率字串> */
function parseFixedRates(json: unknown): Record<string, string> {
  if (json === null || typeof json !== "object") return {};
  const result: Record<string, string> = {};
  for (const [currency, rate] of Object.entries(json as Record<string, unknown>)) {
    if (typeof rate === "string") result[currency] = rate;
  }
  return result;
}

function buildFixedRatesJson(
  rows: TripFormInput["fixedRates"],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.currency] = toDbRate(row.rate);
  }
  return result;
}

// ---------------------------------------------------------------- Trip ----

export async function createTrip(
  input: TripFormInput,
): Promise<{ id: string }> {
  const trip = await prisma.trip.create({
    data: {
      name: input.name,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      homeCurrency: input.homeCurrency,
      fixedRates: buildFixedRatesJson(input.fixedRates),
    },
  });
  return { id: trip.id };
}

export async function updateTrip(
  tripId: string,
  input: TripFormInput,
): Promise<void> {
  await prisma.trip.update({
    where: { id: tripId },
    data: {
      name: input.name,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      homeCurrency: input.homeCurrency,
      fixedRates: buildFixedRatesJson(input.fixedRates),
    },
  });
}

// --------------------------------------------------------------- Group ----

export async function createGroup(
  input: GroupFormInput,
): Promise<{ id: string }> {
  const group = await prisma.group.create({
    data: { tripId: input.tripId, name: input.name },
  });
  return { id: group.id };
}

export async function renameGroup(
  groupId: string,
  name: string,
): Promise<void> {
  await prisma.group.update({ where: { id: groupId }, data: { name } });
}

/**
 * 刪除組別。成員的 groupId 由資料庫外鍵設為 SET NULL（migration 已定義），
 * 不會連帶刪除成員；BY_GROUP 支出的分攤結果是寫入時就落地的快照，不受影響
 * （schema 未替 Expense 存 groupId，這是刻意的，見 IMPLEMENTATION.md §4）。
 */
export async function deleteGroup(groupId: string): Promise<void> {
  await prisma.group.delete({ where: { id: groupId } });
}

// -------------------------------------------------------------- Member ----

export async function createMember(
  input: MemberFormInput,
): Promise<{ id: string }> {
  const member = await prisma.member.create({
    data: {
      tripId: input.tripId,
      name: input.name,
      groupId: input.groupId,
    },
  });
  return { id: member.id };
}

export async function updateMember(
  memberId: string,
  input: MemberFormInput,
): Promise<void> {
  await prisma.member.update({
    where: { id: memberId },
    data: {
      name: input.name,
      groupId: input.groupId,
    },
  });
}

/**
 * 刪除成員。若該成員已有分攤紀錄（ExpenseShare），資料庫外鍵會擋下刪除
 * （ON DELETE RESTRICT，保護既有金額紀錄不被連帶抹除），這裡把 Prisma 的
 * 外鍵錯誤代碼 P2003 轉成使用者看得懂的訊息。
 *
 * 已知限制：若該成員是某筆支出的付款人（payerId）但沒有分攤紀錄，刪除仍會
 * 成功、payerId 會被資料庫設為 null（SET NULL），該筆支出會變成「無付款人」。
 * P2 範圍內接受此行為，之後如需保留付款人歷史需另外處理。
 */
export async function deleteMember(memberId: string): Promise<void> {
  try {
    await prisma.member.delete({ where: { id: memberId } });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new Error("此成員已有分攤紀錄，無法刪除");
    }
    throw error;
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2003"
  );
}

// ------------------------------------------------------------- Expense ----

interface ResolvedExpense {
  currency: string;
  amountOriginal: string;
  rateSource: "TRIP_FIXED" | "DAILY_REF" | "MANUAL";
  rateUsed: string;
  amountHome: string;
  shares: Array<{ memberId: string; shareHome: string }>;
  fundSpend: boolean;
  /** fundSpend 為 true 時才有值；解析時已確認金額幣別與此公費一致 */
  fundId: string | null;
}

/**
 * 解析匯率、換算、分攤——建立與更新支出共用的核心邏輯，回傳的即是可以直接
 * 寫入 Expense／ExpenseShare 的欄位值。
 */
async function resolveExpense(
  input: ExpenseFormInput,
): Promise<ResolvedExpense> {
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: input.tripId },
    include: { members: true, funds: true },
  });
  const tripFixedRates = parseFixedRates(trip.fixedRates);

  // 公費支付：幣別鎖定必須等於公費本身的幣別（P4 裁示，見 CLAUDE.md 進度
  // 日誌）——公費是一筆單一幣別的池子，跨幣別支用需要額外匯率換算，
  // 目前沒有這個需求就不先做，之後真有需要再加。
  const fund = trip.funds[0] ?? null;
  if (input.fundSpend) {
    if (fund === null) {
      throw new Error("這個行程還沒有公費池，無法標記「由公費支付」");
    }
    if (input.currency.toUpperCase() !== fund.currency.toUpperCase()) {
      throw new Error(
        `由公費支付的支出，幣別必須是公費幣別 ${fund.currency}（目前選的是 ${input.currency}）`,
      );
    }
  }

  let dailyRefRate: string | undefined;
  const needsExternalRate =
    input.currency.toUpperCase() !== trip.homeCurrency.toUpperCase() &&
    tripFixedRates[input.currency] === undefined &&
    input.manualRate === undefined;

  if (needsExternalRate) {
    const paidAtDateOnly = input.paidAt.slice(0, 10);
    const daily = await getDailyRate({
      base: input.currency,
      quote: trip.homeCurrency,
      date: paidAtDateOnly,
    });
    if (daily === null) {
      throw new Error(
        `找不到 ${input.currency} → ${trip.homeCurrency} 的匯率：行程未設定固定匯率、` +
          "未手動輸入，且參考匯率服務暫時無法使用。請手動輸入匯率。",
      );
    }
    dailyRefRate = daily.rate.toString();
  }

  const resolution = resolveRate({
    currency: input.currency,
    homeCurrency: trip.homeCurrency,
    tripFixedRates,
    manualRate: input.manualRate,
    dailyRefRate,
  });
  const amountHome = convertToHome({
    amountOriginal: input.amountOriginal,
    rate: resolution.rate,
  });

  const participants = buildParticipants(input, trip.members);
  const groupId = input.splitMode === "BY_GROUP" ? input.groupId : null;

  if (
    (input.splitMode === "EQUAL" || input.splitMode === "WEIGHT") &&
    !input.participantIds.includes(input.payerId)
  ) {
    throw new Error(
      "付款人必須包含在分攤名單內。若付款人本身不參與這筆分攤，請改用「按組計價」，" +
        "或另外記一筆由付款人單獨負擔的支出。",
    );
  }

  const result = splitExpense({
    amountHome,
    mode: input.splitMode,
    participants,
    payerId: input.payerId,
    groupId,
  });

  return {
    currency: input.currency,
    amountOriginal: toDbAmount(input.amountOriginal),
    rateSource: resolution.source,
    rateUsed: toDbRate(resolution.rate),
    amountHome: toDbAmount(amountHome),
    shares: result.shares.map((share) => ({
      memberId: share.memberId,
      shareHome: toDbAmount(share.shareHome),
    })),
    fundSpend: input.fundSpend,
    fundId: input.fundSpend ? (fund?.id ?? null) : null,
  };
}

function buildParticipants(
  input: ExpenseFormInput,
  tripMembers: Array<{
    id: string;
    groupId: string | null;
  }>,
): SplitParticipant[] {
  switch (input.splitMode) {
    case "EQUAL":
      return input.participantIds.map((memberId) => ({ memberId }));
    case "WEIGHT": {
      // 權重是這一筆支出當下決定的（見 schemas/expense.ts 說明），不是查
      // 成員的固定屬性；未指定的參與者不設 weight，split.ts 預設為 1
      const weightByMember = new Map(input.weights.map((row) => [row.memberId, row.weight]));
      return input.participantIds.map((memberId) => ({
        memberId,
        weight: weightByMember.get(memberId),
      }));
    }
    case "BY_GROUP":
      return tripMembers.map((member) => ({
        memberId: member.id,
        groupId: member.groupId,
      }));
    case "EXACT":
      return input.exactShares.map((row) => ({
        memberId: row.memberId,
        exactShare: row.amount,
      }));
  }
}

/** 拍照解析出的品項，建支出時可一併落地成 LineItem（見 P3 收據解析） */
export interface ReceiptLineItemInput {
  nameRaw: string;
  nameZh: string | null;
  qty: number;
  unitPrice: number | null;
  amount: number;
  taxRate: number | null;
  category: string | null;
}

/**
 * 「確認入帳」來自收據時的額外落地內容：品項明細＋把 Receipt 與這筆
 * Expense 綁回去（Receipt.expenseId）。
 */
export interface ReceiptContext {
  receiptId: string;
  lineItems: ReceiptLineItemInput[];
}

/**
 * §5.2 的 unit_price 允許 null（收據讀不到單價欄），但 schema 的
 * `LineItem.unitPrice` 是必填欄位（§4，未改過）。這不是臨時湊數：
 * qty 與 amount 都在時，單價的數學定義就是 amount ÷ qty，不算「發明數值」
 * （提示詞第 2 條禁止的是憑空猜金額，不是算術推導）。
 *
 * ★ 除法本身必須經過 Money，不能先用裸 JS number 做 `amount / qty` 再包
 * 進 Decimal——那樣除法這一步本身就是用 float 表示金錢，違反 CLAUDE.md
 * 鐵律 1，即使結果馬上被 toDbAmount() 收斂也於事無補（浮點誤差已經在
 * 除法當下發生）。
 *
 * qty/amount 本身仍是 Claude 回應剛解析出來的 JSON number（未經任何運算
 * 污染，跟 fx/frankfurter.ts 讀 Frankfurter 回應數字同一類），直接餵給
 * Money 建構子是安全的——不必也不該經過 fromDb()（那是「讀我們自己資料庫」
 * 的邊界，不是「讀外部 API 回應」的邊界）。
 */
function resolveUnitPrice(item: ReceiptLineItemInput): Decimal {
  if (item.unitPrice !== null) return new Money(item.unitPrice);
  return new Money(item.amount).dividedBy(item.qty);
}

/**
 * 建立支出＋分攤明細，同一交易內完成，避免出現「有支出沒分攤」的中間態。
 *
 * receiptContext 存在時，先在交易外確認這張收據還沒被別的支出用掉——
 * 沒有這道檢查的話，表單重複送出（雙擊、送出後按上一頁再送一次）會對同一張
 * 收據建出兩筆支出、各自複製一份 LineItem，Receipt.expenseId 最後只會指向
 * 最後寫入的那筆，等於悄悄弄丟第一筆支出與收據的關聯。放在交易外先查，
 * 失敗時給清楚訊息，不要讓 Prisma 的 P2025 原始錯誤一路冒到使用者畫面。
 */
export async function createExpense(
  input: ExpenseFormInput,
  receiptContext?: ReceiptContext,
): Promise<{ id: string }> {
  if (receiptContext !== undefined) {
    const receipt = await prisma.receipt.findUnique({
      where: { id: receiptContext.receiptId },
    });
    if (receipt === null) {
      throw new Error("找不到這張收據，可能已被刪除");
    }
    if (receipt.expenseId !== null) {
      throw new Error("這張收據已經建立過支出，請勿重複送出");
    }
  }

  const resolved = await resolveExpense(input);
  const expenseId = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        tripId: input.tripId,
        payerId: input.payerId,
        paidAt: new Date(input.paidAt),
        category: input.category,
        description: input.description,
        currency: resolved.currency,
        amountOriginal: resolved.amountOriginal,
        rateSource: resolved.rateSource,
        rateUsed: resolved.rateUsed,
        amountHome: resolved.amountHome,
        splitMode: input.splitMode,
        fundSpend: resolved.fundSpend,
      },
    });
    await tx.expenseShare.createMany({
      data: resolved.shares.map((share) => ({
        expenseId: expense.id,
        memberId: share.memberId,
        shareHome: share.shareHome,
      })),
    });

    if (resolved.fundSpend && resolved.fundId !== null) {
      await tx.fundEntry.create({
        data: {
          fundId: resolved.fundId,
          type: "SPEND",
          amount: resolved.amountOriginal,
          linkedExpenseId: expense.id,
          // 明確帶 paidAt，不要吃 schema 的 @default(now())——公費帳本要照
          // 支出實際發生的日期排序，不是「這筆支出是什麼時候被記進系統」。
          occurredAt: new Date(input.paidAt),
        },
      });
    }

    if (receiptContext !== undefined) {
      if (receiptContext.lineItems.length > 0) {
        await tx.lineItem.createMany({
          data: receiptContext.lineItems.map((item) => ({
            expenseId: expense.id,
            nameRaw: item.nameRaw,
            nameZh: item.nameZh,
            qty: toDbFactor(item.qty),
            unitPrice: toDbAmount(resolveUnitPrice(item)),
            amount: toDbAmount(item.amount),
            taxRate: item.taxRate === null ? null : toDbFactor(item.taxRate),
            category: item.category,
          })),
        });
      }
      await tx.receipt.update({
        where: { id: receiptContext.receiptId },
        data: { expenseId: expense.id },
      });
    }

    return expense.id;
  });
  return { id: expenseId };
}

/** 更新支出：重新解析匯率與分攤，整批替換 ExpenseShare（同一交易內完成） */
export async function updateExpense(
  expenseId: string,
  input: ExpenseFormInput,
): Promise<void> {
  const resolved = await resolveExpense(input);
  await prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: expenseId },
      data: {
        payerId: input.payerId,
        paidAt: new Date(input.paidAt),
        category: input.category,
        description: input.description,
        currency: resolved.currency,
        amountOriginal: resolved.amountOriginal,
        rateSource: resolved.rateSource,
        rateUsed: resolved.rateUsed,
        amountHome: resolved.amountHome,
        splitMode: input.splitMode,
        fundSpend: resolved.fundSpend,
      },
    });
    await tx.expenseShare.deleteMany({ where: { expenseId } });
    await tx.expenseShare.createMany({
      data: resolved.shares.map((share) => ({
        expenseId,
        memberId: share.memberId,
        shareHome: share.shareHome,
      })),
    });

    // linkedExpenseId 是純欄位、沒有 DB 層外鍵（見 schema.prisma FundEntry），
    // 不會隨 Expense 異動自動同步——每次更新都先砍舊的、金額或幣別若變了
    // 也不會留下對不上的殘影，還在公費支付就重建一筆對齊最新金額。
    await tx.fundEntry.deleteMany({ where: { linkedExpenseId: expenseId } });
    if (resolved.fundSpend && resolved.fundId !== null) {
      await tx.fundEntry.create({
        data: {
          fundId: resolved.fundId,
          type: "SPEND",
          amount: resolved.amountOriginal,
          linkedExpenseId: expenseId,
          occurredAt: new Date(input.paidAt),
        },
      });
    }
  });
}

/**
 * 刪除支出。ExpenseShare／LineItem／Receipt 皆為 ON DELETE CASCADE，一併清除；
 * FundEntry.linkedExpenseId 沒有 DB 層外鍵（見 schema.prisma），得手動清，
 * 否則會留下指向不存在支出的公費支用記錄。
 */
export async function deleteExpense(expenseId: string): Promise<void> {
  await prisma.$transaction([
    prisma.fundEntry.deleteMany({ where: { linkedExpenseId: expenseId } }),
    prisma.expense.delete({ where: { id: expenseId } }),
  ]);
}

// --------------------------------------------------------------- Fund -----

/** 每個行程最多一個公費池——目前 UI／schema 都只設計成單池，先建先贏 */
export async function createFund(input: {
  tripId: string;
  name: string;
  currency: string;
}): Promise<{ id: string }> {
  const [existing, trip] = await Promise.all([
    prisma.fund.findFirst({ where: { tripId: input.tripId } }),
    prisma.trip.findUniqueOrThrow({ where: { id: input.tripId } }),
  ]);
  if (existing !== null) {
    throw new Error("這個行程已經有公費池了");
  }
  const currency = input.currency.toUpperCase();
  const tripFixedRates = parseFixedRates(trip.fixedRates);
  const isHomeCurrency = currency === trip.homeCurrency.toUpperCase();
  // 公費彙總（report.ts）沒有「單筆手動輸入匯率」這回事——公費是整池共用同一
  // 個幣別，只能靠行程固定匯率換算，所以建立當下就得擋掉解析不出來的幣別，
  // 不然要等到出報表才炸開。
  if (!isHomeCurrency && tripFixedRates[currency] === undefined) {
    throw new Error(
      `公費幣別 ${currency} 沒有對應的行程固定匯率，請先到行程設定新增 ${currency} → ${trip.homeCurrency} 的固定匯率，或改用記帳幣 ${trip.homeCurrency} 建立公費池`,
    );
  }
  const fund = await prisma.fund.create({
    data: { tripId: input.tripId, name: input.name, currency },
  });
  return { id: fund.id };
}

/** 提撥：只有這個方向能手動新增，支用一律由 createExpense/updateExpense 自動記 */
export async function createFundContribution(input: {
  fundId: string;
  memberId: string;
  amount: string;
  note?: string;
}): Promise<{ id: string }> {
  const entry = await prisma.fundEntry.create({
    data: {
      fundId: input.fundId,
      memberId: input.memberId,
      type: "CONTRIBUTION",
      amount: toDbAmount(input.amount),
      note: input.note,
    },
  });
  return { id: entry.id };
}

/**
 * 刪除一筆手動提撥。只允許刪 CONTRIBUTION——SPEND 是支出的附屬記錄
 * （linkedExpenseId 指回某筆 Expense），要改動請去改或刪那筆支出，
 * 不能在這裡直接刪，否則公費餘額會跟支出記錄各說各話。
 */
export async function deleteFundContribution(entryId: string): Promise<void> {
  const entry = await prisma.fundEntry.findUniqueOrThrow({ where: { id: entryId } });
  if (entry.type !== "CONTRIBUTION") {
    throw new Error("支用記錄跟著支出走，請到對應的支出頁面修改或刪除");
  }
  await prisma.fundEntry.delete({ where: { id: entryId } });
}
