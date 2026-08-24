import Link from "next/link";
import { notFound } from "next/navigation";
import { ReceiptCapture } from "@/components/expense/ReceiptCapture";
import { loadTrip } from "@/lib/trips/load";

export default async function NewReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trip = await loadTrip(id);
  if (trip === null) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <div>
        <Link href={`/trips/${id}`} className="text-sm text-neutral-500">
          ← 回總覽
        </Link>
        <h1 className="mt-1 text-2xl font-bold">拍照記帳</h1>
        <p className="mt-1 text-sm text-neutral-500">
          自動辨識店名、金額、品項，下一步再確認或修改。
        </p>
      </div>
      <ReceiptCapture tripId={id} />
    </main>
  );
}
