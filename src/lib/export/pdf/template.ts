import type Decimal from "decimal.js";
import { formatMoney, roundForDisplay } from "@/lib/money/round";
import type { ReportData, ReportExpense } from "@/lib/trips/report";

/**
 * PDF 報表 HTML 模板。純函式：只吃 ReportData 與外部資源的解析結果
 * （字型檔案 URL、收據縮圖的 data URI），不碰檔案系統——讀檔是 render.ts
 * 的責任，這裡維持跟 money/ 模組一樣的「純函式易測試」原則。
 *
 * 版型依 docs/IMPLEMENTATION.md §7：標題＋計算基準框 → 區塊一旅費均攤
 * （共同項目表/機票表/各組總額表＋總計方塊）→ 區塊二公費 → 區塊三個人消費
 * → 最終每人總計表＋方塊 → 附註 → 收據縮圖索引頁。
 */

export interface BuildReportHtmlOptions {
  /** Noto Sans TC 字型檔的 file:// URL，內嵌避免中文變豆腐字 */
  fontFileUrl: string;
  /** receiptId → 圖片 data URI，僅收據縮圖索引頁使用 */
  receiptImageDataUrls: Map<string, string>;
  /** 產出時間，預設 new Date()（呼叫端可固定傳入以利測試） */
  generatedAt?: Date;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(amount: Decimal, currency: string): string {
  return `${currency} ${formatMoney(amount, currency)}`;
}

function dateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildReportHtml(data: ReportData, options: BuildReportHtmlOptions): string {
  const generatedAt = options.generatedAt ?? new Date();
  const home = data.trip.homeCurrency;

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<title>${esc(data.trip.name)} 旅費結算總表</title>
<style>
  @font-face {
    font-family: "Noto Sans TC";
    src: url("${options.fontFileUrl}") format("opentype");
    font-weight: normal;
  }
  * { box-sizing: border-box; }
  body {
    font-family: "Noto Sans TC", sans-serif;
    color: #1a1a1a;
    font-size: 11px;
    margin: 0;
    padding: 24px;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 8px; border-bottom: 2px solid #333; padding-bottom: 4px; }
  h3 { font-size: 12px; margin: 12px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
  th { background: #f2f2f2; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .basis-box {
    border: 1px solid #999;
    padding: 8px 12px;
    margin-bottom: 16px;
    background: #fafafa;
    font-size: 10px;
  }
  .total-box {
    display: inline-block;
    border: 2px solid #333;
    padding: 8px 16px;
    margin: 8px 0;
    font-weight: bold;
  }
  .total-box.common { border-color: #2b6cb0; }
  .total-box.fund { border-color: #b7791f; }
  .total-box.personal { border-color: #2f855a; }
  .grand-total-box {
    border: 3px double #333;
    padding: 12px 20px;
    margin: 12px 0;
    font-size: 14px;
    font-weight: bold;
  }
  .receipt-index { page-break-before: always; }
  .receipt-item { display: inline-block; width: 30%; margin: 1%; vertical-align: top; border: 1px solid #ccc; padding: 6px; }
  .receipt-item img { width: 100%; height: auto; display: block; margin-bottom: 4px; }
  .note { font-size: 9px; color: #555; margin-top: 16px; }
</style>
</head>
<body>

<h1>${esc(data.trip.name)}　旅費結算總表</h1>
<p>產出日期：${dateStr(generatedAt)}</p>

<div class="basis-box">
  <strong>計算基準</strong>：記帳幣 ${esc(home)}；行程期間 ${dateStr(data.trip.startDate)} – ${dateStr(data.trip.endDate)}
  ${data.fund !== null ? `；公費幣別 ${esc(data.fund.currency)}` : ""}
  <br />
  採用匯率：${data.fxRatesUsed
    .map((r) => `${esc(r.currency)} → ${esc(home)} = ${r.rateUsed.toString()}（${esc(r.rateSource)}）`)
    .join("　")}
</div>

<h2>區塊一・旅費均攤</h2>
${renderExpenseTable("共同項目", data.commonExpenses, home)}
${renderExpenseTable("按組計價（機票等）", data.byGroupExpenses, home)}
${renderGroupTotalsTable(data)}
<div class="total-box common">共同項目＋按組計價 總計：${fmt(data.expenseTotal.minus(data.personalTotal), home)}</div>

<h2>區塊二・公費</h2>
<h3>提撥</h3>
${renderFundEntryTable(data.fundEntries.filter((e) => e.type === "CONTRIBUTION"), data.fund?.currency ?? home)}
<h3>支用</h3>
${renderFundEntryTable(data.fundEntries.filter((e) => e.type === "SPEND"), data.fund?.currency ?? home)}
<div class="total-box fund">
  公費提撥 ${fmt(data.fundBalance.contributionTotal, data.fund?.currency ?? home)}
  − 支用 ${fmt(data.fundBalance.spendTotal, data.fund?.currency ?? home)}
  ＝ 餘額 ${fmt(data.fundBalance.balance, data.fund?.currency ?? home)}
</div>

<h2>區塊三・個人消費</h2>
${data.personalExpenses.length === 0
    ? "<p>本行程期間無個人消費記錄。</p>"
    : renderExpenseTable("個人消費", data.personalExpenses, home)}
<div class="total-box personal">個人消費 總計：${fmt(data.personalTotal, home)}</div>

<h2>最終每人總計</h2>
<table>
  <thead>
    <tr><th>成員</th><th>組別</th><th class="num">支出分攤</th><th class="num">公費提撥</th><th class="num">總計</th></tr>
  </thead>
  <tbody>
    ${data.perMember
      .map(
        (m) => `<tr>
      <td>${esc(m.name)}</td>
      <td>${esc(m.groupName ?? "")}</td>
      <td class="num">${fmt(m.expenseShareTotal, home)}</td>
      <td class="num">${fmt(m.fundContribution, home)}</td>
      <td class="num">${fmt(roundForDisplay(m.total, home), home)}</td>
    </tr>`,
      )
      .join("")}
  </tbody>
</table>
<div class="grand-total-box">全團合計：${fmt(roundForDisplay(data.grandTotal, home), home)}</div>

<div class="note">
  匯率語意：1 單位原幣 兌換多少 ${esc(home)}。金額顯示採 ROUND_HALF_UP 四捨五入至整數（JPY／TWD）。
  分攤除不盡時的尾差歸屬付款人，各人分攤之和與支出總額差額為 0。
</div>

${renderReceiptIndex(data, options.receiptImageDataUrls)}

</body>
</html>`;
}

function renderExpenseTable(title: string, expenses: ReportExpense[], home: string): string {
  if (expenses.length === 0) return `<h3>${esc(title)}</h3><p>（無）</p>`;
  return `<h3>${esc(title)}</h3>
<table>
  <thead>
    <tr><th>日期</th><th>組別</th><th>說明</th><th>付款人</th><th class="num">原幣金額</th><th class="num">${esc(home)} 金額</th></tr>
  </thead>
  <tbody>
    ${expenses
      .map(
        (e) => `<tr>
      <td>${dateStr(e.date)}</td>
      <td>${esc(e.groupName ?? "")}</td>
      <td>${esc(e.description)}</td>
      <td>${esc(e.payerName ?? "")}</td>
      <td class="num">${e.currency} ${e.amountOriginal.toString()}</td>
      <td class="num">${fmt(e.amountHome, home)}</td>
    </tr>`,
      )
      .join("")}
  </tbody>
</table>`;
}

function renderGroupTotalsTable(data: ReportData): string {
  const byGroup = new Map<string, { name: string; count: number; total: Decimal }>();
  for (const expense of data.byGroupExpenses) {
    if (expense.groupId === null) continue;
    const memberCount = expense.shares.length;
    const existing = byGroup.get(expense.groupId);
    if (existing === undefined) {
      byGroup.set(expense.groupId, {
        name: expense.groupName ?? expense.groupId,
        count: memberCount,
        total: expense.amountHome,
      });
    } else {
      existing.total = existing.total.plus(expense.amountHome);
    }
  }
  if (byGroup.size === 0) return "";
  return `<h3>各組總額</h3>
<table>
  <thead><tr><th>組別</th><th class="num">人數</th><th class="num">組總額（${esc(data.trip.homeCurrency)}）</th><th class="num">每人</th></tr></thead>
  <tbody>
    ${[...byGroup.values()]
      .map(
        (g) => `<tr>
      <td>${esc(g.name)}</td>
      <td class="num">${g.count}</td>
      <td class="num">${fmt(g.total, data.trip.homeCurrency)}</td>
      <td class="num">${fmt(g.total.dividedBy(g.count), data.trip.homeCurrency)}</td>
    </tr>`,
      )
      .join("")}
  </tbody>
</table>`;
}

function renderFundEntryTable(entries: ReportData["fundEntries"], currency: string): string {
  if (entries.length === 0) return "<p>（無）</p>";
  return `<table>
  <thead><tr><th>日期</th><th>成員</th><th>說明</th><th class="num">金額</th></tr></thead>
  <tbody>
    ${entries
      .map(
        (e) => `<tr>
      <td>${dateStr(e.occurredAt)}</td>
      <td>${esc(e.memberName ?? "")}</td>
      <td>${esc(e.note ?? e.linkedExpenseDescription ?? "")}</td>
      <td class="num">${fmt(e.amount, currency)}</td>
    </tr>`,
      )
      .join("")}
  </tbody>
</table>`;
}

function renderReceiptIndex(data: ReportData, images: Map<string, string>): string {
  if (data.receipts.length === 0) return "";
  return `<div class="receipt-index">
<h2>收據縮圖索引</h2>
${data.receipts
  .map((r, index) => {
    const src = images.get(r.receiptId);
    return `<div class="receipt-item">
      <div>#${index + 1}</div>
      ${src !== undefined ? `<img src="${src}" alt="收據 ${index + 1}" />` : "<div>（原圖遺失）</div>"}
      <div>${esc(r.expenseDescription)}</div>
    </div>`;
  })
  .join("")}
</div>`;
}
