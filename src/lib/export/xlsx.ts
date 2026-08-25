import type Decimal from "decimal.js";
import ExcelJS from "exceljs";
import { roundForDisplay } from "@/lib/money/round";
import type { ReportData } from "@/lib/trips/report";

/**
 * Excel 匯出。依 docs/IMPLEMENTATION.md §7：五工作表，凍結首列、金額欄
 * 千分位格式、總計列底色。
 *
 * CLAUDE.md 金額鐵律 3：JPY 取整數、TWD 顯示四捨五入至整數（ROUND_HALF_UP）。
 * ExcelJS 的數字儲存格只能是 IEEE-754 double（.xlsx 格式本身的限制，跟
 * formatMoney() 的 .toFixed() 是同一類「最終落地邊界」，不算違反鐵律 1），
 * 但落地前一定要先過 roundForDisplay()——每個金額欄一律走 toDisplayNumber()，
 * 不直接呼叫 .toNumber()，避免像本檔曾經出現過的問題：只有一兩欄記得取整，
 * 其餘欄位在 Excel 裡顯示出跟 PDF 對不上的小數。
 */

const AMOUNT_FORMAT = "#,##0.00;[Red]-#,##0.00";
const TOTAL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFEFEFEF" },
};

/** 唯一允許把金額轉成 Excel 儲存格用的 number 的地方——先過 roundForDisplay() */
function toDisplayNumber(amount: Decimal, currency: string): number {
  return roundForDisplay(amount, currency).toNumber();
}

function freezeHeader(sheet: ExcelJS.Worksheet): void {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function styleTotalRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = TOTAL_FILL;
    cell.font = { bold: true };
  });
}

export async function buildExpenseWorkbook(data: ReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "道中記 Dōchūki";
  workbook.created = new Date();

  buildDetailSheet(workbook, data);
  buildCategorySheet(workbook, data);
  buildMemberSheet(workbook, data);
  buildFundSheet(workbook, data);
  buildFxRateSheet(workbook, data);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function buildDetailSheet(workbook: ExcelJS.Workbook, data: ReportData): void {
  const sheet = workbook.addWorksheet("明細");
  sheet.columns = [
    { header: "日期", key: "date", width: 12 },
    { header: "組別", key: "group", width: 10 },
    { header: "付款人", key: "payer", width: 10 },
    { header: "類別", key: "category", width: 10 },
    { header: "說明", key: "description", width: 20 },
    { header: "品項", key: "item", width: 16 },
    { header: "數量", key: "qty", width: 8 },
    { header: "幣別", key: "currency", width: 8 },
    { header: "原幣金額", key: "amountOriginal", width: 14, style: { numFmt: AMOUNT_FORMAT } },
    { header: "匯率", key: "rateUsed", width: 12 },
    { header: "台幣金額", key: "amountTwd", width: 14, style: { numFmt: AMOUNT_FORMAT } },
    { header: "分攤模式", key: "splitMode", width: 12 },
    { header: "公費支付", key: "fundSpend", width: 10 },
  ];
  for (const row of data.lineItemRows) {
    sheet.addRow({
      date: row.date.toISOString().slice(0, 10),
      group: row.groupName ?? "",
      payer: row.payerName ?? "",
      category: row.category,
      description: row.description,
      item: row.itemNameZh ?? row.itemNameRaw ?? "",
      qty: row.qty?.toNumber() ?? "",
      currency: row.currency,
      amountOriginal: toDisplayNumber(row.amountOriginal, row.currency),
      rateUsed: row.rateUsed.toString(),
      amountTwd: toDisplayNumber(row.amountTwd, data.trip.homeCurrency),
      splitMode: row.splitMode,
      fundSpend: row.fundSpend ? "是" : "",
    });
  }
  freezeHeader(sheet);
}

function buildCategorySheet(workbook: ExcelJS.Workbook, data: ReportData): void {
  const sheet = workbook.addWorksheet("分類彙總");
  sheet.columns = [
    { header: "類別", key: "category", width: 12 },
    { header: "幣別", key: "currency", width: 8 },
    { header: "台幣金額", key: "amountTwd", width: 14, style: { numFmt: AMOUNT_FORMAT } },
  ];
  for (const row of data.categoryTotals) {
    sheet.addRow({
      category: row.category,
      currency: row.currency,
      amountTwd: toDisplayNumber(row.amountTwd, data.trip.homeCurrency),
    });
  }
  const totalRow = sheet.addRow({
    category: "總計",
    currency: "",
    amountTwd: toDisplayNumber(data.expenseTotal, data.trip.homeCurrency),
  });
  styleTotalRow(totalRow);
  freezeHeader(sheet);
}

function buildMemberSheet(workbook: ExcelJS.Workbook, data: ReportData): void {
  const sheet = workbook.addWorksheet("成員分攤");
  sheet.columns = [
    { header: "成員", key: "name", width: 12 },
    { header: "組別", key: "group", width: 10 },
    { header: "支出分攤", key: "expenseShare", width: 14, style: { numFmt: AMOUNT_FORMAT } },
    { header: "公費提撥", key: "fund", width: 14, style: { numFmt: AMOUNT_FORMAT } },
    { header: "每人總計", key: "total", width: 14, style: { numFmt: AMOUNT_FORMAT } },
  ];
  for (const member of data.perMember) {
    sheet.addRow({
      name: member.name,
      group: member.groupName ?? "",
      expenseShare: toDisplayNumber(member.expenseShareTotal, data.trip.homeCurrency),
      fund: toDisplayNumber(member.fundContribution, data.trip.homeCurrency),
      total: toDisplayNumber(member.total, data.trip.homeCurrency),
    });
  }
  const totalRow = sheet.addRow({
    name: "總計",
    group: "",
    expenseShare: toDisplayNumber(data.expenseTotal, data.trip.homeCurrency),
    fund: toDisplayNumber(data.fundTotal, data.trip.homeCurrency),
    total: toDisplayNumber(data.grandTotal, data.trip.homeCurrency),
  });
  styleTotalRow(totalRow);
  freezeHeader(sheet);
}

function buildFundSheet(workbook: ExcelJS.Workbook, data: ReportData): void {
  const sheet = workbook.addWorksheet("公費收支");
  const fundCurrency = data.fund?.currency ?? data.trip.homeCurrency;
  sheet.columns = [
    { header: "日期", key: "date", width: 12 },
    { header: "類型", key: "type", width: 10 },
    { header: "成員", key: "member", width: 12 },
    { header: "說明", key: "note", width: 20 },
    { header: "金額", key: "amount", width: 14, style: { numFmt: AMOUNT_FORMAT } },
  ];
  for (const entry of data.fundEntries) {
    sheet.addRow({
      date: entry.occurredAt.toISOString().slice(0, 10),
      type: entry.type === "CONTRIBUTION" ? "提撥" : "支用",
      member: entry.memberName ?? "",
      note: entry.note ?? entry.linkedExpenseDescription ?? "",
      amount: toDisplayNumber(entry.amount, fundCurrency),
    });
  }
  sheet.addRow({});
  const balanceRow = sheet.addRow({
    date: "",
    type: "餘額",
    member: "",
    note: `${fundCurrency}（提撥 ${data.fundBalance.contributionTotal.toString()} − 支用 ${data.fundBalance.spendTotal.toString()}）`,
    amount: toDisplayNumber(data.fundBalance.balance, fundCurrency),
  });
  styleTotalRow(balanceRow);
  freezeHeader(sheet);
}

function buildFxRateSheet(workbook: ExcelJS.Workbook, data: ReportData): void {
  const sheet = workbook.addWorksheet("匯率");
  sheet.columns = [
    { header: "幣別", key: "currency", width: 10 },
    { header: "匯率（→記帳幣）", key: "rate", width: 18 },
    { header: "來源", key: "source", width: 14 },
  ];
  for (const rate of data.fxRatesUsed) {
    sheet.addRow({ currency: rate.currency, rate: rate.rateUsed.toString(), source: rate.rateSource });
  }
  freezeHeader(sheet);
}
