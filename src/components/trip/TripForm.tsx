"use client";

import { useActionState } from "react";
import { Field, inputClass } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { Select } from "@/components/ui/Select";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FixedRatesEditor } from "@/components/trip/FixedRatesEditor";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/actionState";
import { COMMON_CURRENCIES } from "@/lib/constants";

export type TripFormAction = (
  prevState: ActionState,
  formData: FormData,
) => Promise<ActionState>;

export interface TripFormInitial {
  name: string;
  startDate: string;
  endDate: string;
  homeCurrency: string;
  fixedRates: Array<{ currency: string; rate: string }>;
}

/** 日期輸入用 <input type="date"> 需要 YYYY-MM-DD，把 ISO 時間戳裁掉時間部分 */
function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

export function TripForm({
  action,
  initial,
  submitLabel,
}: {
  action: TripFormAction;
  initial?: TripFormInitial;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL_ACTION_STATE);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-xl border border-dashed border-washi bg-paper p-5"
    >
      <FormMessage error={state.error} />

      <Field label="行程名稱" htmlFor="name" errors={state.fieldErrors?.name}>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={initial?.name}
          className={inputClass}
        />
      </Field>

      <div className="flex gap-3">
        <Field
          label="開始日期"
          htmlFor="startDate"
          errors={state.fieldErrors?.startDate}
        >
          <input
            id="startDate"
            name="startDate"
            type="date"
            required
            defaultValue={initial ? toDateInputValue(initial.startDate) : undefined}
            className={inputClass}
          />
        </Field>
        <Field
          label="結束日期"
          htmlFor="endDate"
          errors={state.fieldErrors?.endDate}
        >
          <input
            id="endDate"
            name="endDate"
            type="date"
            required
            defaultValue={initial ? toDateInputValue(initial.endDate) : undefined}
            className={inputClass}
          />
        </Field>
      </div>

      <Field
        label="記帳幣"
        htmlFor="homeCurrency"
        errors={state.fieldErrors?.homeCurrency}
      >
        <Select
          id="homeCurrency"
          name="homeCurrency"
          defaultValue={initial?.homeCurrency ?? "TWD"}
          options={COMMON_CURRENCIES.map((currency) => ({ value: currency, label: currency }))}
        />
      </Field>

      <FixedRatesEditor initial={initial?.fixedRates} />
      {state.fieldErrors?.fixedRates?.map((message) => (
        <p key={message} className="text-xs text-red-600">
          {message}
        </p>
      ))}

      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
