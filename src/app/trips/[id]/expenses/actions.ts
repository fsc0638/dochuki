"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, toErrorMessage } from "@/lib/actionState";
import { ExpenseFormSchema, parseExpenseFormData } from "@/lib/schemas/expense";
import { createExpense, deleteExpense, updateExpense } from "@/lib/trips/write";

function flattenFieldErrors(
  fieldErrors: Record<string, string[] | undefined>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export async function createExpenseAction(
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

  try {
    await createExpense(parsed.data);
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
  try {
    await deleteExpense(expenseId);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  revalidatePath(`/trips/${tripId}`);
  redirect(`/trips/${tripId}`);
}
