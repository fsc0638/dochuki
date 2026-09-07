import Link from "next/link";
import { AcceptInviteForm } from "@/components/auth/AcceptInviteForm";
import { getCurrentUser } from "@/lib/auth/current";
import { previewInvite } from "@/lib/auth/invites";
import { inviteProblemMessage } from "@/lib/auth/inviteMessages";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [result, current] = await Promise.all([previewInvite(token), getCurrentUser()]);

  if ("problem" in result) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-10">
        <h1 className="font-serif text-2xl text-stamp">道中記</h1>
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {inviteProblemMessage(result.problem)}
        </p>
        <Link href="/login" className="text-sm underline text-ink-soft">
          回登入頁
        </Link>
      </main>
    );
  }

  const { preview } = result;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-6 py-10">
      <h1 className="font-serif text-2xl text-stamp">道中記</h1>
      <div className="rounded-lg border border-washi bg-white p-4">
        <p className="text-sm text-ink-soft">你被邀請加入行程</p>
        <p className="mt-1 font-serif-tc text-xl font-bold text-ink">{preview.tripName}</p>
        <p className="mt-3 text-sm text-ink-soft">
          你的身分是 <span className="font-medium text-ink">{preview.memberName}</span>
          {preview.role === "VIEWER" && "（唯讀）"}
        </p>
      </div>

      {current !== null && (
        <p className="text-xs text-ink-muted">
          目前登入的是 {current.displayName}，接受後會用這個帳號加入。
        </p>
      )}

      <AcceptInviteForm token={token} memberName={preview.memberName} />

      <p className="text-xs text-ink-muted">
        這個連結等同於身分憑證，請不要轉發給別人。
      </p>
    </main>
  );
}
