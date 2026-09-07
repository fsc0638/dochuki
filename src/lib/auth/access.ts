import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import type { SessionUser } from "@/lib/auth/session";

/**
 * 行程層級的權限判斷（P7.3 引入，P7.4 會讓 31 個進出口全部走這裡）。
 *
 * 角色高低：OWNER > EDITOR > VIEWER。判斷一律問「夠不夠」而不是「等不等於」，
 * 這樣新增角色時不必回頭改每個呼叫點。
 */
export type TripRole = "OWNER" | "EDITOR" | "VIEWER";

const RANK: Record<TripRole, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

export interface TripAccess {
  user: SessionUser;
  role: TripRole;
  /** 這個帳號在該行程對應的團員；還沒認領身分時是 null */
  memberId: string | null;
}

/**
 * 取得目前使用者對某個行程的權限，沒登入或不是成員就回 null。
 *
 * 回 null 而不是丟例外，是為了讓呼叫端自己決定要 `notFound()` 還是回 401——
 * 頁面與 API 對「沒權限」的正確回應形式不一樣。
 */
export async function getTripAccess(tripId: string): Promise<TripAccess | null> {
  const user = await getCurrentUser();
  if (user === null) return null;

  const membership = await prisma.tripMembership.findUnique({
    where: { tripId_userId: { tripId, userId: user.id } },
    select: { role: true, memberId: true },
  });
  if (membership === null) return null;

  return { user, role: membership.role, memberId: membership.memberId };
}

/**
 * 要求至少某個角色，不足就丟出例外。
 *
 * 訊息刻意一律是「找不到這個行程，或你沒有存取權限」——不區分「行程不存在」
 * 與「你不是成員」。區分開來等於讓任何人可以拿 cuid 去探測哪些行程存在。
 */
export class AccessDeniedError extends Error {
  constructor() {
    super("找不到這個行程，或你沒有存取權限");
    this.name = "AccessDeniedError";
  }
}

export async function requireTripAccess(
  tripId: string,
  minimumRole: TripRole = "VIEWER",
): Promise<TripAccess> {
  const access = await getTripAccess(tripId);
  if (access === null || RANK[access.role] < RANK[minimumRole]) {
    throw new AccessDeniedError();
  }
  return access;
}

export function isAccessDenied(error: unknown): boolean {
  return error instanceof AccessDeniedError;
}
