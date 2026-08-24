import Link from "next/link";
import { notFound } from "next/navigation";
import { createExpenseAction } from "@/app/trips/[id]/expenses/actions";
import { ExpenseForm } from "@/components/expense/ExpenseForm";
import { fromDb } from "@/lib/money/fromDb";
import { loadTrip } from "@/lib/trips/load";

export default async function NewExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trip = await loadTrip(id);
  if (trip === null) notFound();

  const members = trip.members.map((member) => ({
    id: member.id,
    name: member.name,
    groupId: member.groupId,
    weight: fromDb(member.weight).toString(),
  }));

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <div>
        <Link href={`/trips/${id}`} className="text-sm text-neutral-500">
          ← 回總覽
        </Link>
        <h1 className="mt-1 text-2xl font-bold">新增支出</h1>
      </div>
      <ExpenseForm
        action={createExpenseAction.bind(null, members.map((m) => m.id))}
        tripId={id}
        homeCurrency={trip.homeCurrency}
        fixedRates={(trip.fixedRates as Record<string, string> | null) ?? {}}
        members={members}
        groups={trip.groups.map((group) => ({ id: group.id, name: group.name }))}
        submitLabel="新增支出"
      />
    </main>
  );
}
