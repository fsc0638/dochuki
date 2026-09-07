"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { toErrorMessage, type ActionState } from "@/lib/actionState";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/lib/auth/cookies";
import { createSession, revokeSession } from "@/lib/auth/session";
import { authenticate, createPasswordUser } from "@/lib/auth/users";
import { safeNext } from "@/lib/auth/redirect";
import { LoginSchema, SignupSchema } from "@/lib/schemas/auth";

async function userAgent(): Promise<string | undefined> {
  return (await headers()).get("user-agent") ?? undefined;
}

export async function loginAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      error: "請檢查輸入內容",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const result = await authenticate(parsed.data.email, parsed.data.password);
  if ("failure" in result) {
    // 兩種失敗都不透露「這個 email 有沒有註冊」；但鎖定要說出來，
    // 否則使用者只會一直重試，反而把鎖定時間越拖越長
    return {
      error:
        result.failure === "locked"
          ? "登入嘗試次數過多，請稍後再試"
          : "電子郵件或密碼錯誤",
    };
  }

  const { token } = await createSession(result.user.id, await userAgent());
  await setSessionCookie(token);
  redirect(safeNext(formData.get("next")));
}

export async function signupAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = SignupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) {
    return {
      error: "請檢查輸入內容",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  if (formData.get("password") !== formData.get("passwordConfirm")) {
    return { error: "兩次輸入的密碼不一致", fieldErrors: { passwordConfirm: ["兩次輸入的密碼不一致"] } };
  }

  let userId: string;
  try {
    const user = await createPasswordUser(parsed.data);
    userId = user.id;
  } catch (error) {
    return { error: toErrorMessage(error) };
  }

  // 註冊完直接登入，不用再輸入一次
  const { token } = await createSession(userId, await userAgent());
  await setSessionCookie(token);
  redirect(safeNext(formData.get("next")));
}

/**
 * 登出。回傳型別是 void 而不是 ActionState——它是直接掛在 `<form action=>`
 * 上的，不經過 useActionState，React 對這種表單 action 的型別要求就是
 * `(formData: FormData) => void | Promise<void>`。
 *
 * 這裡不只清 cookie，也把 session 從資料庫砍掉。只清 cookie 的話那組 token
 * 仍然有效，任何側錄到它的人（共用電腦的瀏覽器紀錄、代理伺服器日誌）
 * 在到期前都還能拿來冒用。
 */
export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token !== null) {
    await revokeSession(token);
  }
  await clearSessionCookie();
  redirect("/login");
}
