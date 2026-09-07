import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createPasswordUser } from "@/lib/auth/users";

/**
 * P7.3 行程權限守門。這支是 P7.4 要讓 31 個進出口全部走過的接縫，
 * 所以先在這裡把語意釘死。
 *
 * ★ 需要本機 docker compose 的 PostgreSQL 已啟動。
 *
 * `getCurrentUser()` 會讀 cookie，在 vitest 的 node 環境沒有請求情境可用，
 * 所以 mock 掉它——要驗的是「拿到身分之後怎麼判斷權限」，不是 cookie 怎麼讀。
 */

const currentUser = vi.hoisted(() => ({ value: null as { id: string; email: string | null; displayName: string } | null }));

vi.mock("@/lib/auth/current", () => ({
  getCurrentUser: async () => currentUser.value,
}));

const { getTripAccess, isAccessDenied, requireTripAccess } = await import("@/lib/auth/access");

let ownerId: string;
let editorId: string;
let viewerId: string;
let strangerId: string;
let tripId: string;
let memberId: string;

async function purge(): Promise<void> {
  const trips = await prisma.trip.findMany({
    where: { name: { startsWith: "P73access" } },
    select: { id: true },
  });
  const ids = trips.map((t) => t.id);
  if (ids.length > 0) {
    await prisma.tripMembership.deleteMany({ where: { tripId: { in: ids } } });
    await prisma.member.deleteMany({ where: { tripId: { in: ids } } });
    await prisma.trip.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: "@access.invalid" } } });
}

function actAs(id: string | null): void {
  currentUser.value =
    id === null ? null : { id, email: "x@access.invalid", displayName: "測試" };
}

describe("auth/access · requireTripAccess", () => {
  beforeAll(async () => {
    await purge();
    const mk = async (name: string): Promise<string> =>
      (
        await createPasswordUser({
          email: `${name}@access.invalid`,
          password: "a-very-good-password",
          displayName: name,
        })
      ).id;
    ownerId = await mk("owner");
    editorId = await mk("editor");
    viewerId = await mk("viewer");
    strangerId = await mk("stranger");

    const trip = await prisma.trip.create({
      data: {
        name: "P73access 行程",
        startDate: new Date("2026-12-01"),
        endDate: new Date("2026-12-10"),
        members: { create: [{ name: "團員" }] },
        memberships: {
          create: [
            { userId: ownerId, role: "OWNER" },
            { userId: editorId, role: "EDITOR" },
            { userId: viewerId, role: "VIEWER" },
          ],
        },
      },
      include: { members: true },
    });
    tripId = trip.id;
    memberId = trip.members[0].id;
    await prisma.tripMembership.updateMany({
      where: { tripId, userId: editorId },
      data: { memberId },
    });
  });

  afterAll(async () => {
    await purge();
  });

  it("未登入一律沒有權限", async () => {
    actAs(null);
    expect(await getTripAccess(tripId)).toBeNull();
    await expect(requireTripAccess(tripId)).rejects.toThrow();
  });

  it("不是這個行程的成員也沒有權限", async () => {
    actAs(strangerId);
    expect(await getTripAccess(tripId)).toBeNull();
    await expect(requireTripAccess(tripId, "VIEWER")).rejects.toThrow();
  });

  it("角色比較是「夠不夠」而不是「等不等於」", async () => {
    actAs(ownerId);
    // OWNER 滿足所有層級
    await expect(requireTripAccess(tripId, "VIEWER")).resolves.toBeTruthy();
    await expect(requireTripAccess(tripId, "EDITOR")).resolves.toBeTruthy();
    await expect(requireTripAccess(tripId, "OWNER")).resolves.toBeTruthy();

    actAs(editorId);
    await expect(requireTripAccess(tripId, "VIEWER")).resolves.toBeTruthy();
    await expect(requireTripAccess(tripId, "EDITOR")).resolves.toBeTruthy();
    // EDITOR 不能做 OWNER 的事——「被邀請者不能再邀請別人」就靠這條
    await expect(requireTripAccess(tripId, "OWNER")).rejects.toThrow();

    actAs(viewerId);
    await expect(requireTripAccess(tripId, "VIEWER")).resolves.toBeTruthy();
    await expect(requireTripAccess(tripId, "EDITOR")).rejects.toThrow();
    await expect(requireTripAccess(tripId, "OWNER")).rejects.toThrow();
  });

  it("回傳綁定的團員 id，沒認領身分時是 null", async () => {
    actAs(editorId);
    expect((await getTripAccess(tripId))?.memberId).toBe(memberId);
    actAs(ownerId);
    expect((await getTripAccess(tripId))?.memberId).toBeNull();
  });

  it("錯誤訊息不區分「行程不存在」與「你不是成員」", async () => {
    actAs(strangerId);
    const notMember = await requireTripAccess(tripId).catch((e: unknown) => e);
    const noSuchTrip = await requireTripAccess("nonexistent-trip-id").catch(
      (e: unknown) => e,
    );
    // 訊息一致，否則任何人可以拿 cuid 探測哪些行程存在
    expect((notMember as Error).message).toBe((noSuchTrip as Error).message);
    expect(isAccessDenied(notMember)).toBe(true);
    expect(isAccessDenied(noSuchTrip)).toBe(true);
  });

  it("isAccessDenied 只認得自己丟的那種錯誤", () => {
    expect(isAccessDenied(new Error("其他錯誤"))).toBe(false);
    expect(isAccessDenied(null)).toBe(false);
  });
});
