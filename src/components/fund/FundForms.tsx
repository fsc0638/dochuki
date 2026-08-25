"use client";

import { useActionState } from "react";
import {
  createFundAction,
  createFundContributionAction,
} from "@/app/trips/[id]/funds/actions";
import { Field, inputClass } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { INITIAL_ACTION_STATE } from "@/lib/actionState";
import { COMMON_CURRENCIES } from "@/lib/constants";

export function CreateFundForm({ tripId }: { tripId: string }) {
  const [state, formAction] = useActionState(createFundAction, INITIAL_ACTION_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tripId" value={tripId} />
      <p className="text-sm text-neutral-500">這個行程還沒有公費池，先建立一個。</p>
      <Field label="名稱" htmlFor="name" errors={state.fieldErrors?.name}>
        <input id="name" name="name" type="text" required defaultValue="公費" className={inputClass} />
      </Field>
      <Field label="幣別" htmlFor="currency" errors={state.fieldErrors?.currency}>
        <select id="currency" name="currency" defaultValue="JPY" className={inputClass}>
          {COMMON_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </Field>
      <SubmitButton>建立公費池</SubmitButton>
      <FormMessage error={state.error} />
    </form>
  );
}

export function ContributionForm({
  tripId,
  fundId,
  members,
}: {
  tripId: string;
  fundId: string;
  members: Array<{ id: string; name: string }>;
}) {
  const action = createFundContributionAction.bind(null, tripId);
  const [state, formAction] = useActionState(action, INITIAL_ACTION_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="fundId" value={fundId} />
      <div className="flex gap-3">
        <Field label="成員" htmlFor="memberId" errors={state.fieldErrors?.memberId}>
          <select id="memberId" name="memberId" required className={inputClass}>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="金額" htmlFor="amount" errors={state.fieldErrors?.amount}>
          <input
            id="amount"
            name="amount"
            type="text"
            inputMode="decimal"
            required
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="備註（選填）" htmlFor="note" errors={state.fieldErrors?.note}>
        <input id="note" name="note" type="text" className={inputClass} />
      </Field>
      <SubmitButton>新增提撥</SubmitButton>
      <FormMessage error={state.error} />
    </form>
  );
}
