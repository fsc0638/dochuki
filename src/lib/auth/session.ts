import { prisma } from "@/lib/db";
import { generateToken, hashToken } from "@/lib/auth/token";

/** session 有效期。每次驗證成功會往後延，所以是「多久沒用才登出」。 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 續期的最小間隔。沒有這道閘門的話，每一個請求都會寫一次資料庫只為了
 * 把 lastSeenAt 往後推一秒，讀多寫少的頁面會被這件事拖垮。
 */
const RENEW_THRESHOLD_MS = 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string | null;
  displayName: string;
}

/**
 * 簽發一組新 session。
 *
 * 回傳的 token 是唯一一次拿得到原始值的機會——DB 只存雜湊。呼叫端要負責
 * 把它放進 httpOnly cookie（P7.2 的事），不要記進 log。
 */
export async function createSession(
  userId: string,
  userAgent?: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      // 存起來只為了讓使用者在「登入裝置」清單裡認得出是哪一台，
      // 不拿來當驗證條件——UA 可以任意偽造，拿來擋反而給人錯誤的安全感
      userAgent: userAgent?.slice(0, 500),
    },
  });
  return { token, expiresAt };
}

/**
 * 驗證 token 並回傳對應的使用者。無效、過期一律回 null，不區分原因——
 * 對呼叫端來說兩者要做的事一樣（導去登入頁），區分只會多洩漏資訊。
 *
 * 順帶做滑動續期：距離上次活動超過一小時才寫一次 DB。
 */
export async function verifySessionToken(
  token: string,
): Promise<{ user: SessionUser; sessionId: string } | null> {
  if (token === "") return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastSeenAt: true,
      user: { select: { id: true, email: true, displayName: true } },
    },
  });
  if (session === null) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    // 過期的就地清掉，不留垃圾等批次來收
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  if (now - session.lastSeenAt.getTime() > RENEW_THRESHOLD_MS) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) },
      })
      .catch(() => undefined); // 續期失敗不該讓這次請求整個掛掉
  }

  return { user: session.user, sessionId: session.id };
}

/** 登出：只砍這一組 session，其他裝置不受影響 */
export async function revokeSession(token: string): Promise<void> {
  await prisma.session
    .delete({ where: { tokenHash: hashToken(token) } })
    .catch(() => undefined); // 已經不存在就當作已登出
}

/** 砍掉某個帳號的全部 session。改密碼、或懷疑帳號外洩時用。 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } });
  return count;
}

/** 清掉所有過期 session。之後可以掛成定期工作，現在先提供函式。 */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}
