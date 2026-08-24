import Link from "next/link";
import { listTrips } from "@/lib/trips/load";

// 本頁沒有用到 params/searchParams 等動態 API，Next 會把它當靜態頁在 build
// 當下把行程清單「拍照」凍結——`next start` 之後新建的行程不會出現，除非
// 重新 build。用 pnpm build 才會現形，pnpm dev 永遠即時渲染看不出來。
// 行程清單本質上必須即時，強制動態渲染。
export const dynamic = "force-dynamic";

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
