import { LogoutButton } from "@/components/auth/LogoutButton";
import { getCurrentUser } from "@/lib/auth/current";

/**
 * 顯示目前登入者與登出按鈕。未登入時整條不顯示——登入頁自己就是入口，
 * 不需要再掛一列空的帳號資訊。
 */
export async function AccountBar() {
  const user = await getCurrentUser();
  if (user === null) return null;

  return (
    <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-6 pt-4 text-xs text-ink-muted">
      <span className="truncate">{user.displayName}</span>
      <LogoutButton />
    </div>
  );
}
