import Link from "next/link";
import { TripForm } from "@/components/trip/TripForm";
import { createTripAction } from "@/app/trips/actions";

export default function NewTripPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <div>
        <Link href="/trips" className="text-sm text-ink-soft">
          ← 行程列表
        </Link>
        <h1 className="mt-1 font-serif-tc text-2xl font-bold text-stamp">建立行程</h1>
      </div>
      <TripForm action={createTripAction} submitLabel="建立行程" />
    </main>
  );
}
