"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/actionState";

/** 「重新解析」按鈕：對已上傳的收據圖再打一次解析，不用重新上傳 */
export function ReparseButton({
  action,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <SubmitButton pendingText="重新解析中…">重新解析</SubmitButton>
      <FormMessage error={state.error} />
    </form>
  );
}
