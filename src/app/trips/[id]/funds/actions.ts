"use server";

import { guardAction } from "@/lib/auth/guard";
import { revalidatePath } from "next/cache";
import { type ActionState, toErrorMessage } from "@/lib/actionState";
import {
  FundContributionFormSchema,
  FundFormSchema,
  parseFundContributionFormData,
  parseFundFormData,
} from "@/lib/schemas/fund";
import {
  createFund,
  createFundContribution,
  deleteFundContribution,
} from "@/lib/trips/write";

export async function createFundAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = FundFormSchema.safeParse(parseFundFormData(formData));
  if (!parsed.success) {
    return {
      error: "請檢查輸入內容",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // tripId 來自表單，守門排在驗證之後
  const guard = await guardAction(parsed.data.tripId, "OWNER");
  if (!guard.ok) return { error: guard.message };
  try {
    await createFund(parsed.data);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  revalidatePath(`/trips/${parsed.data.tripId}/funds`);
  return {};
}

export async function createFundContributionAction(
  tripId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardAction(tripId, "EDITOR");
  if (!guard.ok) return { error: guard.message };

  const parsed = FundContributionFormSchema.safeParse(parseFundContributionFormData(formData));
  if (!parsed.success) {
    return {
      error: "請檢查輸入內容",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await createFundContribution({ ...parsed.data, tripId });
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  revalidatePath(`/trips/${tripId}/funds`);
  return {};
}

export async function deleteFundContributionAction(
  tripId: string,
  entryId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const guard = await guardAction(tripId, "EDITOR");
  if (!guard.ok) return { error: guard.message };

  try {
    await deleteFundContribution(tripId, entryId);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  revalidatePath(`/trips/${tripId}/funds`);
  return {};
}
