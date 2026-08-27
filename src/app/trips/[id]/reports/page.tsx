import Link from "next/link";
import { notFound } from "next/navigation";
import { loadTrip } from "@/lib/trips/load";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trip = await loadTrip(id);
  if (trip === null) notFound();

  const links = [
    { href: `/api/trips/${id}/export/csv`, label: "下載 CSV（明細）" },
    { href: `/api/trips/${id}/export/xlsx`, label: "下載 Excel（五工作表彙總）" },
    { href: `/api/trips/${id}/export/pdf`, label: "下載 PDF（旅費結算總表）" },
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <div>
        <Link href={`/trips/${id}`} className="text-sm text-ink-soft">
          ← 回總覽
        </Link>
        <h1 className="mt-1 font-serif-tc text-2xl font-bold text-stamp">報表匯出</h1>
        <p className="mt-1 text-sm text-ink-soft">{trip.name}</p>
      </div>

      <p className="text-xs text-ink-muted">
        三種格式的數字都來自同一份彙總，互相一致；PDF 版型含每人總計、公費收支與收據縮圖索引。
      </p>

      <div className="flex flex-col gap-3">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="rounded-xl border border-dashed border-washi bg-paper px-4 py-3 text-center text-sm font-medium text-ink hover:border-stamp-mid"
          >
            {link.label}
          </a>
        ))}
      </div>
    </main>
  );
}
