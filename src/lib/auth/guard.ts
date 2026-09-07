import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { requireTripAccess, isAccessDenied, type TripAccess, type TripRole } from "@/lib/auth/access";
import type { SessionUser } from "@/lib/auth/session";

/**
 * P7.4 全面守門的共用入口。
 *
 * 三種呼叫端對「沒權限」的正確回應形式不一樣，所以分三支，不要硬湊成一支：
 *   - 頁面（RSC）：`guardPage` → 沒登入導去登入頁、沒權限 404
 *   - Server Action：`guardAction` → 回傳 ActionState 形狀的錯誤，不丟例外
 *   - Route Handler：`guardRoute` → 回 401/404 的 JSON
 *
 * **一律不區分「行程不存在」與「你沒有權限」**（`requireTripAccess` 的錯誤
 * 訊息本身就是這樣設計的），否則任何人可以拿 cuid 探測哪些行程存在。
 */

/**
 * 頁面用。沒登入就導去登入頁並帶上回程網址；登入了但不是這個行程的成員，
 * 一律 `notFound()`——對他來說這個行程就是不存在。
 *
 * 這兩個函式都會拋出 Next.js 的控制流例外（NEXT_REDIRECT / NEXT_NOT_FOUND），
 * 所以呼叫端不需要、也不應該用 try/catch 包住它。
 */
export async function guardPage(
  tripId: string,
  minimumRole: TripRole = "VIEWER",
): Promise<TripAccess> {
  const user = await getCurrentUser();
  if (user === null) {
    redirect(`/login?next=${encodeURIComponent(`/trips/${tripId}`)}`);
  }
  try {
    return await requireTripAccess(tripId, minimumRole);
  } catch (error) {
    if (isAccessDenied(error)) notFound();
    throw error;
  }
}

/** 只需要「有登入」的頁面（例如行程列表、建立新行程） */
export async function guardSignedInPage(next: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (user === null) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return user;
}

/**
 * Server Action 用。回 `{ denied: true, message }` 而不是丟例外——action 的
 * 慣例是把錯誤放進 ActionState 給表單顯示，丟例外會變成整頁的錯誤畫面。
 */
export type GuardResult =
  | { ok: true; access: TripAccess }
  | { ok: false; message: string };

export async function guardAction(
  tripId: string,
  minimumRole: TripRole = "EDITOR",
): Promise<GuardResult> {
  try {
    return { ok: true, access: await requireTripAccess(tripId, minimumRole) };
  } catch (error) {
    if (isAccessDenied(error)) {
      return { ok: false, message: "找不到這個行程，或你沒有存取權限" };
    }
    throw error;
  }
}

/**
 * Route Handler 用。**未登入回 401，已登入但沒權限回 404。**
 *
 * 401 與 404 分開是刻意的：離線佇列補送（`POST /api/trips/[id]/expenses`）
 * 需要能分辨「session 過期了，重新登入就好」與「這筆資料本來就不該送」，
 * 前者要保留在佇列裡等使用者登入，後者不該無限重試（見 offline/outbox.ts）。
 */
export async function guardRoute(
  tripId: string,
  minimumRole: TripRole = "VIEWER",
): Promise<{ ok: true; access: TripAccess } | { ok: false; response: NextResponse }> {
  const user = await getCurrentUser();
  if (user === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: "請先登入" }, { status: 401 }),
    };
  }
  try {
    return { ok: true, access: await requireTripAccess(tripId, minimumRole) };
  } catch (error) {
    if (isAccessDenied(error)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "行程不存在" }, { status: 404 }),
      };
    }
    throw error;
  }
}

/** 只需要「有登入」的 route handler（例如收據上傳，行程權限另外查） */
export async function guardSignedInRoute(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUser();
  if (user === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: "請先登入" }, { status: 401 }),
    };
  }
  return { ok: true, user };
}
