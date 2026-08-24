import Link from "next/link";
import { Money } from "@/components/ui/Money";
import type { loadExpenses } from "@/lib/trips/load";

type ExpenseRow = Awaited<ReturnType<typeof loadExpenses>>[number];

const SPLIT_MODE_LABEL: Record<string, string> = {
  EQUAL: "均分",
  WEIGHT: "按權重",
  EXACT: "指定金額",
  BY_GROUP: "按組計價",
};

export function ExpenseList({
  expenses,
  tripId,
  homeCurrency,
}: {
  expenses: ExpenseRow[];
  tripId: string;
  homeCurrency: string;
}) {
  if (expenses.length === 0) {
    return <p className="text-sm text-neutral-500">沒有符合條件的支出。</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {expenses.map((expense) => (
        <li key={expense.id}>
          <Link
            href={`/trips/${tripId}/expenses/${expense.id}`}
            className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3 hover:border-neutral-400"
          >
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                {expense.description}
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                  {expense.category}
                </span>
              </div>
              <div className="text-xs text-neutral-400">
                {expense.paidAt.toISOString().slice(0, 10)} ・
                {expense.payer?.name ?? "（無付款人）"} 付款 ・
                {SPLIT_MODE_LABEL[expense.splitMode]} ・{expense.shares.length} 人分攤
              </div>
            </div>
            <div className="text-right">
              <Money
                value={expense.amountOriginal}
                currency={expense.currency}
                className="block text-sm font-semibold tabular-nums"
              />
              {expense.currency !== homeCurrency && (
                <Money
                  value={expense.amountHome}
                  currency={homeCurrency}
                  className="block text-xs text-neutral-400 tabular-nums"
                />
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
