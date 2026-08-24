import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteExpenseAction, updateExpenseAction } from "@/app/trips/[id]/expenses/actions";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { ExpenseForm } from "@/components/expense/ExpenseForm";
import { fromDb } from "@/lib/money/fromDb";
import {
  inferByGroupSelection,
  loadExpenseForEdit,
  loadTrip,
} from "@/lib/trips/load";

/** <input type="datetime-local"> 要 YYYY-MM-DDTHH:mm，用本機時間部件組出 */
function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  const { id, expenseId } = await params;
  const [trip, expense] = await Promise.all([
    loadTrip(id),
    loadExpenseForEdit(expenseId),
  ]);
  if (trip === null || expense === null || expense.tripId !== id) notFound();

  const members = trip.members.map((member) => ({
    id: member.id,
    name: member.name,
    groupId: member.groupId,
    weight: fromDb(member.weight).toString(),
  }));
  const memberIds = members.map((m) => m.id);
  const shareMemberIds = expense.shares.map((s) => s.memberId);

  const groupId =
    expense.splitMode === "BY_GROUP"
      ? ((await inferByGroupSelection(id, shareMemberIds)) ?? undefined)
      : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <div className="flex items-start justify-between">
        <div>
          <Link href={`/trips/${id}`} className="text-sm text-neutral-500">
            ← 回總覽
          </Link>
          <h1 className="mt-1 text-2xl font-bold">編輯支出</h1>
        </div>
        <DeleteButton
          action={deleteExpenseAction.bind(null, id, expenseId)}
          confirmMessage="確定要刪除這筆支出嗎？此動作無法復原。"
        />
      </div>

      {expense.splitMode === "BY_GROUP" && groupId === undefined && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          無法自動判斷這筆支出當初選的組別（組別成員名單可能已變動），請重新選擇。
        </p>
      )}

      <ExpenseForm
        action={updateExpenseAction.bind(null, expenseId, memberIds)}
        tripId={id}
        homeCurrency={trip.homeCurrency}
        fixedRates={(trip.fixedRates as Record<string, string> | null) ?? {}}
        members={members}
        groups={trip.groups.map((group) => ({ id: group.id, name: group.name }))}
        submitLabel="儲存變更"
        initial={{
          description: expense.description,
          category: expense.category,
          paidAt: toDateTimeLocalValue(expense.paidAt),
          currency: expense.currency,
          amountOriginal: fromDb(expense.amountOriginal).toString(),
          payerId: expense.payerId ?? members[0]?.id ?? "",
          manualRate:
            expense.rateSource === "MANUAL"
              ? fromDb(expense.rateUsed).toString()
              : undefined,
          splitMode: expense.splitMode,
          participantIds:
            expense.splitMode === "EQUAL" || expense.splitMode === "WEIGHT"
              ? shareMemberIds
              : undefined,
          groupId,
          exactShares:
            expense.splitMode === "EXACT"
              ? Object.fromEntries(
                  expense.shares.map((share) => [
                    share.memberId,
                    fromDb(share.shareHome).toString(),
                  ]),
                )
              : undefined,
        }}
      />
    </main>
  );
}
