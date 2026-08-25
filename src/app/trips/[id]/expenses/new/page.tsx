import Link from "next/link";
import { notFound } from "next/navigation";
import { createExpenseAction } from "@/app/trips/[id]/expenses/actions";
import { reparseReceiptAction } from "@/app/trips/[id]/receipts/actions";
import {
  ExpenseForm,
  type ExpenseFormInitial,
  type LowConfidenceField,
} from "@/components/expense/ExpenseForm";
import { ReparseButton } from "@/components/expense/ReparseButton";
import { toDateTimeLocalValue } from "@/lib/dateTimeLocal";
import { EXPENSE_CATEGORIES } from "@/lib/constants";
import { Money } from "@/lib/money/decimal";
import { fromDb } from "@/lib/money/fromDb";
import { loadReceipt, lowConfidenceFields, parseReceiptJson } from "@/lib/receipts/load";
import type { ReceiptParseOutput } from "@/lib/schemas/receipt";
import { loadTrip } from "@/lib/trips/load";

/** confidence 欄位 → ExpenseForm 欄位。items/tax 這張表單沒有對應欄位可標紅（見 ExpenseForm 註解） */
const CONFIDENCE_FIELD_MAP: Partial<Record<string, LowConfidenceField>> = {
  store: "description",
  datetime: "paidAt",
  currency: "currency",
  total: "amountOriginal",
};

function receiptToInitial(
  parsed: ReceiptParseOutput,
  fallbackTakenAt: Date | null,
  memberIds: string[],
): ExpenseFormInitial {
  const paidAtSource =
    parsed.datetime !== null ? new Date(parsed.datetime) : fallbackTakenAt;
  const paidAt =
    paidAtSource !== null && !Number.isNaN(paidAtSource.getTime())
      ? paidAtSource
      : new Date();

  const firstItemCategory = parsed.items.find((item) => item.category !== null)?.category;

  return {
    description: parsed.store_zh ?? parsed.store ?? "",
    category: firstItemCategory ?? EXPENSE_CATEGORIES[0],
    paidAt: toDateTimeLocalValue(paidAt),
    currency: parsed.currency ?? "",
    amountOriginal: new Money(parsed.total).toString(),
    payerId: memberIds[0] ?? "",
    splitMode: "EQUAL",
  };
}

export default async function NewExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ receiptId?: string; takenAt?: string }>;
}) {
  const { id } = await params;
  const { receiptId, takenAt } = await searchParams;
  const trip = await loadTrip(id);
  if (trip === null) notFound();

  const members = trip.members.map((member) => ({
    id: member.id,
    name: member.name,
    groupId: member.groupId,
    weight: fromDb(member.weight).toString(),
  }));
  const memberIds = members.map((m) => m.id);

  let initial: ExpenseFormInitial | undefined;
  let flaggedFields: Set<LowConfidenceField> | undefined;
  let parseFailed = false;

  if (receiptId !== undefined) {
    const receipt = await loadReceipt(receiptId);
    const parsed = receipt === null ? null : parseReceiptJson(receipt.parseJson);
    if (parsed !== null) {
      const fallbackTakenAt =
        takenAt !== undefined && !Number.isNaN(Date.parse(takenAt))
          ? new Date(takenAt)
          : null;
      initial = receiptToInitial(parsed, fallbackTakenAt, memberIds);
      const low = lowConfidenceFields(parsed);
      flaggedFields = new Set(
        [...low]
          .map((field) => CONFIDENCE_FIELD_MAP[field])
          .filter((field): field is LowConfidenceField => field !== undefined),
      );
    } else {
      parseFailed = true;
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <div>
        <Link href={`/trips/${id}`} className="text-sm text-neutral-500">
          ← 回總覽
        </Link>
        <h1 className="mt-1 text-2xl font-bold">新增支出</h1>
      </div>

      {parseFailed && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          自動辨識失敗，請手動輸入。
        </p>
      )}

      {receiptId !== undefined && (
        <ReparseButton action={reparseReceiptAction.bind(null, id, receiptId)} />
      )}

      <ExpenseForm
        action={createExpenseAction.bind(null, memberIds, receiptId ?? null)}
        tripId={id}
        homeCurrency={trip.homeCurrency}
        fixedRates={(trip.fixedRates as Record<string, string> | null) ?? {}}
        members={members}
        groups={trip.groups.map((group) => ({ id: group.id, name: group.name }))}
        submitLabel="新增支出"
        initial={initial}
        lowConfidenceFields={flaggedFields}
        fundCurrency={trip.funds[0]?.currency}
      />
    </main>
  );
}
