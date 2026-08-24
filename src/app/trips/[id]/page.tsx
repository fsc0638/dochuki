import Link from "next/link";
import { notFound } from "next/navigation";
import { ExpenseFilters } from "@/components/expense/ExpenseFilters";
import { ExpenseList } from "@/components/expense/ExpenseList";
import { MemberTotals } from "@/components/trip/MemberTotals";
import { type ExpenseFilter, loadExpenses, loadMemberTotals, loadTrip } from "@/lib/trips/load";

function toOptionalString(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  return value;
}

export default async function TripOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;

  const trip = await loadTrip(id);
  if (trip === null) notFound();

  const filter: ExpenseFilter = {
    category: toOptionalString(query.category),
    memberId: toOptionalString(query.memberId),
    dateFrom: toOptionalString(query.dateFrom),
    dateTo: toOptionalString(query.dateTo),
  };

  const [expenses, memberTotals] = await Promise.all([
    loadExpenses(id, filter),
    loadMemberTotals(id),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <header>
        <Link href="/trips" className="text-sm text-neutral-500">
          ← 行程列表
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-2xl font-bold">{trip.name}</h1>
          <div className="flex gap-3 text-sm text-neutral-500">
            <Link href={`/trips/${id}/members`}>成員</Link>
            <Link href={`/trips/${id}/settings`}>設定</Link>
          </div>
        </div>
        <p className="text-xs text-neutral-400">
          {trip.startDate.toISOString().slice(0, 10)} –{" "}
          {trip.endDate.toISOString().slice(0, 10)} ・ 記帳幣 {trip.homeCurrency}
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-600">每人分攤小計</h2>
        <MemberTotals totals={memberTotals} currency={trip.homeCurrency} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-600">支出</h2>
          <div className="flex gap-2">
            <Link
              href={`/trips/${id}/receipts/new`}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700"
            >
              拍照記帳
            </Link>
            <Link
              href={`/trips/${id}/expenses/new`}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              + 新增支出
            </Link>
          </div>
        </div>
        <ExpenseFilters
          tripId={id}
          members={trip.members.map((m) => ({ id: m.id, name: m.name }))}
          filter={filter}
        />
        <ExpenseList expenses={expenses} tripId={id} homeCurrency={trip.homeCurrency} />
      </section>
    </main>
  );
}
