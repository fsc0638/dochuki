"use client";

import { useState } from "react";

/**
 * 「選購項目」——一筆支出買了什麼（P9）。
 *
 * 為什麼獨立成一個 client 元件：`ExpenseList` 的整列是一個 `<Link>`，
 * 展開／收合的按鈕若放在裡面，點擊會同時觸發導頁。所以展開區塊放在連結
 * **外面**，自己管理開合狀態。
 *
 * 為什麼預設收合：一趟旅程的品項筆數通常是支出筆數的好幾倍，全部攤開會讓
 * 支出列表完全失去可掃視性。標題保留「N 項」讓人知道有東西可看。
 */

export interface PurchasedItem {
  id: string;
  nameRaw: string;
  nameZh: string | null;
  /** 已格式化的顯示字串，格式化在伺服器端做（金額一律不在 UI 層運算） */
  qty: string;
  amount: string;
  category: string | null;
}

export function PurchasedItems({
  items,
  currency,
}: {
  items: PurchasedItem[];
  currency: string;
}) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs text-ink-soft hover:text-ink"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        選購項目（{items.length} 項）
      </button>

      {open && (
        <ul className="mt-1 flex flex-col gap-0.5 border-l-2 border-washi pl-3">
          {items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 flex-1 text-ink-soft">
                {/* 中譯優先顯示，原文放在後面——對帳時兩個都要看得到 */}
                <span className="text-ink">{item.nameZh ?? item.nameRaw}</span>
                {item.nameZh !== null && item.nameZh !== item.nameRaw && (
                  <span className="ml-1 text-ink-muted">{item.nameRaw}</span>
                )}
                {item.category !== null && (
                  <span className="ml-1 rounded bg-paper-dark px-1 text-[10px] text-ink-muted">
                    {item.category}
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-ink-muted">
                {item.qty !== "1" && `${item.qty} × `}
                {item.amount} {currency}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
