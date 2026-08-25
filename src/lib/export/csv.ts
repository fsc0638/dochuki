import type { ReportData } from "@/lib/trips/report";

/**
 * CSV 匯出。依 docs/IMPLEMENTATION.md §7：一列一品項，無品項的支出輸出一列。
 *
 * CLAUDE.md「CSV 一律 UTF-8 with BOM，不要順手改成無 BOM」——BOM 直接烤進這個
 * 函式的輸出，呼叫端（route handler）不用也不該自己記得加，省得漏掉。
 */

const HEADERS = [
  "expense_id",
  "date",
  "trip",
  "group",
  "payer",
  "category",
  "description",
  "item_name_raw",
  "item_name_zh",
  "qty",
  "unit_price",
  "currency",
  "amount_original",
  "rate_used",
  "amount_twd",
  "tax_rate",
  "store",
  "address",
  "payment_method",
  "split_mode",
  "fund_spend",
  "receipt_id",
] as const;

/** 依 RFC 4180：含逗號／雙引號／換行才加引號，內部雙引號轉義為兩個雙引號 */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildExpenseDetailCsv(data: ReportData): string {
  const lines = [HEADERS.join(",")];
  for (const row of data.lineItemRows) {
    lines.push(
      [
        row.expenseId,
        row.date.toISOString().slice(0, 10),
        row.tripName,
        row.groupName,
        row.payerName,
        row.category,
        row.description,
        row.itemNameRaw,
        row.itemNameZh,
        row.qty?.toString() ?? null,
        row.unitPrice?.toString() ?? null,
        row.currency,
        row.amountOriginal.toString(),
        row.rateUsed.toString(),
        row.amountTwd.toString(),
        row.taxRate?.toString() ?? null,
        row.store,
        row.address,
        row.paymentMethod,
        row.splitMode,
        row.fundSpend ? "true" : "false",
        row.receiptId,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const BOM = String.fromCharCode(0xfeff);
  return BOM + lines.join("\r\n") + "\r\n";
}
