import { describe, expect, it } from "vitest";
import { buildExpenseDetailCsv } from "@/lib/export/csv";
import { Money } from "@/lib/money/decimal";
import type { ReportData, ReportLineItemRow } from "@/lib/trips/report";

function emptyReportData(lineItemRows: ReportLineItemRow[]): ReportData {
  return {
    trip: { id: "t1", name: "測試行程", startDate: new Date(), endDate: new Date(), homeCurrency: "TWD" },
    expenses: [],
    lineItemRows,
    perMember: [],
    fund: null,
    fundEntries: [],
    fundBalance: { contributionTotal: new Money(0), spendTotal: new Money(0), balance: new Money(0) },
    fxRatesUsed: [],
    categoryTotals: [],
    receipts: [],
    commonExpenses: [],
    byGroupExpenses: [],
    personalExpenses: [],
    expenseTotal: new Money(0),
    fundTotal: new Money(0),
    personalTotal: new Money(0),
    grandTotal: new Money(0),
  };
}

const SAMPLE_ROW: ReportLineItemRow = {
  expenseId: "e1",
  date: new Date("2026-09-13T00:00:00Z"),
  tripName: "測試行程",
  groupName: null,
  payerName: "團員01",
  category: "餐飲",
  description: "便利商店，含逗號, 與換行\n測試",
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
  receiptId: "r1",
};

describe("buildExpenseDetailCsv", () => {
  it("開頭是 UTF-8 BOM", () => {
    const csv = buildExpenseDetailCsv(emptyReportData([SAMPLE_ROW]));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("第一行是依 §7 順序排列的表頭", () => {
    const csv = buildExpenseDetailCsv(emptyReportData([SAMPLE_ROW]));
    const firstLine = csv.slice(1).split("\r\n")[0];
    expect(firstLine).toBe(
      "expense_id,date,trip,group,payer,category,description,item_name_raw,item_name_zh,qty,unit_price,currency,amount_original,rate_used,amount_twd,tax_rate,store,address,payment_method,split_mode,fund_spend,receipt_id",
    );
  });

  it("含逗號與換行的欄位會被雙引號包住、內部雙引號轉義", () => {
    const csv = buildExpenseDetailCsv(emptyReportData([SAMPLE_ROW]));
    expect(csv).toContain('"便利商店，含逗號, 與換行\n測試"');
  });

  it("無品項的支出只輸出一列，品項欄位為空", () => {
    const noItemRow: ReportLineItemRow = { ...SAMPLE_ROW, itemNameRaw: null, itemNameZh: null, qty: null, unitPrice: null, taxRate: null };
    const csv = buildExpenseDetailCsv(emptyReportData([noItemRow]));
    const rows = csv.slice(1).trim().split("\r\n");
    expect(rows).toHaveLength(2); // 表頭 + 1 列
  });

  it("fund_spend 輸出小寫字串 true/false", () => {
    const csv = buildExpenseDetailCsv(emptyReportData([{ ...SAMPLE_ROW, fundSpend: true }]));
    expect(csv).toContain(",true,");
  });

  it("空 lineItemRows：只有表頭", () => {
    const csv = buildExpenseDetailCsv(emptyReportData([]));
    const rows = csv.slice(1).trim().split("\r\n");
    expect(rows).toHaveLength(1);
  });
});
