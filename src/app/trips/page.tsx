import Link from "next/link";
import { listTrips } from "@/lib/trips/load";
import { Emoji } from "@/components/ui/Emoji";

// 本頁沒有用到 params/searchParams 等動態 API，Next 會把它當靜態頁在 build
// 當下把行程清單「拍照」凍結——`next start` 之後新建的行程不會出現，除非
// 重新 build。用 pnpm build 才會現形，pnpm dev 永遠即時渲染看不出來。
// 行程清單本質上必須即時，強制動態渲染。
export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const trips = await listTrips();
  const today = new Date();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-serif-tc text-2xl font-bold text-stamp">道中記</h1>
          <p className="text-sm text-ink-soft">我的行程</p>
        </div>
        <Link
          href="/trips/new"
          className="flex items-center gap-1.5 rounded-full bg-stamp px-4 py-2 text-sm font-medium text-paper"
        >
          <Emoji name="plus" size={12} />
          新行程
        </Link>
      </header>

      {trips.length === 0 ? (
        <p className="text-sm text-ink-muted">還沒有行程，建立第一個吧。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {trips.map((trip) => {
            const isPast = trip.endDate < today;
            return (
              <li key={trip.id}>
                <Link
                  href={`/trips/${trip.id}`}
                  className={`flex items-start gap-3 rounded-xl border border-dashed border-washi bg-paper px-4 py-3 transition-opacity ${isPast ? "opacity-60" : "hover:border-stamp-mid"}`}
                >
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-stamp-soft">
                    <Emoji name="pin" size={22} label="行程" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-serif-tc font-medium">{trip.name}</span>
                      {isPast && (
                        <span className="flex-shrink-0 rounded-full bg-paper-dark px-2 py-0.5 text-[11px] text-ink-soft">
                          已結束
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-soft">
                      {trip.startDate.toISOString().slice(0, 10)} –{" "}
                      {trip.endDate.toISOString().slice(0, 10)} ・ {trip.homeCurrency}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
