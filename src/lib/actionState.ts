/** Server Action 回傳給 useActionState 的統一形狀 */
export interface ActionState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

export const INITIAL_ACTION_STATE: ActionState = {};

/** 把非預期例外轉成使用者看得懂的訊息，不外洩堆疊細節 */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "發生未預期的錯誤，請稍後再試";
}
