"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/app/(auth)/actions";
import { Field, inputClass } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { INITIAL_ACTION_STATE } from "@/lib/actionState";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(loginAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <FormMessage error={state.error} />

      <Field label="電子郵件" htmlFor="login-email" errors={state.fieldErrors?.email}>
        <input
          id="login-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          // 手機鍵盤不要自動把第一個字母變大寫，email 全小寫
          autoCapitalize="none"
          className={inputClass}
        />
      </Field>

      <Field label="密碼" htmlFor="login-password" errors={state.fieldErrors?.password}>
        <input
          id="login-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </Field>

      <SubmitButton pendingText="登入中…">登入</SubmitButton>

      <p className="text-center text-sm text-ink-soft">
        還沒有帳號？{" "}
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="underline">
          註冊
        </Link>
      </p>
    </form>
  );
}
