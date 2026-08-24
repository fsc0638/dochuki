"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, toErrorMessage } from "@/lib/actionState";
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

  let tripId: string;
  try {
    tripId = (await createTrip(parsed.data)).id;
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

  try {
    await updateTrip(tripId, parsed.data);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/settings`);
  redirect(`/trips/${tripId}`);
}
