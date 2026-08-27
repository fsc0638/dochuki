"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText = "處理中…",
  variant = "primary",
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "danger";
}) {
  const { pending } = useFormStatus();
  const base = "rounded-full font-medium disabled:opacity-50";
  // danger 刻意做成比 primary 更輕的 outline 小按鈕——密集列表（成員、公費
  // 收支明細）裡每一列都有一個，實心紅底太搶視覺；outline 仍然保留「危險
  // 操作」的紅色語意，只是不再是視覺重心
  const sizeAndColor =
    variant === "danger"
      ? "border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 hover:bg-red-100"
      : "bg-stamp px-4 py-2 text-sm text-paper hover:bg-stamp-mid";

  return (
    <button type="submit" disabled={pending} className={`${base} ${sizeAndColor}`}>
      {pending ? pendingText : children}
    </button>
  );
}
