import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { getCurrentUser } from "@/lib/auth/current";

// cookie 會影響輸出，不能被靜態化
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // 已經登入就不要再看到登入頁
  if ((await getCurrentUser()) !== null) redirect(next ?? "/trips");

  return (
    <>
      <h2 className="text-lg font-medium text-ink">登入</h2>
      <LoginForm next={next ?? "/trips"} />
    </>
  );
}
