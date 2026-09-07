import { readSessionToken } from "@/lib/auth/cookies";
import { verifySessionToken, type SessionUser } from "@/lib/auth/session";

/**
 * 取得目前登入的使用者，沒登入就回 null。
 *
 * RSC 與 Server Action 都用這一支。**這裡是真正的身分來源**——`middleware.ts`
 * 只看 cookie 存不存在（Edge runtime 連不到資料庫），那是導向用的粗篩，
 * 不是安全邊界，絕對不能拿它當作「已經驗過身分」的依據。
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = await readSessionToken();
  if (token === null) return null;
  const result = await verifySessionToken(token);
  return result?.user ?? null;
}
