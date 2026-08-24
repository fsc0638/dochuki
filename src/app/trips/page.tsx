import Link from "next/link";
import { listTrips } from "@/lib/trips/load";

export default async function TripsPage() {
  const trips = await listTrips();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">道中記</h1>
          <p className="text-sm text-neutral-500">我的行程</p>
        </div>
        <Link
          href="/trips/new"
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
        >
          + 新行程
        </Link>
      </header>

      {trips.length === 0 ? (
        <p className="text-sm text-neutral-500">還沒有行程，建立第一個吧。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Link
                href={`/trips/${trip.id}`}
                className="block rounded-lg border border-neutral-200 px-4 py-3 hover:border-neutral-400"
              >
                <div className="font-medium">{trip.name}</div>
                <div className="text-xs text-neutral-500">
                  {trip.startDate.toISOString().slice(0, 10)} –{" "}
                  {trip.endDate.toISOString().slice(0, 10)} ・ {trip.homeCurrency}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
