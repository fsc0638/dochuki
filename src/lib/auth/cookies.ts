import { cookies } from "next/headers";
import { SESSION_TTL_MS } from "@/lib/auth/session";

export const SESSION_COOKIE = "dochuki_session";

/**
 * session cookie 的共同屬性。
 *
 * `secure` 依環境決定：正式站掛上 TLS 之前（現在是 SSH tunnel 走純 HTTP），
 * 開了 secure 瀏覽器根本不會送出 cookie，等於誰都登不進去。P7.5 掛上憑證後
 * NODE_ENV=production 本來就成立，會自動開啟。
 *
 * `sameSite: lax` 讓跨站的表單 POST 帶不到 cookie，順帶擋掉大部分 CSRF；
 * 一般的站外連結點進來（GET 導覽）仍然保有登入狀態。
 */
function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(Math.floor(SESSION_TTL_MS / 1000)));
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  // 用 maxAge 0 覆寫而不是 delete()：屬性要跟當初設定時一致，否則某些瀏覽器
  // 會當成另一個 cookie 而留下原本那個
  store.set(SESSION_COOKIE, "", cookieOptions(0));
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}
