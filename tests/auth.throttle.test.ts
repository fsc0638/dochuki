import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { authenticate, createPasswordUser } from "@/lib/auth/users";

/**
 * P7.2 登入失敗節流。
 *
 * ★ 需要本機 docker compose 的 PostgreSQL 已啟動。
 */

const EMAIL = "p72-throttle@test.invalid";
const PASSWORD = "a-very-good-password";

async function purge(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { endsWith: "@test.invalid" } } });
}

async function freshUser(): Promise<string> {
  await purge();
  const user = await createPasswordUser({
    email: EMAIL,
    password: PASSWORD,
    displayName: "節流測試",
  });
  return user.id;
}

describe("auth/users · 登入失敗節流", () => {
  beforeEach(async () => {
    await freshUser();
  });

  afterAll(async () => {
    await purge();
  });

  it("密碼正確時回傳使用者", async () => {
    const result = await authenticate(EMAIL, PASSWORD);
    expect("user" in result).toBe(true);
  });

  it("前 5 次失敗只回 invalid，不鎖定", async () => {
    for (let i = 1; i <= 5; i++) {
      const result = await authenticate(EMAIL, "wrong");
      expect(result).toEqual({ failure: "invalid" });
    }
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.failedLoginAttempts).toBe(5);
    expect(row.lockedUntil).toBeNull();
  });

  it("第 6 次失敗開始鎖定，且鎖定期間連正確密碼也不放行", async () => {
    for (let i = 1; i <= 5; i++) await authenticate(EMAIL, "wrong");
    expect(await authenticate(EMAIL, "wrong")).toEqual({ failure: "locked" });

    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.lockedUntil).not.toBeNull();
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // 鎖定期間即使密碼正確也不放行——否則節流形同虛設
    expect(await authenticate(EMAIL, PASSWORD)).toEqual({ failure: "locked" });
  });

  it("鎖定時間隨失敗次數遞增，但有 15 分鐘上限", async () => {
    for (let i = 1; i <= 6; i++) await authenticate(EMAIL, "wrong");
    const first = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const firstLockMs = first.lockedUntil!.getTime() - Date.now();

    // 手動解鎖後再連續失敗，鎖定時間應該變長
    await prisma.user.update({ where: { email: EMAIL }, data: { lockedUntil: null } });
    await authenticate(EMAIL, "wrong");
    const second = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const secondLockMs = second.lockedUntil!.getTime() - Date.now();
    expect(secondLockMs).toBeGreaterThan(firstLockMs);

    // 失敗很多次之後仍然不超過 15 分鐘——刻意不做永久鎖定，
    // 否則知道 email 就能把別人鎖在門外
    await prisma.user.update({
      where: { email: EMAIL },
      data: { failedLoginAttempts: 50, lockedUntil: null },
    });
    await authenticate(EMAIL, "wrong");
    const capped = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const cappedMs = capped.lockedUntil!.getTime() - Date.now();
    expect(cappedMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("鎖定到期後可以正常登入", async () => {
    for (let i = 1; i <= 6; i++) await authenticate(EMAIL, "wrong");
    // 把鎖定時間推到過去，模擬等待結束
    await prisma.user.update({
      where: { email: EMAIL },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    expect("user" in (await authenticate(EMAIL, PASSWORD))).toBe(true);
  });

  it("成功登入會把失敗計數歸零", async () => {
    for (let i = 1; i <= 3; i++) await authenticate(EMAIL, "wrong");
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).failedLoginAttempts,
    ).toBe(3);

    await authenticate(EMAIL, PASSWORD);
    const after = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(after.failedLoginAttempts).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it("不存在的帳號回 invalid，且不會因此建立任何紀錄", async () => {
    expect(await authenticate("nobody@test.invalid", PASSWORD)).toEqual({
      failure: "invalid",
    });
    expect(await prisma.user.count({ where: { email: "nobody@test.invalid" } })).toBe(0);
  });
});
