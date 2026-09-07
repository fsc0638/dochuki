import type { InviteProblem } from "@/lib/auth/invites";

/**
 * 把邀請券的問題代碼翻成使用者看得懂的說明。
 *
 * 放在 lib 而不是跟 action 同檔：`"use server"` 檔案的**所有匯出都必須是
 * async 函式**，混一個同步的純函式進去，整個模組會在編譯期就失敗
 * （Server Actions must be async functions）。
 */
export function inviteProblemMessage(problem: InviteProblem): string {
  switch (problem) {
    case "not-found":
      return "這個邀請連結無效，請向邀請你的人索取新的連結";
    case "revoked":
      return "這張邀請已被撤銷，請向邀請你的人索取新的連結";
    case "expired":
      return "這張邀請已經過期，請向邀請你的人索取新的連結";
    case "exhausted":
      return "這張邀請的使用次數已用完，請向邀請你的人索取新的連結";
    case "member-taken":
      return "這個身分已經有人認領了。如果那不是你，請聯絡邀請你的人";
  }
}
