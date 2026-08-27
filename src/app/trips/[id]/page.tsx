import Link from "next/link";
import { notFound } from "next/navigation";
import { ExpenseFilters } from "@/components/expense/ExpenseFilters";
import { ExpenseList } from "@/components/expense/ExpenseList";
import { MemberTotals } from "@/components/trip/MemberTotals";
import { Emoji } from "@/components/ui/Emoji";
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
      <header className="flex flex-col gap-3">
        <Link href="/trips" className="text-sm text-ink-soft">
          ← 行程列表
        </Link>
        <div>
          <h1 className="font-serif-tc text-2xl font-bold text-stamp">{trip.name}</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            {trip.startDate.toISOString().slice(0, 10)} –{" "}
            {trip.endDate.toISOString().slice(0, 10)} ・ 記帳幣 {trip.homeCurrency}
          </p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm">
          {[
            { href: `/trips/${id}/members`, label: "成員" },
            { href: `/trips/${id}/funds`, label: "公費" },
            { href: `/trips/${id}/settlement`, label: "清償" },
            { href: `/trips/${id}/reports`, label: "報表" },
            { href: `/trips/${id}/settings`, label: "設定" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full border border-dashed border-washi px-3 py-1 text-ink-soft hover:border-stamp-mid"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-soft">每人分攤小計</h2>
        <MemberTotals totals={memberTotals} currency={trip.homeCurrency} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-soft">支出</h2>
          <div className="flex gap-2">
            <Link
              href={`/trips/${id}/receipts/new`}
              className="flex items-center gap-1.5 rounded-full border border-dashed border-washi px-3 py-1.5 text-sm font-medium text-ink-soft hover:border-stamp-mid"
            >
              <Emoji name="camera" size={14} />
              拍照記帳
            </Link>
            <Link
              href={`/trips/${id}/expenses/new`}
              className="flex items-center gap-1.5 rounded-full bg-stamp px-3 py-1.5 text-sm font-medium text-paper"
            >
              <Emoji name="plus" size={12} />
              新增支出
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
