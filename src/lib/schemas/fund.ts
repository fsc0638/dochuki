import { z } from "zod";
import { zCuid, zCurrencyCode, zPositiveMoneyString } from "./common";

export const FundFormSchema = z.object({
  tripId: zCuid,
  name: z.string().trim().min(1, "請輸入公費名稱").max(50),
  currency: zCurrencyCode,
});
export type FundFormInput = z.infer<typeof FundFormSchema>;

export function parseFundFormData(formData: FormData): unknown {
  return {
    tripId: formData.get("tripId"),
    name: formData.get("name"),
    currency: formData.get("currency"),
  };
}

export const FundContributionFormSchema = z.object({
  fundId: zCuid,
  memberId: zCuid,
  amount: zPositiveMoneyString,
  note: z.string().trim().max(100).optional(),
});
export type FundContributionFormInput = z.infer<typeof FundContributionFormSchema>;

export function parseFundContributionFormData(formData: FormData): unknown {
  const note = formData.get("note");
  return {
    fundId: formData.get("fundId"),
    memberId: formData.get("memberId"),
    amount: formData.get("amount"),
    note: typeof note === "string" && note.trim() !== "" ? note : undefined,
  };
}
