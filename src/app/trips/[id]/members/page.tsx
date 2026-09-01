import Link from "next/link";
import { notFound } from "next/navigation";
import { MemberManager } from "@/components/trip/MemberManager";
import { loadTrip } from "@/lib/trips/load";

export default async function TripMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trip = await loadTrip(id);
  if (trip === null) notFound();

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
    </main>
  );
}
