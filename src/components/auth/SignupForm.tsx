"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signupAction } from "@/app/(auth)/actions";
import { Field, inputClass } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { INITIAL_ACTION_STATE } from "@/lib/actionState";

export function SignupForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(signupAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <FormMessage error={state.error} />

      <Field label="電子郵件" htmlFor="signup-email" errors={state.fieldErrors?.email}>
        <input
          id="signup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoCapitalize="none"
          className={inputClass}
        />
      </Field>

      <Field
        label="顯示名稱"
        htmlFor="signup-name"
        errors={state.fieldErrors?.displayName}
      >
        <input
          id="signup-name"
          name="displayName"
          type="text"
          required
          autoComplete="name"
          className={inputClass}
        />
      </Field>

      <Field label="密碼" htmlFor="signup-password" errors={state.fieldErrors?.password}>
        <input
          id="signup-password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={inputClass}
        />
        <p className="text-xs text-ink-muted">至少 10 個字元</p>
      </Field>

      <Field
        label="再輸入一次密碼"
        htmlFor="signup-password-confirm"
        errors={state.fieldErrors?.passwordConfirm}
      >
        <input
          id="signup-password-confirm"
          name="passwordConfirm"
          type="password"
          required
          autoComplete="new-password"
          className={inputClass}
        />
      </Field>

      <SubmitButton pendingText="註冊中…">註冊</SubmitButton>

      <p className="text-center text-sm text-ink-soft">
        已經有帳號？{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="underline">
          登入
        </Link>
      </p>
    </form>
  );
}
