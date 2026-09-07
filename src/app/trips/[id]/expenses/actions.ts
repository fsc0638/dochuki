"use server";

import { guardAction } from "@/lib/auth/guard";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, toErrorMessage } from "@/lib/actionState";
import { ExpenseFormSchema, parseExpenseFormData } from "@/lib/schemas/expense";
import { createExpense, deleteExpense, updateExpense, type ReceiptContext } from "@/lib/trips/write";
import { loadReceipt, parseReceiptJson } from "@/lib/receipts/load";

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

  let receiptContext: ReceiptContext | undefined;
  if (receiptId !== null) {
    const receipt = await loadReceipt(parsed.data.tripId, receiptId);
    const parsedReceipt = receipt === null ? null : parseReceiptJson(receipt.parseJson);
    receiptContext = {
      receiptId,
      lineItems:
        parsedReceipt?.items.map((item) => ({
          nameRaw: item.name_raw,
          nameZh: item.name_zh,
          qty: item.qty,
          unitPrice: item.unit_price,
          amount: item.amount,
          taxRate: item.tax_rate,
          category: item.category,
        })) ?? [],
    };
  }

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
