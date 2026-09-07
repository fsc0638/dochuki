import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { SignupInput } from "@/lib/schemas/auth";

/**
 * 建立密碼帳號。email 已由 zod 正規化成小寫。
 *
 * email 重複時丟出看得懂的訊息，而不是讓 Prisma 的 P2002 冒到畫面上。
 * 註：這個函式是給 CLI 與 P7.2 的註冊流程共用的；註冊頁面回應時要小心
 * 不要把「這個 email 已註冊」直接顯示給未登入的人，那是帳號枚舉。
 */
export async function createPasswordUser(
  input: SignupInput,
): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing !== null) {
    throw new Error("這個電子郵件已經註冊過了");
  }
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName,
    },
    select: { id: true },
  });
  return user;
}

/**
 * 以 email＋密碼驗證身分。成功回使用者 id，失敗一律回 null。
 *
 * 帳號不存在時仍然跑一次 scrypt（拿一組固定的假雜湊去驗），讓「查無此帳號」
 * 與「密碼錯誤」的回應時間落在同一個量級。少了這一步，攻擊者用回應快慢就能
 * 判斷哪些 email 有註冊——scrypt 要 150ms 上下，這個差距用碼表都量得出來。
 */
const DUMMY_HASH =
  "scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/**
 * 登入失敗節流（P7.2）。
 *
 * 前 FREE_ATTEMPTS 次失敗不鎖，之後每多失敗一次就鎖久一點，上限
 * MAX_LOCK_MS。**刻意不做永久鎖定**——鎖帳號這件事本身可以被拿來癱瘓
 * 別人的帳號（知道 email 就能一直亂猜），15 分鐘的上限足以讓自動化撞庫
 * 變得不划算，又不至於讓正常使用者被永久擋在門外。
 */
const FREE_ATTEMPTS = 5;
const BASE_LOCK_MS = 60 * 1000;
const MAX_LOCK_MS = 15 * 60 * 1000;

function lockDurationFor(attempts: number): number {
  const over = attempts - FREE_ATTEMPTS;
  if (over <= 0) return 0;
  return Math.min(BASE_LOCK_MS * 2 ** (over - 1), MAX_LOCK_MS);
}

export type AuthFailure = "invalid" | "locked";

/**
 * 以 email＋密碼驗證身分。
 *
 * 回傳 `{ user }` 或 `{ failure }`。呼叫端對 invalid 與 locked 應該給
 * **不同的訊息**（鎖定要告訴使用者稍後再試，否則他只會一直重試），但兩者
 * 都不能透露「這個 email 有沒有註冊」。
 */
export async function authenticate(
  email: string,
  password: string,
): Promise<{ user: { id: string } } | { failure: AuthFailure }> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      passwordHash: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    },
  });

  if (user === null) {
    await verifyPassword(password, DUMMY_HASH);
    return { failure: "invalid" };
  }

  if (user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()) {
    // 仍然跑一次雜湊，讓「鎖定中」與「密碼錯誤」的回應時間不要差一個量級
    await verifyPassword(password, DUMMY_HASH);
    return { failure: "locked" };
  }

  const ok = await verifyPassword(password, user.passwordHash);

  if (!ok) {
    const attempts = user.failedLoginAttempts + 1;
    const lockMs = lockDurationFor(attempts);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: lockMs === 0 ? null : new Date(Date.now() + lockMs),
      },
    });
    return { failure: lockMs === 0 ? "invalid" : "locked" };
  }

  // 成功就歸零。只在真的有紀錄要清時才寫，省掉每次登入都無謂地更新一列
  if (user.failedLoginAttempts !== 0 || user.lockedUntil !== null) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  return { user: { id: user.id } };
}

/**
 * 把「還沒有任何人擁有」的行程收編給指定帳號。
 *
 * P7.4 全面守門之前必須跑過，否則守門一上線，既有行程會變成沒有任何
 * TripMembership 指向它們，等於所有人都被鎖在門外（見 docs/AUTH_PLAN.md）。
 *
 * 可重複執行：只挑完全沒有成員關係的行程，已經有主人的不會被搶走。
 */
export async function adoptOrphanTrips(userId: string): Promise<string[]> {
  const orphans = await prisma.trip.findMany({
    where: { memberships: { none: {} } },
    select: { id: true, name: true },
  });
  if (orphans.length === 0) return [];

  await prisma.tripMembership.createMany({
    data: orphans.map((trip) => ({ tripId: trip.id, userId, role: "OWNER" as const })),
  });
  return orphans.map((trip) => trip.name);
}
