"use server";

import { guardAction } from "@/lib/auth/guard";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, toErrorMessage } from "@/lib/actionState";
import { ExpenseFormSchema, parseExpenseFormData } from "@/lib/schemas/expense";
import { createExpense, deleteExpense, updateExpense, type ReceiptContext } from "@/lib/trips/write";

function flattenFieldErrors(
  fieldErrors: Record<string, string[] | undefined>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * 建立支出。`receiptId` 非 null 時（來自拍照解析流程）：從資料庫重新讀取
 * Receipt.parseJson 取得品項——不信任表單傳回來的任何品項資料，因為
 * ExpenseForm 本來就沒有讓使用者編輯品項的欄位，唯一的事實來源是伺服器
 * 端存的 Receipt。
 */
export async function createExpenseAction(
  memberIds: string[],
  receiptId: string | null,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = ExpenseFormSchema.safeParse(
    parseExpenseFormData(formData, memberIds),
  );
  if (!parsed.success) {
    return {
      error: "請檢查輸入內容",
      fieldErrors: flattenFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }

  // tripId 來自表單，所以守門必須排在 zod 驗證之後——驗證前拿到的是未經
  // 檢查的字串。驗證只保證格式，權限仍然要問
  const guard = await guardAction(parsed.data.tripId, "EDITOR");
  if (!guard.ok) return { error: guard.message };

  // P8：品項不再從 Receipt.parseJson 重讀。使用者在確認頁可以逐筆修改，
  // 重讀等於把他的修正丟掉——表單才是真相來源（見 schemas/expense.ts 的
  // LineItemRowSchema 說明，以及那裡對「為什麼這樣安全」的論證）。
  // 這裡只剩把收據綁回這筆支出。
  const receiptContext: ReceiptContext | undefined =
    receiptId !== null ? { receiptId } : undefined;

  try {
    await createExpense(parsed.data, receiptContext);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }

  revalidatePath(`/trips/${parsed.data.tripId}`);
  redirect(`/trips/${parsed.data.tripId}`);
}

export async function updateExpenseAction(
  expenseId: string,
  memberIds: string[],
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = ExpenseFormSchema.safeParse(
    parseExpenseFormData(formData, memberIds),
  );
  if (!parsed.success) {
    return {
      error: "請檢查輸入內容",
      fieldErrors: flattenFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }

  // tripId 來自表單，所以守門必須排在 zod 驗證之後——驗證前拿到的是未經
  // 檢查的字串。驗證只保證格式，權限仍然要問
  const guard = await guardAction(parsed.data.tripId, "EDITOR");
  if (!guard.ok) return { error: guard.message };

  try {
    await updateExpense(expenseId, parsed.data);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }

  revalidatePath(`/trips/${parsed.data.tripId}`);
  redirect(`/trips/${parsed.data.tripId}`);
}

export async function deleteExpenseAction(
  tripId: string,
  expenseId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const guard = await guardAction(tripId, "EDITOR");
  if (!guard.ok) return { error: guard.message };

  try {
    await deleteExpense(tripId, expenseId);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  revalidatePath(`/trips/${tripId}`);
  redirect(`/trips/${tripId}`);
}
