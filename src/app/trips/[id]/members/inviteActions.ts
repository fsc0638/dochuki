"use server";

import { revalidatePath } from "next/cache";
import { toErrorMessage, type ActionState } from "@/lib/actionState";
import { isAccessDenied, requireTripAccess } from "@/lib/auth/access";
import { createInvite, revokeInvite, type InvitableRole } from "@/lib/auth/invites";

/**
 * 邀請券的建立與撤銷（P7.3）。
 *
 * 兩支都要求 **OWNER**——「被邀請者不能再邀請別人」（2026-09-07 裁示）就是
 * 靠這道守門實現的。這裡不能等 P7.4 再補，發券本身就是權限授予動作。
 */

/** 建立成功時額外把原始 token 帶回來給畫面顯示——它只有這一次拿得到 */
export interface InviteActionState extends ActionState {
  inviteUrl?: string;
  expiresAt?: string;
}

export async function createInviteAction(
  tripId: string,
  memberId: string,
  _prevState: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const roleRaw = formData.get("role");
  const role: InvitableRole = roleRaw === "VIEWER" ? "VIEWER" : "EDITOR";

  try {
    const access = await requireTripAccess(tripId, "OWNER");
    const { token, expiresAt } = await createInvite({
      tripId,
      memberId,
      role,
      createdBy: access.user.id,
    });
    revalidatePath(`/trips/${tripId}/members`);
    return {
      // 只回相對路徑：伺服器端不知道使用者是從哪個網域進來的（tunnel、
      // 之後的正式網域都不同），讓瀏覽器端用 location.origin 補完整
      inviteUrl: `/invite/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    if (isAccessDenied(error)) return { error: "只有行程建立者可以發送邀請" };
    return { error: toErrorMessage(error) };
  }
}

export async function revokeInviteAction(
  tripId: string,
  inviteId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    await requireTripAccess(tripId, "OWNER");
    await revokeInvite(tripId, inviteId);
  } catch (error) {
    if (isAccessDenied(error)) return { error: "只有行程建立者可以撤銷邀請" };
    return { error: toErrorMessage(error) };
  }
  revalidatePath(`/trips/${tripId}/members`);
  return {};
}
