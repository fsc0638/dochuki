import Link from "next/link";
import { notFound } from "next/navigation";
import { Money } from "@/components/ui/Money";
import { Emoji } from "@/components/ui/Emoji";
import { loadSettlementData, loadTrip } from "@/lib/trips/load";

export const dynamic = "force-dynamic";

export default async function SettlementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trip = await loadTrip(id);
  if (trip === null) notFound();

  const { balances, transfers } = await loadSettlementData(id);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <div>
        <Link href={`/trips/${id}`} className="text-sm text-ink-soft">
          ← 回總覽
        </Link>
        <h1 className="mt-1 font-serif-tc text-2xl font-bold text-stamp">清償計畫</h1>
        <p className="mt-0.5 text-xs text-ink-muted">
          不含公費支付的支出——公費收支請看公費池頁面
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink-soft">每人淨結餘</h2>
        <ul className="divide-y divide-dashed divide-washi-light overflow-hidden rounded-xl border border-dashed border-washi">
          {balances.map((member) => (
            <li key={member.memberId} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm font-medium">{member.name}</span>
              <Money
                value={member.netHome}
                currency={trip.homeCurrency}
                className={`text-sm font-semibold tabular-nums ${
                  member.netHome.isPositive()
                    ? "text-seal"
                    : member.netHome.isNegative()
                      ? "text-stamp"
                      : "text-ink-muted"
                }`}
              />
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-muted">綠色代表該收錢，紅棕色代表該付錢</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink-soft">建議轉帳</h2>
        {transfers.length === 0 ? (
          <p className="text-sm text-ink-muted">目前不需要任何轉帳，已經平衡了。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {transfers.map((transfer, index) => (
              <li
                key={`${transfer.fromMemberId}-${transfer.toMemberId}-${index}`}
                className="flex items-center gap-3 rounded-xl border border-dashed border-washi bg-paper px-4 py-3"
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-stamp-soft">
                  <Emoji name="yen" size={18} label="轉帳" />
                </span>
                <div className="flex-1 text-sm">
                  <span className="font-medium">{transfer.fromName}</span>
                  <span className="text-ink-soft"> 轉給 </span>
                  <span className="font-medium">{transfer.toName}</span>
                </div>
                <Money
                  value={transfer.amountHome}
                  currency={trip.homeCurrency}
                  className="text-sm font-semibold tabular-nums"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
