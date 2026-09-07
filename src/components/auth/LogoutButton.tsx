"use client";

import { logoutAction } from "@/app/(auth)/actions";
import { clearOutbox } from "@/lib/offline/outbox";

/**
 * 登出按鈕。送出前先清掉本機的離線待送佇列（P7.4）。
 *
 * 為什麼要在 client 端做：IndexedDB 只存在於瀏覽器，Server Action 碰不到。
 * 為什麼一定要做：佇列是**依裝置**存的、不隨帳號切換，共用裝置上前一個人
 * 未送出的支出若留著，下一個人登入後同步就會用他的身分送出那些帳——
 * 記到錯的人頭上。
 *
 * 清除失敗也照樣登出：把人留在已登入狀態更糟。
 */
export function LogoutButton() {
  return (
    <form
      action={logoutAction}
      onSubmit={() => {
        void clearOutbox().catch(() => undefined);
      }}
    >
      <button type="submit" className="shrink-0 underline hover:text-ink-soft">
        登出
      </button>
    </form>
  );
}
