import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "dochuki_session";

/**
 * 未登入導向（P7.2）。
 *
 * ⚠️ **這不是安全邊界。** middleware 跑在 Edge runtime，連不到資料庫，
 * 所以它只能看「cookie 在不在」，沒辦法驗證那個 token 是真的。任何人手動
 * 塞一個 `dochuki_session=x` 就能通過這一關。
 *
 * 真正的守門是每個頁面／action／route 各自呼叫 `getCurrentUser()`（P7.4 會
 * 把 31 個進出口全部補上）。這裡只負責一件事：讓沒登入的人少看到一次
 * 「載入後才被踢走」的閃爍，直接在邊緣就導去登入頁。
 */

/** 這些路徑不需要登入就能看 */
const PUBLIC_PATHS = ["/login", "/signup"];

/**
 * 這些前綴完全不經過 middleware 判斷。
 *
 * `/api/` 特別重要：離線佇列補送打的是 `/api/trips/[id]/expenses`，
 * 如果 session 過期時回傳一個導向登入頁的 3xx，Service Worker 端會拿到
 * 一份 HTML 當成「送出成功」或是奇怪的錯誤。API 的身分檢查留給 route
 * handler 自己做，讓它能回真正的 401（P7.4）。
 */
const SKIP_PREFIXES = ["/api/", "/_next/", "/icons/"];
const SKIP_FILES = ["/manifest.json", "/sw.js", "/favicon.ico"];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }
  if (SKIP_FILES.includes(pathname)) {
    return NextResponse.next();
  }
  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const hasCookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (hasCookie !== undefined && hasCookie !== "") {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  // 登入後回到原本要去的地方。只帶 path＋query，不帶網域，
  // 避免變成開放轉址（actions.ts 的 safeNext 還會再驗一次）
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 靜態資源與圖片最佳化不必經過這裡。SKIP_PREFIXES 已經涵蓋，
  // 這層 matcher 是為了讓它們連 middleware 都不必啟動
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
