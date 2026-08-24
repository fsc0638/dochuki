"use client";

import { useActionState, useMemo, useState } from "react";
import { Field, inputClass } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { SplitModePicker } from "@/components/expense/SplitModePicker";
import { SplitPreview, type PreviewShare } from "@/components/expense/SplitPreview";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/actionState";
import { EXPENSE_CATEGORIES } from "@/lib/constants";
import { convertToHome, resolveRate } from "@/lib/money/convert";
import { Money as MoneyDecimal } from "@/lib/money/decimal";
import { splitExpense, type SplitParticipant } from "@/lib/money/split";
import type { SplitModeInput } from "@/lib/schemas/expense";

export interface ExpenseFormMember {
  id: string;
  name: string;
  groupId: string | null;
  /** 已經是正規化過的字串（見 fromDb），client 端可直接用 */
  weight: string;
}

export interface ExpenseFormGroup {
  id: string;
  name: string;
}

export interface ExpenseFormInitial {
  description: string;
  category: string;
  /** <input type="datetime-local"> 格式：YYYY-MM-DDTHH:mm */
  paidAt: string;
  currency: string;
  amountOriginal: string;
  payerId: string;
  manualRate?: string;
  splitMode: SplitModeInput;
  participantIds?: string[];
  groupId?: string;
  exactShares?: Record<string, string>;
}

/**
 * 支出表單。金額相關欄位（金額、幣別、匯率、分攤方式、參與者）全部是
 * controlled component，同一組 state 同時餵給送出用的 <input name=...>
 * 與即時預覽計算——確保「畫面上看到的分攤結果」與「實際會送出的資料」
 * 是同一份 state，不會兩邊各自為政而不小心分歧。
 */
export function ExpenseForm({
  action,
  tripId,
  homeCurrency,
  fixedRates,
  members,
  groups,
  initial,
  submitLabel,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  tripId: string;
  homeCurrency: string;
  fixedRates: Record<string, string>;
  members: ExpenseFormMember[];
  groups: ExpenseFormGroup[];
  initial?: ExpenseFormInitial;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL_ACTION_STATE);

  const [amountOriginal, setAmountOriginal] = useState(initial?.amountOriginal ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? homeCurrency);
  const [manualRate, setManualRate] = useState(initial?.manualRate ?? "");
  const [payerId, setPayerId] = useState(initial?.payerId ?? members[0]?.id ?? "");
  const [splitMode, setSplitMode] = useState<SplitModeInput>(initial?.splitMode ?? "EQUAL");
  const [participantIds, setParticipantIds] = useState<Set<string>>(
    () => new Set(initial?.participantIds ?? members.map((m) => m.id)),
  );
  const [groupId, setGroupId] = useState(initial?.groupId ?? groups[0]?.id ?? "");
  const [exactShares, setExactShares] = useState<Record<string, string>>(
    initial?.exactShares ?? {},
  );

  const needsRateInput =
    currency.toUpperCase() !== homeCurrency.toUpperCase() &&
    fixedRates[currency.toUpperCase()] === undefined;

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const preview = useMemo(() => {
    const amountText = amountOriginal.trim();
    if (amountText === "") {
      return { status: { kind: "empty" as const }, shares: [] as PreviewShare[] };
    }

    let amount;
    try {
      amount = new MoneyDecimal(amountText);
      if (!amount.isFinite() || !amount.isPositive()) throw new Error("invalid");
    } catch {
      return {
        status: { kind: "error" as const, message: "請輸入有效的正數金額" },
        shares: [],
      };
    }

    let rate;
    try {
      rate = resolveRate({
        currency,
        homeCurrency,
        tripFixedRates: fixedRates,
        manualRate: manualRate.trim() || undefined,
      }).rate;
    } catch {
      return { status: { kind: "needs-server-rate" as const }, shares: [] };
    }

    const amountHome = convertToHome({ amountOriginal: amount, rate });

    let participants: SplitParticipant[];
    if (splitMode === "EQUAL") {
      participants = [...participantIds].map((id) => ({ memberId: id }));
    } else if (splitMode === "WEIGHT") {
      participants = [...participantIds].map((id) => ({
        memberId: id,
        weight: memberById.get(id)?.weight,
      }));
    } else if (splitMode === "BY_GROUP") {
      participants = members.map((m) => ({ memberId: m.id, groupId: m.groupId }));
    } else {
      participants = Object.entries(exactShares)
        .filter(([, value]) => value.trim() !== "")
        .map(([memberId, exactShare]) => ({ memberId, exactShare }));
    }

    if (
      (splitMode === "EQUAL" || splitMode === "WEIGHT") &&
      payerId !== "" &&
      !participantIds.has(payerId)
    ) {
      return {
        status: {
          kind: "error" as const,
          message: "付款人必須包含在分攤名單內，或改用「按組計價」",
        },
        shares: [],
      };
    }

    try {
      const result = splitExpense({
        amountHome,
        mode: splitMode,
        participants,
        payerId: payerId || null,
        groupId: splitMode === "BY_GROUP" ? groupId : null,
      });
      const shares: PreviewShare[] = result.shares.map((share) => ({
        memberId: share.memberId,
        name: memberById.get(share.memberId)?.name ?? share.memberId,
        shareHome: share.shareHome,
      }));
      return { status: { kind: "ready" as const }, shares };
    } catch (error) {
      return {
        status: {
          kind: "error" as const,
          message: error instanceof Error ? error.message : "無法計算分攤",
        },
        shares: [],
      };
    }
  }, [
    amountOriginal,
    currency,
    manualRate,
    homeCurrency,
    fixedRates,
    splitMode,
    participantIds,
    groupId,
    exactShares,
    payerId,
    members,
    memberById,
  ]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tripId" value={tripId} />
      <FormMessage error={state.error} />

      <Field label="項目說明" htmlFor="description" errors={state.fieldErrors?.description}>
        <input
          id="description"
          name="description"
          type="text"
          required
          defaultValue={initial?.description}
          className={inputClass}
        />
      </Field>

      <div className="flex gap-3">
        <Field label="分類" htmlFor="category" errors={state.fieldErrors?.category}>
          <select
            id="category"
            name="category"
            defaultValue={initial?.category ?? EXPENSE_CATEGORIES[0]}
            className={inputClass}
          >
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Field>
        <Field label="付款時間" htmlFor="paidAt" errors={state.fieldErrors?.paidAt}>
          <input
            id="paidAt"
            name="paidAt"
            type="datetime-local"
            required
            defaultValue={initial?.paidAt}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="付款人" htmlFor="payerId" errors={state.fieldErrors?.payerId}>
        <select
          id="payerId"
          name="payerId"
          value={payerId}
          onChange={(event) => setPayerId(event.target.value)}
          className={inputClass}
        >
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex gap-3">
        <Field
          label="金額"
          htmlFor="amountOriginal"
          errors={state.fieldErrors?.amountOriginal}
        >
          <input
            id="amountOriginal"
            name="amountOriginal"
            type="text"
            inputMode="decimal"
            required
            value={amountOriginal}
            onChange={(event) => setAmountOriginal(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="幣別" htmlFor="currency" errors={state.fieldErrors?.currency}>
          <input
            id="currency"
            name="currency"
            type="text"
            maxLength={3}
            required
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            className={`${inputClass} w-20 uppercase`}
          />
        </Field>
      </div>

      {needsRateInput && (
        <Field
          label={`手動匯率（1 ${currency} = ? ${homeCurrency}；留空則送出後自動查參考匯率）`}
          htmlFor="manualRate"
          errors={state.fieldErrors?.manualRate}
        >
          <input
            id="manualRate"
            name="manualRate"
            type="text"
            inputMode="decimal"
            value={manualRate}
            onChange={(event) => setManualRate(event.target.value)}
            className={inputClass}
          />
        </Field>
      )}

      <SplitModePicker value={splitMode} onChange={setSplitMode} />

      {(splitMode === "EQUAL" || splitMode === "WEIGHT") && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-neutral-700">參與者</legend>
          {members.map((member) => (
            <label key={member.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="participantIds"
                value={member.id}
                checked={participantIds.has(member.id)}
                onChange={(event) => {
                  setParticipantIds((prev) => {
                    const next = new Set(prev);
                    if (event.target.checked) next.add(member.id);
                    else next.delete(member.id);
                    return next;
                  });
                }}
              />
              {member.name}
              {splitMode === "WEIGHT" && (
                <span className="text-xs text-neutral-400">權重 {member.weight}</span>
              )}
            </label>
          ))}
        </fieldset>
      )}

      {splitMode === "BY_GROUP" && (
        <Field label="組別" htmlFor="groupId" errors={state.fieldErrors?.groupId}>
          <select
            id="groupId"
            name="groupId"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            className={inputClass}
          >
            {groups.length === 0 && <option value="">（尚無組別）</option>}
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {splitMode === "EXACT" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-neutral-700">
            逐人指定金額（留空代表這人不用付）
          </legend>
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-2">
              <span className="w-16 text-sm">{member.name}</span>
              <input
                type="text"
                inputMode="decimal"
                name={`exactShare.${member.id}`}
                value={exactShares[member.id] ?? ""}
                onChange={(event) =>
                  setExactShares((prev) => ({ ...prev, [member.id]: event.target.value }))
                }
                className={`${inputClass} w-28`}
              />
            </div>
          ))}
          {state.fieldErrors?.exactShares?.map((message) => (
            <p key={message} className="text-xs text-red-600">
              {message}
            </p>
          ))}
        </fieldset>
      )}

      <SplitPreview status={preview.status} shares={preview.shares} homeCurrency={homeCurrency} />

      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
