import Link from "next/link";
import { guardPage } from "@/lib/auth/guard";
import { notFound } from "next/navigation";
import { InviteManager } from "@/components/trip/InviteManager";
import { MemberManager } from "@/components/trip/MemberManager";
import { getTripAccess } from "@/lib/auth/access";
import { listInvites } from "@/lib/auth/invites";
import { prisma } from "@/lib/db";
import { loadTrip } from "@/lib/trips/load";

// 依登入者角色決定顯示內容，不能被靜態化
export const dynamic = "force-dynamic";

export default async function TripMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await guardPage(id, "VIEWER");
  const trip = await loadTrip(id);
  if (trip === null) notFound();

  // P7.3 只先守住邀請這一區（發券等於授予權限，不能等 P7.4）。
  // 頁面本身的守門連同其餘 30 個進出口一起在 P7.4 處理。
  const access = await getTripAccess(id);
  const isOwner = access?.role === "OWNER";

  // 已經被認領的成員不需要再發券
  const claimed = isOwner
    ? new Set(
        (
          await prisma.tripMembership.findMany({
            where: { tripId: id, memberId: { not: null } },
            select: { memberId: true },
          })
        ).map((row) => row.memberId as string),
      )
    : new Set<string>();

  const invites = isOwner ? await listInvites(id) : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <div>
        <Link href={`/trips/${id}`} className="text-sm text-ink-soft">
          ← 回總覽
        </Link>
        <h1 className="mt-1 font-serif-tc text-2xl font-bold text-stamp">成員與組別</h1>
      </div>
      <MemberManager
        tripId={id}
        groups={trip.groups.map((group) => ({ id: group.id, name: group.name }))}
        members={trip.members.map((member) => ({
          id: member.id,
          name: member.name,
          groupId: member.groupId,
        }))}
      />
      {isOwner && (
        <InviteManager
          tripId={id}
          invitableMembers={trip.members
            .filter((member) => !claimed.has(member.id))
            .map((member) => ({ id: member.id, name: member.name }))}
          invites={invites.map((invite) => ({
            id: invite.id,
            memberName: invite.memberName,
            role: invite.role,
            expiresAt: invite.expiresAt.toISOString(),
            maxUses: invite.maxUses,
            usedCount: invite.usedCount,
            revoked: invite.revokedAt !== null,
            active: invite.active,
          }))}
        />
      )}
    </main>
  );
}
