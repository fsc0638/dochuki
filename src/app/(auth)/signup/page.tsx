import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/SignupForm";
import { getCurrentUser } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if ((await getCurrentUser()) !== null) redirect(next ?? "/trips");

  return (
    <>
      <h2 className="text-lg font-medium text-ink">建立帳號</h2>
      <SignupForm next={next ?? "/trips"} />
    </>
  );
}
