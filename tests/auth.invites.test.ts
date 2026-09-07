import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createPasswordUser } from "@/lib/auth/users";
import { verifySessionToken } from "@/lib/auth/session";
import {
  createInvite,
  listInvites,
  previewInvite,
  redeemInvite,
  revokeInvite,
} from "@/lib/auth/invites";

/**
 * P7.3 邀請券。
 *
 * ★ 需要本機 docker compose 的 PostgreSQL 已啟動。
 *
 * 券是「知道網址就能進」的憑證，三道閘門（到期、次數、撤銷）與「一個成員
 * 只能被一個帳號認領」是它唯一的保護，所以每一條都要有測試。
 */

const OWNER_EMAIL = "p73-owner@test.invalid";
const PASSWORD = "a-very-good-password";

let ownerId: string;
let tripId: string;
let memberA: string;
let memberB: string;

async function purge(): Promise<void> {
  const trips = await prisma.trip.findMany({
    where: { name: { startsWith: "P73 " } },
    select: { id: true },
  });
  const ids = trips.map((t) => t.id);
  if (ids.length > 0) {
    await prisma.invite.deleteMany({ where: { tripId: { in: ids } } });
    await prisma.tripMembership.deleteMany({ where: { tripId: { in: ids } } });
    await prisma.member.deleteMany({ where: { tripId: { in: ids } } });
    await prisma.trip.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: "@test.invalid" } } });
  // 邀請進來的帳號沒有 email，靠顯示名稱清
  await prisma.user.deleteMany({ where: { displayName: { startsWith: "P73" } } });
}

async function setup(): Promise<void> {
  await purge();
  ownerId = (
    await createPasswordUser({
      email: OWNER_EMAIL,
      password: PASSWORD,
      displayName: "P73團長",
    })
  ).id;
  const trip = await prisma.trip.create({
    data: {
      name: "P73 邀請測試",
      startDate: new Date("2026-12-01"),
      endDate: new Date("2026-12-10"),
      memberships: { create: { userId: ownerId, role: "OWNER" } },
      members: { create: [{ name: "P73甲" }, { name: "P73乙" }] },
    },
    include: { members: true },
  });
  tripId = trip.id;
  memberA = trip.members[0].id;
  memberB = trip.members[1].id;
}

describe("auth/invites", () => {
  beforeEach(async () => {
    await setup();
  });

  afterAll(async () => {
    await purge();
  });

  it("開券後可以預覽，看得到行程名與被指定的身分", async () => {
    const { token } = await createInvite({
      tripId,
      memberId: memberA,
      role: "EDITOR",
      createdBy: ownerId,
    });
    const result = await previewInvite(token);
    expect("preview" in result).toBe(true);
    if ("preview" in result) {
      expect(result.preview.tripName).toBe("P73 邀請測試");
      expect(result.preview.memberName).toBe("P73甲");
      expect(result.preview.role).toBe("EDITOR");
    }
  });

  it("資料庫只存雜湊，原始 token 查不到", async () => {
    const { token } = await createInvite({
      tripId,
      memberId: memberA,
      role: "EDITOR",
      createdBy: ownerId,
    });
    expect(await prisma.invite.findUnique({ where: { tokenHash: token } })).toBeNull();
  });

  it("到期日不會超過行程結束日", async () => {
    // 預設 7 天，但行程 12/10 就結束——取較早的那個
    const { expiresAt } = await createInvite({
      tripId,
      memberId: memberA,
      role: "EDITOR",
      createdBy: ownerId,
      days: 3650,
    });
    expect(expiresAt.getTime()).toBeLessThanOrEqual(new Date("2026-12-11").getTime());
  });

  it("未登入認領：建立無密碼帳號、綁定成員、發出可用的 session", async () => {
    const { token } = await createInvite({
      tripId,
      memberId: memberA,
      role: "EDITOR",
      createdBy: ownerId,
    });
    const result = await redeemInvite(token, null);
    expect("problem" in result).toBe(false);
    if ("problem" in result) return;

    expect(result.tripId).toBe(tripId);
    expect(result.sessionToken).not.toBeNull();

    // 簽出來的 session 真的能用
    const session = await verifySessionToken(result.sessionToken!);
    expect(session).not.toBeNull();
    expect(session?.user.displayName).toBe("P73甲");
    // 邀請帳號沒有 email 也沒有密碼
    const row = await prisma.user.findUniqueOrThrow({ where: { id: session!.user.id } });
    expect(row.email).toBeNull();
    expect(row.passwordHash).toBeNull();

    // 綁定關係正確
    const membership = await prisma.tripMembership.findUniqueOrThrow({
      where: { tripId_userId: { tripId, userId: session!.user.id } },
    });
    expect(membership.memberId).toBe(memberA);
    expect(membership.role).toBe("EDITOR");
  });

  it("已登入認領：綁到現有帳號，不另外建帳號也不發新 session", async () => {
    const guest = await createPasswordUser({
      email: "p73-guest@test.invalid",
      password: PASSWORD,
      displayName: "P73既有帳號",
    });
    const before = await prisma.user.count();

    const { token } = await createInvite({
      tripId,
      memberId: memberA,
      role: "VIEWER",
      createdBy: ownerId,
    });
    const result = await redeemInvite(token, guest.id);
    expect("problem" in result).toBe(false);
    if ("problem" in result) return;

    expect(result.sessionToken).toBeNull();
    expect(await prisma.user.count()).toBe(before);

    const membership = await prisma.tripMembership.findUniqueOrThrow({
      where: { tripId_userId: { tripId, userId: guest.id } },
    });
    expect(membership.memberId).toBe(memberA);
    expect(membership.role).toBe("VIEWER");
  });

  it("撤銷後不能預覽也不能認領", async () => {
    const { token } = await createInvite({
      tripId,
      memberId: memberA,
      role: "EDITOR",
      createdBy: ownerId,
    });
    const [invite] = await listInvites(tripId);
    await revokeInvite(tripId, invite.id);

    expect(await previewInvite(token)).toEqual({ problem: "revoked" });
    expect(await redeemInvite(token, null)).toEqual({ problem: "revoked" });
  });

  it("撤銷別的行程的券會被拒絕", async () => {
    const { token } = await createInvite({
      tripId,
      memberId: memberA,
      role: "EDITOR",
      createdBy: ownerId,
    });
    const [invite] = await listInvites(tripId);

    const other = await prisma.trip.create({
      data: { name: "P73 另一個行程", startDate: new Date(), endDate: new Date() },
    });
    await expect(revokeInvite(other.id, invite.id)).rejects.toThrow("找不到這張邀請券");
    // 原本那張仍然有效
    expect("preview" in (await previewInvite(token))).toBe(true);
  });

  it("過期的券不能用", async () => {
    const { token } = await createInvite({
      tripId,
      memberId: memberA,
      role: "EDITOR",
      createdBy: ownerId,
    });
    await prisma.invite.updateMany({
      where: { tripId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await previewInvite(token)).toEqual({ problem: "expired" });
    expect(await redeemInvite(token, null)).toEqual({ problem: "expired" });
  });

  it("用完次數的券不能用", async () => {
    const { token } = await createInvite({
      tripId,
      memberId: memberA,
      role: "EDITOR",
      createdBy: ownerId,
      maxUses: 1,
    });
    expect("problem" in (await redeemInvite(token, null))).toBe(false);
    // 第二次：成員已被認領（比次數更早擋下來）
    expect(await redeemInvite(token, null)).toEqual({ problem: "member-taken" });
  });

  it("一個成員只能被一個帳號認領——第二張券也擋得住", async () => {
    const first = await createInvite({
      tripId,
      memberId: memberA,
      role: "EDITOR",
      createdBy: ownerId,
    });
    await redeemInvite(first.token, null);

    // 已被認領的成員不能再開券
    await expect(
      createInvite({ tripId, memberId: memberA, role: "EDITOR", createdBy: ownerId }),
    ).rejects.toThrow("已經有人認領");
  });

  it("同一張券被兩個人同時認領，只有一個會成功", async () => {
    const { token } = await createInvite({
      tripId,
      memberId: memberB,
      role: "EDITOR",
      createdBy: ownerId,
      maxUses: 5,
    });

    const [a, b] = await Promise.all([
      redeemInvite(token, null).catch(() => ({ problem: "not-found" as const })),
      redeemInvite(token, null).catch(() => ({ problem: "not-found" as const })),
    ]);

    const succeeded = [a, b].filter((r) => !("problem" in r));
    expect(succeeded).toHaveLength(1);

    // 只有一筆綁定，不會兩個帳號都指向同一個成員
    expect(await prisma.tripMembership.count({ where: { memberId: memberB } })).toBe(1);
  });

  it("不存在的 token 回 not-found，不丟例外", async () => {
    expect(await previewInvite("totally-made-up")).toEqual({ problem: "not-found" });
    expect(await redeemInvite("totally-made-up", null)).toEqual({ problem: "not-found" });
  });

  it("不能對別的行程的成員開券", async () => {
    const other = await prisma.trip.create({
      data: {
        name: "P73 另一團",
        startDate: new Date("2026-12-01"),
        endDate: new Date("2026-12-10"),
        members: { create: [{ name: "P73外人" }] },
      },
      include: { members: true },
    });
    await expect(
      createInvite({
        tripId,
        memberId: other.members[0].id,
        role: "EDITOR",
        createdBy: ownerId,
      }),
    ).rejects.toThrow("不屬於這個行程");
  });
});
