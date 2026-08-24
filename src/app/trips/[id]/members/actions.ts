"use server";

import { revalidatePath } from "next/cache";
import { type ActionState, toErrorMessage } from "@/lib/actionState";
import {
  GroupFormSchema,
  MemberFormSchema,
  parseGroupFormData,
  parseMemberFormData,
} from "@/lib/schemas/trip";
import {
  createGroup,
  createMember,
  deleteGroup,
  deleteMember,
  updateMember,
} from "@/lib/trips/write";

export async function createGroupAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = GroupFormSchema.safeParse(parseGroupFormData(formData));
  if (!parsed.success) {
    return {
      error: "請檢查輸入內容",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await createGroup(parsed.data);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  revalidatePath(`/trips/${parsed.data.tripId}/members`);
  return {};
}

export async function deleteGroupAction(
  tripId: string,
  groupId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    await deleteGroup(groupId);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  revalidatePath(`/trips/${tripId}/members`);
  return {};
}

export async function createMemberAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = MemberFormSchema.safeParse(parseMemberFormData(formData));
  if (!parsed.success) {
    return {
      error: "請檢查輸入內容",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await createMember(parsed.data);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  revalidatePath(`/trips/${parsed.data.tripId}/members`);
  return {};
}

export async function updateMemberAction(
  memberId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = MemberFormSchema.safeParse(parseMemberFormData(formData));
  if (!parsed.success) {
    return {
      error: "請檢查輸入內容",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await updateMember(memberId, parsed.data);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  revalidatePath(`/trips/${parsed.data.tripId}/members`);
  return {};
}

export async function deleteMemberAction(
  tripId: string,
  memberId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    await deleteMember(memberId);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  revalidatePath(`/trips/${tripId}/members`);
  return {};
}
