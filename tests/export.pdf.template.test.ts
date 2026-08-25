import { describe, expect, it } from "vitest";
import { buildReportHtml } from "@/lib/export/pdf/template";
import { Money } from "@/lib/money/decimal";
import type { ReportData } from "@/lib/trips/report";

const SAMPLE_DATA: ReportData = {
  trip: {
    id: "t1",
    name: "測試行程 <script>",
    startDate: new Date("2026-09-12T00:00:00Z"),
    endDate: new Date("2026-09-16T00:00:00Z"),
    homeCurrency: "TWD",
  },
  expenses: [],
  lineItemRows: [],
  perMember: [
    {
      memberId: "m1",
      name: "團員01",
      groupId: "g1",
      groupName: "銀髮組",
      expenseShareTotal: new Money("66135.358333"),
      fundContribution: new Money(7500),
      total: new Money("73635.358333"),
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
  categoryTotals: [],
  receipts: [{ receiptId: "r1", expenseId: "e1", expenseDescription: "便利商店", imagePath: "r1.jpg" }],
  commonExpenses: [
    {
      id: "e1",
      date: new Date("2026-09-12T00:00:00Z"),
      category: "餐飲",
      description: "共同餐費 & 點心 <b>粗體</b>",
      currency: "JPY",
      amountOriginal: new Money(1000),
      amountHome: new Money(250),
      splitMode: "EQUAL",
      fundSpend: false,
      groupId: null,
      groupName: null,
      payerId: "m1",
      payerName: "團員01",
      shares: [{ memberId: "m1", shareHome: new Money(250) }],
      isPersonal: false,
    },
  ],
  byGroupExpenses: [],
  personalExpenses: [],
  expenseTotal: new Money(250),
  fundTotal: new Money(7500),
  personalTotal: new Money(0),
  grandTotal: new Money(7750),
};

const OPTIONS = {
  fontFileUrl: "file:///fake/font.otf",
  receiptImageDataUrls: new Map([["r1", "data:image/jpeg;base64,AAAA"]]),
  generatedAt: new Date("2026-08-25T00:00:00Z"),
};

describe("buildReportHtml", () => {
  it("含七個區塊標題", () => {
    const html = buildReportHtml(SAMPLE_DATA, OPTIONS);
    expect(html).toContain("計算基準");
    expect(html).toContain("區塊一・旅費均攤");
    expect(html).toContain("區塊二・公費");
    expect(html).toContain("區塊三・個人消費");
    expect(html).toContain("最終每人總計");
    expect(html).toContain("note");
    expect(html).toContain("收據縮圖索引");
  });

  it("字型用 @font-face 內嵌，src 指向傳入的 fontFileUrl", () => {
    const html = buildReportHtml(SAMPLE_DATA, OPTIONS);
    expect(html).toContain("@font-face");
    expect(html).toContain("file:///fake/font.otf");
  });

  it("每人總計顯示值正確（HALF_UP 取整）", () => {
    const html = buildReportHtml(SAMPLE_DATA, OPTIONS);
    expect(html).toContain("TWD 73,635");
  });

  it("使用者輸入的行程名稱與支出說明會被 HTML escape，避免注入", () => {
    const html = buildReportHtml(SAMPLE_DATA, OPTIONS);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<b>粗體</b>");
    expect(html).toContain("&lt;b&gt;粗體&lt;/b&gt;");
  });

  it("收據縮圖索引頁含 data URI 圖片", () => {
    const html = buildReportHtml(SAMPLE_DATA, OPTIONS);
    expect(html).toContain("data:image/jpeg;base64,AAAA");
  });

  it("找不到圖片的收據顯示「原圖遺失」而非整頁失敗", () => {
    const html = buildReportHtml(SAMPLE_DATA, { ...OPTIONS, receiptImageDataUrls: new Map() });
    expect(html).toContain("原圖遺失");
  });

  it("公費收支：提撥金額有格式化（千分位＋幣別），不是裸數字字串", () => {
    const html = buildReportHtml(SAMPLE_DATA, OPTIONS);
    expect(html).toContain("JPY 30,000");
  });

  it("無公費（fund 為 null）時仍能產出，公費區塊顯示無資料", () => {
    const noFundData: ReportData = { ...SAMPLE_DATA, fund: null, fundEntries: [], fundBalance: { contributionTotal: new Money(0), spendTotal: new Money(0), balance: new Money(0) } };
    const html = buildReportHtml(noFundData, OPTIONS);
    expect(html).toContain("（無）");
  });
});
