"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, toErrorMessage } from "@/lib/actionState";
import { getCurrentUser } from "@/lib/auth/current";
import { guardAction } from "@/lib/auth/guard";
import { parseTripFormData, TripFormSchema } from "@/lib/schemas/trip";
import { createTrip, updateTrip } from "@/lib/trips/write";

export async function createTripAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = TripFormSchema.safeParse(parseTripFormData(formData));
  if (!parsed.success) {
    return {
      error: "請檢查輸入內容",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // 建立行程只要「有登入」；建立者當場成為 OWNER
  const user = await getCurrentUser();
  if (user === null) return { error: "請先登入" };

  let tripId: string;
  try {
    tripId = (await createTrip(parsed.data, user.id)).id;
  } catch (error) {
    return { error: toErrorMessage(error) };
  }

  revalidatePath("/trips");
  redirect(`/trips/${tripId}`);
}

export async function updateTripAction(
  tripId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = TripFormSchema.safeParse(parseTripFormData(formData));
  if (!parsed.success) {
    return {
      error: "請檢查輸入內容",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // 改行程設定（含固定匯率）是 OWNER 的權限
  const guard = await guardAction(tripId, "OWNER");
  if (!guard.ok) return { error: guard.message };

  try {
    await updateTrip(tripId, parsed.data);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/settings`);
  redirect(`/trips/${tripId}`);
}
