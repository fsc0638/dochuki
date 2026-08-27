"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { Field, inputClass, selectClass } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { SplitModePicker } from "@/components/expense/SplitModePicker";
import { SplitPreview, type PreviewShare } from "@/components/expense/SplitPreview";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/actionState";
import { EXPENSE_CATEGORIES } from "@/lib/constants";
import { convertToHome, resolveRate } from "@/lib/money/convert";
import { Money as MoneyDecimal } from "@/lib/money/decimal";
import { saveExpenseToOutbox } from "@/lib/offline/outbox";
import { splitExpense, type SplitParticipant } from "@/lib/money/split";
import { parseExpenseFormData, type SplitModeInput } from "@/lib/schemas/expense";

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

/**
 * 對應收據解析 confidence 的四個表單欄位。「items」「tax」在 §5.2 是逐一
 * 品項／稅率的信心，這張表單沒有可以標紅的單一對應欄位（品項本身不在這裡
 * 編輯），因此不在此列——是刻意的範圍限制，不是漏掉。
 */
export type LowConfidenceField = "description" | "paidAt" | "currency" | "amountOriginal";

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
  fundSpend?: boolean;
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
  lowConfidenceFields,
  fundCurrency,
  offlineCapable = false,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  tripId: string;
  homeCurrency: string;
  fixedRates: Record<string, string>;
  members: ExpenseFormMember[];
  groups: ExpenseFormGroup[];
  initial?: ExpenseFormInitial;
  submitLabel: string;
  /** 收據解析 confidence < 0.8 的欄位；來自拍照解析時標紅提醒使用者複查 */
  lowConfidenceFields?: Set<LowConfidenceField>;
  /** 這個行程的公費幣別；沒有公費池時傳 undefined，不顯示「由公費支付」選項 */
  fundCurrency?: string;
  /** 只有「新增支出」頁面傳 true——離線佇列範圍刻意只做新增，不做編輯
   * （編輯涉及覆蓋既有資料的衝突處理，複雜度不成比例，見 CLAUDE.md 進度日誌） */
  offlineCapable?: boolean;
}) {
  const [state, formAction] = useActionState(action, INITIAL_ACTION_STATE);
  const [offlineSaved, setOfflineSaved] = useState(false);

  function lowConfidenceClass(field: LowConfidenceField): string {
    return lowConfidenceFields?.has(field) === true
      ? "border-red-400 bg-red-50"
      : "";
  }

  const [amountOriginal, setAmountOriginal] = useState(initial?.amountOriginal ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? homeCurrency);
  const [fundSpend, setFundSpend] = useState(initial?.fundSpend ?? false);
  // 勾選「由公費支付」當下記住原本的幣別，取消勾選時要換回去，不能留在
  // 公費幣別上——那是鎖定顯示用的值，不是使用者實際選的
  const preFundCurrencyRef = useRef(currency);
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

  /** 離線時攔截送出：Server Action 無法送達伺服器，改存本機佇列，稍後
   * 由 src/lib/offline/outbox.ts 的 syncOutbox() 補送。有網路時完全不
   * 介入，讓 <form action={formAction}> 走原本的路徑。
   *
   * 刻意不用 router.push() 導頁——Next.js App Router 的 client-side
   * navigation 到一個還沒 prefetch 過的頁面，一樣要重新跟伺服器要 RSC
   * payload，離線時會直接卡住（實測過：跳轉逾時，不是假設）。離線分支
   * 只能留在原地做純 client 端的 UI 切換，不能觸發任何需要網路的導航。
   */
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!offlineCapable || navigator.onLine) return;
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const memberIds = members.map((m) => m.id);
    const payload = parseExpenseFormData(formData, memberIds);
    await saveExpenseToOutbox(tripId, payload);
    setOfflineSaved(true);
  }

  if (offlineSaved) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-seal bg-seal-pale p-6 text-center">
        <p className="text-sm font-medium text-seal">已離線儲存，連線恢復後會自動送出</p>
        <button
          type="button"
          onClick={() => setOfflineSaved(false)}
          className="rounded-full bg-stamp px-4 py-2 text-sm font-medium text-paper"
        >
          繼續新增下一筆
        </button>
        <Link href={`/trips/${tripId}`} className="text-xs text-ink-soft underline">
          回總覽（需要連線才能導頁）
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="tripId" value={tripId} />
      <FormMessage error={state.error} />
      {lowConfidenceFields !== undefined && lowConfidenceFields.size > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          紅框欄位是自動辨識信心較低的地方，請確認正確再送出。
        </p>
      )}

      <Field label="項目說明" htmlFor="description" errors={state.fieldErrors?.description}>
        <input
          id="description"
          name="description"
          type="text"
          required
          defaultValue={initial?.description}
          className={`${inputClass} ${lowConfidenceClass("description")}`}
        />
      </Field>

      <div className="flex gap-3">
        <Field label="分類" htmlFor="category" errors={state.fieldErrors?.category}>
          <select
            id="category"
            name="category"
            defaultValue={initial?.category ?? EXPENSE_CATEGORIES[0]}
            className={selectClass}
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
            className={`${inputClass} ${lowConfidenceClass("paidAt")}`}
          />
        </Field>
      </div>

      <Field label="付款人" htmlFor="payerId" errors={state.fieldErrors?.payerId}>
        <select
          id="payerId"
          name="payerId"
          value={payerId}
          onChange={(event) => setPayerId(event.target.value)}
          className={selectClass}
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
            className={`${inputClass} ${lowConfidenceClass("amountOriginal")}`}
          />
        </Field>
        <Field label="幣別" htmlFor="currency" errors={state.fieldErrors?.currency}>
          <input
            id="currency"
            name="currency"
            type="text"
            maxLength={3}
            required
            readOnly={fundSpend}
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            className={`${inputClass} w-20 uppercase ${fundSpend ? "bg-paper-dark" : ""} ${lowConfidenceClass("currency")}`}
          />
        </Field>
      </div>

      {fundCurrency !== undefined && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="fundSpend"
            value="true"
            checked={fundSpend}
            onChange={(event) => {
              const checked = event.target.checked;
              setFundSpend(checked);
              if (checked) {
                preFundCurrencyRef.current = currency;
                setCurrency(fundCurrency);
              } else {
                setCurrency(preFundCurrencyRef.current);
              }
            }}
          />
          由公費支付（幣別鎖定為公費幣別 {fundCurrency}）
        </label>
      )}

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
          <legend className="text-sm font-medium text-ink-soft">參與者</legend>
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
                <span className="text-xs text-ink-muted">權重 {member.weight}</span>
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
            className={selectClass}
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
          <legend className="text-sm font-medium text-ink-soft">
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
