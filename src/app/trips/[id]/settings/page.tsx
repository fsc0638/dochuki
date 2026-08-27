import Link from "next/link";
import { notFound } from "next/navigation";
import { updateTripAction } from "@/app/trips/actions";
import { TripForm } from "@/components/trip/TripForm";
import { loadTrip } from "@/lib/trips/load";

export default async function TripSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trip = await loadTrip(id);
  if (trip === null) notFound();

  const fixedRates = Object.entries(
    (trip.fixedRates as Record<string, string> | null) ?? {},
  ).map(([currency, rate]) => ({ currency, rate }));

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <div>
        <Link href={`/trips/${id}`} className="text-sm text-ink-soft">
          ← 回總覽
        </Link>
        <h1 className="mt-1 font-serif-tc text-2xl font-bold text-ink">行程設定</h1>
      </div>
      <TripForm
        action={updateTripAction.bind(null, id)}
        initial={{
          name: trip.name,
          startDate: trip.startDate.toISOString(),
          endDate: trip.endDate.toISOString(),
          homeCurrency: trip.homeCurrency,
          fixedRates,
        }}
        submitLabel="儲存設定"
      />
    </main>
  );
}
