import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { Money } from "@/lib/money/decimal";
import { fromDb } from "@/lib/money/fromDb";
import {
  inferByGroupSelection,
  loadExpenseForEdit,
  loadExpenses,
  loadMemberTotals,
  loadTrip,
} from "@/lib/trips/load";
import {
  createExpense,
  createGroup,
  createMember,
  createTrip,
  deleteExpense,
  deleteGroup,
  deleteMember,
  updateExpense,
  updateMember,
  updateTrip,
} from "@/lib/trips/write";

/**
 * P2 寫入層／讀取層測試。
 *
 * ★ 需要本機 docker compose 的 PostgreSQL 已啟動（同 tests/fx.frankfurter.test.ts）。
 *
 * 這裡驗證的是「orchestration」——rate 解析、split 呼叫、交易寫入、讀取彙總
 * 這條管線本身有沒有接對，不是重新驗證金額數學本身（那是 P1 的
 * money.regression.test.ts／split.test.ts 的職責，用 fixture 驗過了）。
 * 所以只用一個 3 人小情境，不重跑整個新潟 10 人案例。
 *
 * 全程使用獨立、測試專屬的 Trip（每個 it 各自 beforeAll 建立、afterAll 清除），
 * 不觸碰 seed 進去的 trip-niigata-2026，避免弄髒既有的迴歸驗證資料。
 */

async function purgeTrip(tripId: string): Promise<void> {
  await prisma.expenseShare.deleteMany({ where: { expense: { tripId } } });
  await prisma.expense.deleteMany({ where: { tripId } });
  await prisma.member.deleteMany({ where: { tripId } });
  await prisma.group.deleteMany({ where: { tripId } });
  await prisma.fxRate.deleteMany({ where: { quote: "XW1" } });
  await prisma.trip.deleteMany({ where: { id: tripId } });
}

describe("trips/write · trips/load", () => {
  let tripId: string;
  let groupId: string;
  let m1: string; // 銀髮組
  let m2: string; // 銀髮組
  let m3: string; // 無組別

  beforeAll(async () => {
    const trip = await createTrip({
      name: "P2 測試行程",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      homeCurrency: "TWD",
      fixedRates: [{ currency: "JPY", rate: "0.25" }],
    });
    tripId = trip.id;

    const group = await createGroup({ tripId, name: "測試組" });
    groupId = group.id;

    m1 = (await createMember({ tripId, name: "甲", groupId, weight: "1" })).id;
    m2 = (await createMember({ tripId, name: "乙", groupId, weight: "2" })).id;
    m3 = (await createMember({ tripId, name: "丙", groupId: null })).id;
  });

  afterAll(async () => {
    await purgeTrip(tripId);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("createTrip", () => {
    it("固定匯率以 8 位小數字串落地", async () => {
      const trip = await loadTrip(tripId);
      expect(trip?.homeCurrency).toBe("TWD");
      expect(trip?.fixedRates).toEqual({ JPY: "0.25000000" });
    });
  });

  describe("createMember / updateMember / deleteMember", () => {
    it("weight 以 4 位小數落地", async () => {
      const member = await prisma.member.findUniqueOrThrow({ where: { id: m2 } });
      expect(fromDb(member.weight).toString()).toBe("2");
    });

    it("刪除沒有分攤紀錄的成員：成功", async () => {
      const temp = await createMember({ tripId, name: "暫時成員", groupId: null });
      await deleteMember(temp.id);
      const found = await prisma.member.findUnique({ where: { id: temp.id } });
      expect(found).toBeNull();
    });

    it("updateMember：改名與改權重都會落地，且權重收斂到 4 位小數", async () => {
      const temp = await createMember({ tripId, name: "改名前", groupId: null, weight: "1" });
      await updateMember(temp.id, {
        tripId,
        name: "改名後",
        groupId,
        weight: "1.23455",
      });
      const updated = await prisma.member.findUniqueOrThrow({ where: { id: temp.id } });
      expect(updated.name).toBe("改名後");
      expect(updated.groupId).toBe(groupId);
      expect(fromDb(updated.weight).toString()).toBe("1.2346"); // 5 位 → HALF_UP 收斂到 4 位
      await deleteMember(temp.id);
    });
  });

  describe("createExpense · TRIP_FIXED（JPY，行程固定匯率）", () => {
    let expenseId: string;

    it("EQUAL：三人均分，Σshares ≡ amountHome", async () => {
      const expense = await createExpense({
        tripId,
        description: "午餐",
        category: "餐飲",
        paidAt: "2026-09-01T12:00:00+09:00",
        currency: "JPY",
        amountOriginal: "3000",
        payerId: m1,
        splitMode: "EQUAL",
        participantIds: [m1, m2, m3],
      });
      expenseId = expense.id;

      const row = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });
      expect(row.rateSource).toBe("TRIP_FIXED");
      expect(fromDb(row.rateUsed).toString()).toBe("0.25");
      expect(fromDb(row.amountHome).toString()).toBe("750"); // 3000 × 0.25

      const shares = await prisma.expenseShare.findMany({ where: { expenseId } });
      const total = shares.reduce((acc, s) => acc.plus(fromDb(s.shareHome)), new Money(0));
      expect(total.toString()).toBe("750");
      expect(shares).toHaveLength(3);
    });

    it("updateExpense：EQUAL → WEIGHT，舊 shares 被整批替換（不殘留 3 筆變 2 筆）", async () => {
      await updateExpense(expenseId, {
        tripId,
        description: "午餐（改權重分攤）",
        category: "餐飲",
        paidAt: "2026-09-01T12:00:00+09:00",
        currency: "JPY",
        amountOriginal: "3000",
        payerId: m1,
        splitMode: "WEIGHT",
        participantIds: [m1, m2], // 丙不再參與
      });

      const shares = await prisma.expenseShare.findMany({ where: { expenseId } });
      expect(shares).toHaveLength(2);
      // m1 weight=1, m2 weight=2 → 1:2 比例
      const byMember = new Map(shares.map((s) => [s.memberId, fromDb(s.shareHome)]));
      expect(byMember.get(m1)?.toString()).toBe("250");
      expect(byMember.get(m2)?.toString()).toBe("500");
    });

    it("deleteExpense：ExpenseShare 隨之刪除（cascade）", async () => {
      await deleteExpense(expenseId);
      const shares = await prisma.expenseShare.findMany({ where: { expenseId } });
      expect(shares).toHaveLength(0);
      const row = await prisma.expense.findUnique({ where: { id: expenseId } });
      expect(row).toBeNull();
    });
  });

  describe("createExpense · MANUAL（無行程固定匯率的幣別）", () => {
    it("採用 manualRate，來源記為 MANUAL", async () => {
      const expense = await createExpense({
        tripId,
        description: "美金消費",
        category: "購物",
        paidAt: "2026-09-01T10:00:00+08:00",
        currency: "USD",
        amountOriginal: "10",
        manualRate: "31.5",
        payerId: m1,
        splitMode: "EQUAL",
        participantIds: [m1, m2],
      });
      const row = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
      expect(row.rateSource).toBe("MANUAL");
      expect(fromDb(row.amountHome).toString()).toBe("315");
      await deleteExpense(expense.id);
    });
  });

  describe("createExpense · DAILY_REF（無固定匯率、無手動輸入 → 打參考匯率）", () => {
    it("成功取得時來源記為 DAILY_REF，並寫入 FxRate 快取", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { date: "2026-09-01", base: "XW1", quote: "TWD", rate: 5.5 },
        ],
      } as Response);

      const expense = await createExpense({
        tripId,
        description: "冷門幣別消費",
        category: "雜項",
        paidAt: "2026-09-01T09:00:00+08:00",
        currency: "XW1",
        amountOriginal: "100",
        payerId: m1,
        splitMode: "EQUAL",
        participantIds: [m1, m2],
      });

      const row = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
      expect(row.rateSource).toBe("DAILY_REF");
      expect(fromDb(row.amountHome).toString()).toBe("550"); // 100 × 5.5

      const cached = await prisma.fxRate.findFirst({ where: { base: "XW1", quote: "TWD" } });
      expect(cached).not.toBeNull();

      await deleteExpense(expense.id);
    });

    it("API 也失敗、無手動輸入：拋出可操作的錯誤訊息，不建立支出", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      } as Response);

      await expect(
        createExpense({
          tripId,
          description: "找不到匯率的支出",
          category: "雜項",
          paidAt: "2026-09-02T09:00:00+08:00",
          currency: "XW2",
          amountOriginal: "100",
          payerId: m1,
          splitMode: "EQUAL",
          participantIds: [m1, m2],
        }),
      ).rejects.toThrow(/請手動輸入匯率/);

      const count = await prisma.expense.count({ where: { tripId, currency: "XW2" } });
      expect(count).toBe(0);
    });
  });

  describe("createExpense · BY_GROUP", () => {
    it("只有組內成員取得分攤，付款人可在組外", async () => {
      const outsider = (await createMember({ tripId, name: "組外代墊人", groupId: null })).id;

      const expense = await createExpense({
        tripId,
        description: "組別活動費",
        category: "門票",
        paidAt: "2026-09-02T14:00:00+08:00",
        currency: "TWD",
        amountOriginal: "1000",
        payerId: outsider,
        splitMode: "BY_GROUP",
        groupId,
      });

      const shares = await prisma.expenseShare.findMany({ where: { expenseId: expense.id } });
      const memberIds = shares.map((s) => s.memberId).sort();
      expect(memberIds).toEqual([m1, m2].sort());
      expect(memberIds).not.toContain(outsider);

      const inferred = await inferByGroupSelection(tripId, memberIds);
      expect(inferred).toBe(groupId);

      await deleteExpense(expense.id);
      await deleteMember(outsider);
    });
  });

  describe("createExpense · EXACT", () => {
    it("總和相符：照指定金額落地", async () => {
      const expense = await createExpense({
        tripId,
        description: "分開算的晚餐",
        category: "餐飲",
        paidAt: "2026-09-02T19:00:00+08:00",
        currency: "TWD",
        amountOriginal: "1000",
        payerId: m1,
        splitMode: "EXACT",
        exactShares: [
          { memberId: m1, amount: "600" },
          { memberId: m2, amount: "400" },
        ],
      });
      const shares = await prisma.expenseShare.findMany({ where: { expenseId: expense.id } });
      const byMember = new Map(shares.map((s) => [s.memberId, fromDb(s.shareHome).toString()]));
      expect(byMember.get(m1)).toBe("600");
      expect(byMember.get(m2)).toBe("400");
      await deleteExpense(expense.id);
    });

    it("總和不符：拋出錯誤，不建立支出", async () => {
      await expect(
        createExpense({
          tripId,
          description: "總和算錯的晚餐",
          category: "餐飲",
          paidAt: "2026-09-02T19:00:00+08:00",
          currency: "TWD",
          amountOriginal: "1000",
          payerId: m1,
          splitMode: "EXACT",
          exactShares: [
            { memberId: m1, amount: "600" },
            { memberId: m2, amount: "300" },
          ],
        }),
      ).rejects.toThrow(/不符/);
    });
  });

  describe("createExpense · 付款人必須在分攤名單內（EQUAL/WEIGHT 的已知限制）", () => {
    it("付款人不在 participantIds 內：拋出可操作的錯誤", async () => {
      await expect(
        createExpense({
          tripId,
          description: "代墊但沒分攤",
          category: "雜項",
          paidAt: "2026-09-02T09:00:00+08:00",
          currency: "TWD",
          amountOriginal: "100",
          payerId: m3,
          splitMode: "EQUAL",
          participantIds: [m1, m2], // 丙代墊但不在分攤名單
        }),
      ).rejects.toThrow(/付款人必須包含在分攤名單內/);
    });
  });

  describe("deleteMember · 外鍵保護", () => {
    it("成員已有分攤紀錄：拒絕刪除並給友善訊息", async () => {
      const expense = await createExpense({
        tripId,
        description: "用來卡住刪除的支出",
        category: "雜項",
        paidAt: "2026-09-02T09:00:00+08:00",
        currency: "TWD",
        amountOriginal: "100",
        payerId: m1,
        splitMode: "EQUAL",
        participantIds: [m1, m2],
      });
      await expect(deleteMember(m1)).rejects.toThrow("此成員已有分攤紀錄，無法刪除");
      await deleteExpense(expense.id);
    });
  });

  describe("deleteGroup", () => {
    it("刪除組別後，成員 groupId 被設為 null（不連帶刪除成員）", async () => {
      const g = await createGroup({ tripId, name: "即將刪除的組" });
      const tempMember = await createMember({ tripId, name: "臨時成員", groupId: g.id });

      await deleteGroup(g.id);

      const member = await prisma.member.findUniqueOrThrow({ where: { id: tempMember.id } });
      expect(member.groupId).toBeNull();
      await deleteMember(tempMember.id);
    });
  });

  describe("loadMemberTotals / loadExpenses", () => {
    it("每人分攤小計 = 該成員參與過的所有 ExpenseShare 加總（排除 fundSpend）", async () => {
      const e1 = await createExpense({
        tripId,
        description: "A",
        category: "餐飲",
        paidAt: "2026-09-03T09:00:00+08:00",
        currency: "TWD",
        amountOriginal: "300",
        payerId: m1,
        splitMode: "EQUAL",
        participantIds: [m1, m2],
      });
      const e2 = await createExpense({
        tripId,
        description: "B",
        category: "交通",
        paidAt: "2026-09-03T15:00:00+08:00",
        currency: "TWD",
        amountOriginal: "100",
        payerId: m2,
        splitMode: "EQUAL",
        participantIds: [m2],
      });

      const totals = await loadMemberTotals(tripId);
      const m1Total = totals.find((t) => t.memberId === m1)?.expenseShareTotal;
      const m2Total = totals.find((t) => t.memberId === m2)?.expenseShareTotal;
      expect(m1Total?.toString()).toBe("150");
      expect(m2Total?.toString()).toBe("250"); // 150 + 100

      const byCategory = await loadExpenses(tripId, { category: "交通" });
      expect(byCategory.map((e) => e.id)).toEqual([e2.id]);

      const byMember = await loadExpenses(tripId, { memberId: m1 });
      expect(byMember.map((e) => e.id)).toEqual([e1.id]);

      const edit = await loadExpenseForEdit(e1.id);
      expect(edit?.shares).toHaveLength(2);

      await deleteExpense(e1.id);
      await deleteExpense(e2.id);
    });
  });

  describe("updateTrip · 不回溯既有支出（鐵律 2）", () => {
    it("改行程固定匯率後，既有支出的 rateUsed／amountHome 不變", async () => {
      const expense = await createExpense({
        tripId,
        description: "改匯率前的支出",
        category: "餐飲",
        paidAt: "2026-09-01T12:00:00+09:00",
        currency: "JPY",
        amountOriginal: "1000",
        payerId: m1,
        splitMode: "EQUAL",
        participantIds: [m1, m2],
      });
      const before = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });

      await updateTrip(tripId, {
        name: "P2 測試行程",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
        homeCurrency: "TWD",
        fixedRates: [{ currency: "JPY", rate: "0.30" }], // 改匯率
      });

      const after = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
      expect(fromDb(after.rateUsed).toString()).toBe(fromDb(before.rateUsed).toString());
      expect(fromDb(after.amountHome).toString()).toBe(fromDb(before.amountHome).toString());

      // 復原設定，避免影響後續測試
      await updateTrip(tripId, {
        name: "P2 測試行程",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
        homeCurrency: "TWD",
        fixedRates: [{ currency: "JPY", rate: "0.25" }],
      });
      await deleteExpense(expense.id);
    });
  });
});
