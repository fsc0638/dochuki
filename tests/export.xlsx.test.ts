import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildExpenseWorkbook } from "@/lib/export/xlsx";
import { Money } from "@/lib/money/decimal";
import type { ReportData } from "@/lib/trips/report";

const SAMPLE_DATA: ReportData = {
  trip: { id: "t1", name: "測試行程", startDate: new Date(), endDate: new Date(), homeCurrency: "TWD" },
  expenses: [],
  lineItemRows: [
    {
      expenseId: "e1",
      date: new Date("2026-09-13T00:00:00Z"),
      tripName: "測試行程",
      groupName: null,
      payerName: "團員01",
      category: "餐飲",
      description: "便利商店",
      itemNameRaw: "おにぎり",
      itemNameZh: "飯糰",
      qty: new Money(1),
      unitPrice: new Money(150),
      currency: "JPY",
      amountOriginal: new Money(150),
      rateUsed: new Money("0.25"),
      amountTwd: new Money("37.5"),
      taxRate: new Money("0.08"),
      store: "7-11",
      address: null,
      paymentMethod: "現金",
      splitMode: "EQUAL",
      fundSpend: false,
      receiptId: null,
    },
  ],
  perMember: [
    {
      memberId: "m1",
      name: "團員01",
      groupId: "g1",
      groupName: "銀髮組",
      expenseShareTotal: new Money("37.5"),
      fundContribution: new Money(7500),
      total: new Money("7537.5"),
    },
  ],
  fund: { id: "f1", name: "公費", currency: "JPY" },
  fundEntries: [
    {
      id: "fe1",
      memberId: "m1",
      memberName: "團員01",
      type: "CONTRIBUTION",
      amount: new Money(30000),
      linkedExpenseId: null,
      linkedExpenseDescription: null,
      note: "公費提撥",
      occurredAt: new Date("2026-09-01T00:00:00Z"),
    },
  ],
  fundBalance: { contributionTotal: new Money(30000), spendTotal: new Money(0), balance: new Money(30000) },
  fxRatesUsed: [{ currency: "JPY", rateUsed: new Money("0.25"), rateSource: "TRIP_FIXED" }],
  categoryTotals: [{ category: "餐飲", currency: "JPY", amountTwd: new Money("37.5") }],
  receipts: [],
  commonExpenses: [],
  byGroupExpenses: [],
  personalExpenses: [],
  expenseTotal: new Money("37.5"),
  fundTotal: new Money(7500),
  personalTotal: new Money(0),
  grandTotal: new Money("7537.5"),
};

// exceljs 的 .d.ts 解析到跟這個專案不同份的 @types/node Buffer 型別
// （pnpm 嚴格依賴樹下常見的巢狀型別衝突），兩者結構上是同一份資料、
// 型別名稱卻對不上，`as never` 是繞過這個純型別層面誤判的標準寫法。
describe("buildExpenseWorkbook", () => {
  it("產出五個工作表，名稱依 §7 順序", async () => {
    const buffer = await buildExpenseWorkbook(SAMPLE_DATA);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      "明細",
      "分類彙總",
      "成員分攤",
      "公費收支",
      "匯率",
    ]);
  });

  it("明細工作表凍結首列", async () => {
    const buffer = await buildExpenseWorkbook(SAMPLE_DATA);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("明細");
    expect(sheet?.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("成員分攤工作表：資料列數 = 成員數 + 1（總計列）", async () => {
    const buffer = await buildExpenseWorkbook(SAMPLE_DATA);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("成員分攤");
    // rowCount 含表頭；1 位成員 + 1 表頭 + 1 總計 = 3
    // 用欄位編號而非 key 讀取——xlsx.load() 從真實檔案位元組重建工作表，
    // ExcelJS 的 column key 是記憶體內物件的便利映射，不是 OOXML 格式本身
    // 儲存的東西，round-trip 讀回來後 getCell('key') 認不得字串鍵
    expect(sheet?.rowCount).toBe(3);
    expect(sheet?.getRow(3).getCell(1).value).toBe("總計");
  });

  it("公費收支工作表最後一列是餘額，且金額等於 fundBalance.balance", async () => {
    const buffer = await buildExpenseWorkbook(SAMPLE_DATA);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("公費收支");
    const lastRow = sheet?.getRow(sheet.rowCount);
    expect(lastRow?.getCell(2).value).toBe("餘額");
    expect(lastRow?.getCell(5).value).toBe(30000);
  });
});
