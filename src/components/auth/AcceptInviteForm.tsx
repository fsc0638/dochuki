"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "@/app/invite/[token]/actions";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { INITIAL_ACTION_STATE } from "@/lib/actionState";

export function AcceptInviteForm({
  token,
  memberName,
}: {
  token: string;
  memberName: string;
}) {
  const action = acceptInviteAction.bind(null, token);
  const [state, formAction] = useActionState(action, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <FormMessage error={state.error} />
      <SubmitButton pendingText="加入中…">{`我是 ${memberName}，加入行程`}</SubmitButton>
    </form>
  );
}
