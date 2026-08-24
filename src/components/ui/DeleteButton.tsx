"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/actionState";

/** 通用刪除按鈕：獨立成一個小表單，失敗時就地顯示錯誤，不影響頁面其餘部分 */
export function DeleteButton({
  action,
  label = "刪除",
  confirmMessage,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  label?: string;
  confirmMessage?: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL_ACTION_STATE);

  return (
    <form
      action={formAction}
      className="flex flex-col items-end gap-1"
      onSubmit={(event) => {
        if (confirmMessage !== undefined && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      <SubmitButton variant="danger" pendingText="刪除中…">
        {label}
      </SubmitButton>
      {state.error !== undefined && (
        <span className="max-w-40 text-right text-xs text-red-600">
          {state.error}
        </span>
      )}
    </form>
  );
}
