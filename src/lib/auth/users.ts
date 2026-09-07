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

export async function authenticate(
  email: string,
  password: string,
): Promise<{ id: string } | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  if (user === null) {
    await verifyPassword(password, DUMMY_HASH);
    return null;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? { id: user.id } : null;
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
