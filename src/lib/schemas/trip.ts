import { z } from "zod";
import { zCuid, zCurrencyCode, zPositiveMoneyString } from "./common";

/**
 * 行程／成員／組別的表單輸入 schema。
 * CLAUDE.md 程式慣例：zod 是唯一資料驗證來源，API／Server Action 邊界全部過 zod。
 */

const zDateInput = z
  .string()
  .trim()
  .min(1, "請選擇日期")
  .refine((value) => !Number.isNaN(Date.parse(value)), "日期格式不正確");

/**
 * 固定匯率：一組幣別代碼與匯率字串，來自 FixedRatesEditor 元件的動態列。
 * 在 Server Action 這一層先組成陣列（見 lib/trips/write.ts），這裡驗證每一列。
 */
export const FixedRateRowSchema = z.object({
  currency: zCurrencyCode,
  rate: zPositiveMoneyString,
});
export type FixedRateRow = z.infer<typeof FixedRateRowSchema>;

export const TripFormSchema = z
  .object({
    name: z.string().trim().min(1, "請輸入行程名稱").max(100),
    startDate: zDateInput,
    endDate: zDateInput,
    homeCurrency: zCurrencyCode,
    fixedRates: z.array(FixedRateRowSchema).default([]),
  })
  .refine((data) => Date.parse(data.endDate) >= Date.parse(data.startDate), {
    message: "結束日期不可早於開始日期",
    path: ["endDate"],
  })
  .refine(
    (data) =>
      data.fixedRates.every((row) => row.currency !== data.homeCurrency),
    {
      message: "記帳幣本身不需要設定固定匯率",
      path: ["fixedRates"],
    },
  )
  .refine(
    (data) =>
      new Set(data.fixedRates.map((row) => row.currency)).size ===
      data.fixedRates.length,
    { message: "同一幣別不可重複設定匯率", path: ["fixedRates"] },
  );
export type TripFormInput = z.infer<typeof TripFormSchema>;

export const GroupFormSchema = z.object({
  tripId: zCuid,
  name: z.string().trim().min(1, "請輸入組別名稱").max(50),
});
export type GroupFormInput = z.infer<typeof GroupFormSchema>;

export const MemberFormSchema = z.object({
  tripId: zCuid,
  name: z.string().trim().min(1, "請輸入成員姓名").max(50),
  groupId: z.string().trim().min(1).nullable().default(null),
});
export type MemberFormInput = z.infer<typeof MemberFormSchema>;

/**
 * 從 <form> 的 FormData 組出 TripFormSchema 能解析的形狀。
 * FixedRatesEditor 用重複的 `fixedRates.currency` / `fixedRates.rate`
 * 欄位名渲染動態列，這裡依索引配對回陣列。
 */
export function parseTripFormData(formData: FormData): unknown {
  const currencies = formData.getAll("fixedRates.currency");
  const rates = formData.getAll("fixedRates.rate");
  const fixedRates = currencies
    .map((currency, index) => ({ currency, rate: rates[index] }))
    .filter(
      (row): row is { currency: string; rate: string } =>
        typeof row.currency === "string" &&
        row.currency.trim() !== "" &&
        typeof row.rate === "string" &&
        row.rate.trim() !== "",
    );

  return {
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    homeCurrency: formData.get("homeCurrency"),
    fixedRates,
  };
}

/** 空白列（新增列但未填值）在送出前先過濾掉，讓「刪除一列」等同不送出它 */
export function parseGroupFormData(formData: FormData): unknown {
  return { tripId: formData.get("tripId"), name: formData.get("name") };
}

export function parseMemberFormData(formData: FormData): unknown {
  const groupId = formData.get("groupId");
  return {
    tripId: formData.get("tripId"),
    name: formData.get("name"),
    groupId: typeof groupId === "string" && groupId !== "" ? groupId : null,
  };
}
