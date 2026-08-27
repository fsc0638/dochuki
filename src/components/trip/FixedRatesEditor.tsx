"use client";

import { useState } from "react";
import { inputClass } from "@/components/ui/Field";

interface Row {
  key: number;
  currency: string;
  rate: string;
}

let nextKey = 0;

/**
 * 行程固定匯率的動態列編輯器。送出時用重複的 `fixedRates.currency` /
 * `fixedRates.rate` 欄位名，由 lib/schemas/trip.ts 的 parseTripFormData
 * 依索引配對回陣列。
 */
export function FixedRatesEditor({
  initial = [],
}: {
  initial?: Array<{ currency: string; rate: string }>;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((row) => ({ key: nextKey++, ...row })),
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink-soft">
        固定匯率（選填，不設定則走參考匯率或手動輸入）
      </span>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-2">
          <input
            type="text"
            name="fixedRates.currency"
            defaultValue={row.currency}
            placeholder="JPY"
            maxLength={3}
            className={`${inputClass} w-20 uppercase`}
          />
          <span className="text-sm text-ink-soft">兌 1 記帳幣 =</span>
          <input
            type="text"
            name="fixedRates.rate"
            defaultValue={row.rate}
            placeholder="0.25"
            inputMode="decimal"
            className={`${inputClass} w-28`}
          />
          <button
            type="button"
            onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
            className="text-sm text-red-600"
          >
            移除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { key: nextKey++, currency: "", rate: "" }])}
        className="self-start text-sm text-ink-soft underline"
      >
        + 新增一列
      </button>
    </div>
  );
}
