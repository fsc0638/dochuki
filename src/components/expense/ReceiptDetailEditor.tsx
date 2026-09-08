"use client";

import { useState } from "react";
import { EXPENSE_CATEGORIES } from "@/lib/constants";
import type { LineItemDraft, TaxDraft } from "@/components/expense/ExpenseForm";

/**
 * 收據品項與稅金的逐筆複查介面（P8）。
 *
 * 為什麼要有這個：專案憲法寫的核心體驗是「AI 翻譯與結構化解析（店名／品項／
 * 時間／地址／幣別／稅金）→ **逐欄確認**」。P3 把六類都解析出來了，但確認頁
 * 只呈現其中三類，品項那幾筆使用者連看都看不到就直接入庫——`confidence.items`
 * 與 `confidence.tax` 兩個分數算了卻沒有地方可標。這裡把缺的補上。
 *
 * 送出方式用**索引式欄位名**（`lineItem.0.nameRaw`），不是同名陣列：品項有
 * 七個欄位，靠 `getAll()` 的順序對齊需要「每欄都送出相同筆數」這個脆弱前提，
 * 刪掉一列而某欄剛好是空值就會整排錯位。索引把配對關係寫死在欄位名裡。
 *
 * 金額只做顯示與送出，**不參與分攤計算**（`src/lib/money/` 完全不碰
 * LineItem），所以這裡的編輯不可能污染任何人的分攤金額。
 */

const inputClass =
  "w-full rounded border border-washi bg-white px-2 py-1 text-sm text-ink focus:border-stamp-mid focus:outline-none";

export function ReceiptDetailEditor({
  lineItems,
  taxes,
  onLineItemsChange,
  onTaxesChange,
  itemsLowConfidence = false,
  taxLowConfidence = false,
}: {
  lineItems: LineItemDraft[];
  taxes: TaxDraft[];
  onLineItemsChange: (rows: LineItemDraft[]) => void;
  onTaxesChange: (rows: TaxDraft[]) => void;
  itemsLowConfidence?: boolean;
  taxLowConfidence?: boolean;
}) {
  // 品項可能很多，預設收合避免把表單推得太長；低信心時預設展開，
  // 因為那正是最需要使用者看一眼的情況
  const [open, setOpen] = useState(itemsLowConfidence || taxLowConfidence);

  const itemTotal = lineItems.reduce((sum, row) => {
    const value = Number(row.amount);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  function updateItem(index: number, patch: Partial<LineItemDraft>): void {
    onLineItemsChange(lineItems.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeItem(index: number): void {
    onLineItemsChange(lineItems.filter((_, i) => i !== index));
  }

  function addItem(): void {
    onLineItemsChange([
      ...lineItems,
      { nameRaw: "", nameZh: "", qty: "1", unitPrice: "", amount: "", taxRate: "", category: "" },
    ]);
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-washi bg-paper p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 text-left"
      >
        <span className="text-sm font-medium text-ink-soft">
          收據明細
          {lineItems.length > 0 && `（${lineItems.length} 項）`}
          {(itemsLowConfidence || taxLowConfidence) && (
            <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
              辨識信心偏低，請核對
            </span>
          )}
        </span>
        <span className="text-xs text-ink-muted">{open ? "收合" : "展開"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-4">
          {/* ---------------- 品項 ---------------- */}
          <div className="flex flex-col gap-2">
            {lineItems.length === 0 ? (
              <p className="text-xs text-ink-muted">沒有品項。可以手動新增。</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {lineItems.map((row, index) => (
                  <li
                    key={index}
                    className="flex flex-col gap-1.5 rounded border border-dashed border-washi p-2"
                  >
                    {/* 索引式欄位名，見檔案開頭說明 */}
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <input
                          name={`lineItem.${index}.nameRaw`}
                          value={row.nameRaw}
                          onChange={(e) => updateItem(index, { nameRaw: e.target.value })}
                          placeholder="品項原文"
                          aria-label={`第 ${index + 1} 項原文`}
                          className={inputClass}
                        />
                        <input
                          name={`lineItem.${index}.nameZh`}
                          value={row.nameZh}
                          onChange={(e) => updateItem(index, { nameZh: e.target.value })}
                          placeholder="中譯（可留空）"
                          aria-label={`第 ${index + 1} 項中譯`}
                          className={`${inputClass} mt-1`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        aria-label={`刪除第 ${index + 1} 項`}
                        className="shrink-0 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700"
                      >
                        刪除
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <input
                        name={`lineItem.${index}.qty`}
                        value={row.qty}
                        onChange={(e) => updateItem(index, { qty: e.target.value })}
                        inputMode="decimal"
                        placeholder="數量"
                        aria-label={`第 ${index + 1} 項數量`}
                        className={inputClass}
                      />
                      <input
                        name={`lineItem.${index}.unitPrice`}
                        value={row.unitPrice}
                        onChange={(e) => updateItem(index, { unitPrice: e.target.value })}
                        inputMode="decimal"
                        placeholder="單價"
                        aria-label={`第 ${index + 1} 項單價`}
                        className={inputClass}
                      />
                      <input
                        name={`lineItem.${index}.amount`}
                        value={row.amount}
                        onChange={(e) => updateItem(index, { amount: e.target.value })}
                        inputMode="decimal"
                        placeholder="金額"
                        aria-label={`第 ${index + 1} 項金額`}
                        className={inputClass}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        name={`lineItem.${index}.taxRate`}
                        value={row.taxRate}
                        onChange={(e) => updateItem(index, { taxRate: e.target.value })}
                        aria-label={`第 ${index + 1} 項稅率`}
                        className={inputClass}
                      >
                        <option value="">未標示稅率</option>
                        <option value="0.08">8%</option>
                        <option value="0.1">10%</option>
                      </select>
                      <select
                        name={`lineItem.${index}.category`}
                        value={row.category}
                        onChange={(e) => updateItem(index, { category: e.target.value })}
                        aria-label={`第 ${index + 1} 項分類`}
                        className={inputClass}
                      >
                        <option value="">未分類</option>
                        {EXPENSE_CATEGORIES.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={addItem}
                className="rounded-full border border-washi px-3 py-1 text-xs text-ink-soft"
              >
                新增品項
              </button>
              {lineItems.length > 0 && (
                // 只顯示不強制：收據有折扣、服務費、四捨五入，品項加總跟總額
                // 對不起來是常態，擋下來只會逼使用者亂改數字
                <span className="text-xs text-ink-muted">品項合計 {itemTotal}</span>
              )}
            </div>
          </div>

          {/* ---------------- 稅金 ---------------- */}
          <div className="flex flex-col gap-2 border-t border-washi pt-3">
            <span className="text-xs font-medium text-ink-soft">稅金</span>
            {taxes.length === 0 ? (
              <p className="text-xs text-ink-muted">收據上沒有讀到稅金標示。</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {taxes.map((row, index) => (
                  <li key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5">
                    <select
                      name={`tax.${index}.mode`}
                      value={row.mode}
                      onChange={(e) =>
                        onTaxesChange(
                          taxes.map((t, i) => (i === index ? { ...t, mode: e.target.value } : t)),
                        )
                      }
                      aria-label={`第 ${index + 1} 筆稅金種類`}
                      className={inputClass}
                    >
                      <option value="">未標示</option>
                      <option value="INCLUSIVE">內稅</option>
                      <option value="EXCLUSIVE">外稅</option>
                    </select>
                    <select
                      name={`tax.${index}.rate`}
                      value={row.rate}
                      onChange={(e) =>
                        onTaxesChange(
                          taxes.map((t, i) => (i === index ? { ...t, rate: e.target.value } : t)),
                        )
                      }
                      aria-label={`第 ${index + 1} 筆稅率`}
                      className={inputClass}
                    >
                      <option value="">未標示</option>
                      <option value="0.08">8%</option>
                      <option value="0.1">10%</option>
                    </select>
                    <input
                      name={`tax.${index}.amount`}
                      value={row.amount}
                      onChange={(e) =>
                        onTaxesChange(
                          taxes.map((t, i) => (i === index ? { ...t, amount: e.target.value } : t)),
                        )
                      }
                      inputMode="decimal"
                      placeholder="稅額"
                      aria-label={`第 ${index + 1} 筆稅額`}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => onTaxesChange(taxes.filter((_, i) => i !== index))}
                      aria-label={`刪除第 ${index + 1} 筆稅金`}
                      className="rounded border border-red-300 bg-red-50 px-2 text-xs text-red-700"
                    >
                      刪除
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => onTaxesChange([...taxes, { mode: "", rate: "", amount: "" }])}
              className="self-start rounded-full border border-washi px-3 py-1 text-xs text-ink-soft"
            >
              新增稅金列
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
