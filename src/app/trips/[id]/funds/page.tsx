import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteFundContributionAction } from "@/app/trips/[id]/funds/actions";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { Money } from "@/components/ui/Money";
import { CreateFundForm, ContributionForm } from "@/components/fund/FundForms";
import { loadFund, loadTrip } from "@/lib/trips/load";

export const dynamic = "force-dynamic";

export default async function FundPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [trip, fund] = await Promise.all([loadTrip(id), loadFund(id)]);
  if (trip === null) notFound();

  // Client Component 只能收純物件——trip.members 裡的 Decimal（weight）與
  // 巢狀 group 關聯物件都不是，傳過去會被 React 擋下（同一套規則 expenses
  // 頁面已經在遵守，見 expenses/new/page.tsx 的 members 轉換）
  const members = trip.members.map((member) => ({ id: member.id, name: member.name }));

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <div>
        <Link href={`/trips/${id}`} className="text-sm text-neutral-500">
          ← 回總覽
        </Link>
        <h1 className="mt-1 text-2xl font-bold">公費池</h1>
      </div>

      {fund === null ? (
        <CreateFundForm tripId={id} />
      ) : (
        <>
          <div className="rounded-lg border border-neutral-200 p-4">
            <p className="text-sm text-neutral-500">
              {fund.name}（{fund.currency}）
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-xs text-neutral-400">提撥</dt>
                <dd>
                  <Money value={fund.contributionTotal} currency={fund.currency} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-400">支用</dt>
                <dd>
                  <Money value={fund.spendTotal} currency={fund.currency} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-400">餘額</dt>
                <dd className="font-semibold">
                  <Money value={fund.balance} currency={fund.currency} />
                </dd>
              </div>
            </dl>
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">新增提撥</h2>
            <ContributionForm tripId={id} fundId={fund.id} members={members} />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">收支明細</h2>
            {fund.entries.length === 0 ? (
              <p className="text-sm text-neutral-400">尚無任何提撥或支用</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {fund.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm"
                  >
                    <div>
                      <p>
                        <span
                          className={
                            entry.type === "CONTRIBUTION" ? "text-emerald-600" : "text-amber-600"
                          }
                        >
                          {entry.type === "CONTRIBUTION" ? "提撥" : "支用"}
                        </span>{" "}
                        <Money value={entry.amount} currency={fund.currency} />
                      </p>
                      <p className="text-xs text-neutral-400">
                        {entry.memberName ?? "—"}
                        {entry.note ?? entry.linkedExpenseDescription ?? ""}
                      </p>
                    </div>
                    {entry.type === "CONTRIBUTION" && (
                      <DeleteButton
                        action={deleteFundContributionAction.bind(null, id, entry.id)}
                        confirmMessage="確定要刪除這筆提撥嗎？"
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
