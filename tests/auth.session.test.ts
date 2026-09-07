import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/auth/token";
import {
  createSession,
  purgeExpiredSessions,
  revokeAllSessions,
  revokeSession,
  verifySessionToken,
} from "@/lib/auth/session";
import { adoptOrphanTrips, authenticate, createPasswordUser } from "@/lib/auth/users";

/**
 * P7.1 session 與帳號測試。
 *
 * ★ 需要本機 docker compose 的 PostgreSQL 已啟動（同 tests/trips.write.test.ts）。
 *
 * 全程使用測試專屬的 email 前綴與行程，afterAll 清乾淨，不碰 seed 的
 * trip-niigata-2026。
 */

const EMAIL_A = "p71-a@test.invalid";
const EMAIL_B = "p71-b@test.invalid";
const PASSWORD = "a-very-good-password";

async function purgeTestUsers(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { endsWith: "@test.invalid" } } });
}

describe("auth/session · 簽發與驗證", () => {
  let userId: string;

  beforeAll(async () => {
    await purgeTestUsers();
    const user = await createPasswordUser({
      email: EMAIL_A,
      password: PASSWORD,
      displayName: "測試甲",
    });
    userId = user.id;
  });

  afterAll(async () => {
    await purgeTestUsers();
  });

  it("簽發的 token 驗得過，並帶回正確的使用者", async () => {
    const { token } = await createSession(userId);
    const result = await verifySessionToken(token);
    expect(result).not.toBeNull();
    expect(result?.user.id).toBe(userId);
    expect(result?.user.email).toBe(EMAIL_A);
    expect(result?.user.displayName).toBe("測試甲");
  });

  it("資料庫只存雜湊，不存原始 token", async () => {
    const { token } = await createSession(userId);
    // 用原始 token 當 tokenHash 查，應該查不到
    expect(await prisma.session.findUnique({ where: { tokenHash: token } })).toBeNull();
    // 用雜湊查得到
    expect(
      await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } }),
    ).not.toBeNull();
  });

  it("每次簽發的 token 都不同", async () => {
    const a = await createSession(userId);
    const b = await createSession(userId);
    expect(a.token).not.toBe(b.token);
  });

  it("亂編的 token、空字串一律回 null", async () => {
    expect(await verifySessionToken("")).toBeNull();
    expect(await verifySessionToken("not-a-real-token")).toBeNull();
  });

  it("過期的 session 驗不過，而且會被就地刪除", async () => {
    const { token } = await createSession(userId);
    await prisma.session.update({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await verifySessionToken(token)).toBeNull();
    expect(
      await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } }),
    ).toBeNull();
  });

  it("超過續期門檻才會延長到期日（讀多寫少的頁面不會每次都寫 DB）", async () => {
    const { token } = await createSession(userId);
    const hash = hashToken(token);

    // 剛簽發，lastSeenAt 是現在 → 驗證後不該有異動
    const before = await prisma.session.findUniqueOrThrow({ where: { tokenHash: hash } });
    await verifySessionToken(token);
    const unchanged = await prisma.session.findUniqueOrThrow({ where: { tokenHash: hash } });
    expect(unchanged.lastSeenAt.getTime()).toBe(before.lastSeenAt.getTime());
    expect(unchanged.expiresAt.getTime()).toBe(before.expiresAt.getTime());

    // 把 lastSeenAt 推回兩小時前 → 這次驗證應該續期
    await prisma.session.update({
      where: { tokenHash: hash },
      data: { lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    await verifySessionToken(token);
    const renewed = await prisma.session.findUniqueOrThrow({ where: { tokenHash: hash } });
    expect(renewed.lastSeenAt.getTime()).toBeGreaterThan(unchanged.lastSeenAt.getTime());
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
  });

  it("revokeSession 只砍那一組，其他裝置不受影響", async () => {
    const a = await createSession(userId, "裝置A");
    const b = await createSession(userId, "裝置B");

    await revokeSession(a.token);

    expect(await verifySessionToken(a.token)).toBeNull();
    expect(await verifySessionToken(b.token)).not.toBeNull();
  });

  it("revokeSession 對不存在的 token 不丟例外", async () => {
    await expect(revokeSession("nonexistent")).resolves.toBeUndefined();
  });

  it("revokeAllSessions 砍掉這個帳號的全部 session", async () => {
    const a = await createSession(userId);
    const b = await createSession(userId);
    const count = await revokeAllSessions(userId);

    expect(count).toBeGreaterThanOrEqual(2);
    expect(await verifySessionToken(a.token)).toBeNull();
    expect(await verifySessionToken(b.token)).toBeNull();
  });

  it("purgeExpiredSessions 只清過期的，有效的留著", async () => {
    const alive = await createSession(userId);
    const dead = await createSession(userId);
    await prisma.session.update({
      where: { tokenHash: hashToken(dead.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await purgeExpiredSessions();

    expect(
      await prisma.session.findUnique({ where: { tokenHash: hashToken(dead.token) } }),
    ).toBeNull();
    expect(await verifySessionToken(alive.token)).not.toBeNull();
  });

  it("userAgent 過長時截斷，不會寫入失敗", async () => {
    const { token } = await createSession(userId, "x".repeat(2000));
    const row = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
    });
    expect(row.userAgent?.length).toBe(500);
  });
});

describe("auth/users · 建立與驗證", () => {
  afterAll(async () => {
    await purgeTestUsers();
  });

  it("建立帳號後可用 email＋密碼驗證", async () => {
    await purgeTestUsers();
    const created = await createPasswordUser({
      email: EMAIL_B,
      password: PASSWORD,
      displayName: "測試乙",
    });

    const ok = await authenticate(EMAIL_B, PASSWORD);
    expect("user" in ok && ok.user.id).toBe(created.id);

    expect(await authenticate(EMAIL_B, "wrong-password")).toEqual({ failure: "invalid" });
    expect(await authenticate("nobody@test.invalid", PASSWORD)).toEqual({
      failure: "invalid",
    });
  });

  it("email 重複時明確拒絕", async () => {
    await expect(
      createPasswordUser({ email: EMAIL_B, password: PASSWORD, displayName: "重複" }),
    ).rejects.toThrow("已經註冊過");
  });

  it("密碼不落地成明文，DB 存的是 scrypt 雜湊", async () => {
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_B } });
    expect(row.passwordHash).not.toBe(PASSWORD);
    expect(row.passwordHash?.startsWith("scrypt$")).toBe(true);
  });
});

describe("auth/users · adoptOrphanTrips", () => {
  let userId: string;
  let orphanTripId: string;
  let ownedTripId: string;
  let otherUserId: string;
  /** 測試開始前資料庫既有的成員關係數。用來確認測試沒有留下殘渣。 */
  let baselineMemberships: number;

  beforeAll(async () => {
    await purgeTestUsers();
    baselineMemberships = await prisma.tripMembership.count();
    userId = (
      await createPasswordUser({
        email: EMAIL_A,
        password: PASSWORD,
        displayName: "收編者",
      })
    ).id;
    otherUserId = (
      await createPasswordUser({
        email: EMAIL_B,
        password: PASSWORD,
        displayName: "既有主人",
      })
    ).id;

    orphanTripId = (
      await prisma.trip.create({
        data: {
          name: "P71 無主行程",
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-02"),
        },
      })
    ).id;
    ownedTripId = (
      await prisma.trip.create({
        data: {
          name: "P71 已有主人",
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-02"),
          memberships: { create: { userId: otherUserId, role: "OWNER" } },
        },
      })
    ).id;
  });

  /**
   * ⚠️ adoptOrphanTrips 的定義就是「收編所有無主行程」，所以它也會把 seed 進去的
   * trip-niigata-2026 一起收編——那正是這個函式該做的事，不是 bug。
   *
   * 清理靠 TripMembership.userId 的 onDelete: Cascade：刪掉測試帳號，連帶
   * 它在既有行程上留下的成員關係也會一起消失。所以 purgeTestUsers() 一定要
   * 跑，順序也不能放在刪測試行程之前。
   *
   * 檢查用「跟開始前比較」而不是「必須為 0」——資料庫裡本來就可能有真實
   * 帳號的成員關係（例如管理者 bootstrap 建立的那筆），寫死 0 會在正常
   * 使用之後開始誤報。
   */
  afterAll(async () => {
    await prisma.tripMembership.deleteMany({
      where: { tripId: { in: [orphanTripId, ownedTripId] } },
    });
    await prisma.trip.deleteMany({ where: { id: { in: [orphanTripId, ownedTripId] } } });
    await purgeTestUsers();

    const after = await prisma.tripMembership.count();
    if (after !== baselineMemberships) {
      throw new Error(
        `測試後 TripMembership 從 ${baselineMemberships} 變成 ${after} 筆，可能污染了既有資料`,
      );
    }
  });

  it("只收編沒有任何成員關係的行程，已有主人的不會被搶走", async () => {
    const adopted = await adoptOrphanTrips(userId);
    expect(adopted).toContain("P71 無主行程");
    expect(adopted).not.toContain("P71 已有主人");

    const orphanNow = await prisma.tripMembership.findFirstOrThrow({
      where: { tripId: orphanTripId },
    });
    expect(orphanNow.userId).toBe(userId);
    expect(orphanNow.role).toBe("OWNER");

    const ownedNow = await prisma.tripMembership.findFirstOrThrow({
      where: { tripId: ownedTripId },
    });
    expect(ownedNow.userId).toBe(otherUserId);
  });

  it("可重複執行：第二次沒有東西可收編", async () => {
    const again = await adoptOrphanTrips(userId);
    expect(again).toEqual([]);
  });
});
