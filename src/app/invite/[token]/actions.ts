"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { toErrorMessage, type ActionState } from "@/lib/actionState";
import { getCurrentUser } from "@/lib/auth/current";
import { setSessionCookie } from "@/lib/auth/cookies";
import { redeemInvite } from "@/lib/auth/invites";
import { inviteProblemMessage } from "@/lib/auth/inviteMessages";

export async function acceptInviteAction(
  token: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  let tripId: string;
  try {
    const current = await getCurrentUser();
    const userAgent = (await headers()).get("user-agent") ?? undefined;
    const result = await redeemInvite(token, current?.id ?? null, userAgent);

    if ("problem" in result) {
      return { error: inviteProblemMessage(result.problem) };
    }
    // 新建的帳號要當場登入；已登入的人 sessionToken 是 null，沿用原本的
    if (result.sessionToken !== null) {
      await setSessionCookie(result.sessionToken);
    }
    tripId = result.tripId;
  } catch (error) {
    return { error: toErrorMessage(error) };
  }

  redirect(`/trips/${tripId}`);
}
