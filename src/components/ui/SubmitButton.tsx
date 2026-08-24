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
  const base =
    "rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
  const color =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700"
      : "bg-neutral-900 hover:bg-neutral-700";

  return (
    <button type="submit" disabled={pending} className={`${base} ${color}`}>
      {pending ? pendingText : children}
    </button>
  );
}
