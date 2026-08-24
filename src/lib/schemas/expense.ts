import { z } from "zod";
import {
  zCuid,
  zCurrencyCode,
  zMoneyString,
  zPositiveMoneyString,
} from "./common";

/**
 * 支出表單輸入 schema。
 *
 * 匯率不在此表單直接選「來源」——來源由 src/lib/money/convert.ts 的
 * resolveRate() 依 IMPLEMENTATION.md §6 優先序自動決定
 * （TRIP_FIXED → MANUAL → DAILY_REF）。表單只需要在【原幣≠記帳幣、且行程無
 * 該幣別固定匯率】時，可選填 manualRate；留空則由伺服器端向 Frankfurter
 * 取參考匯率。
 */

const SplitModeEnum = z.enum(["EQUAL", "WEIGHT", "EXACT", "BY_GROUP"]);
export type SplitModeInput = z.infer<typeof SplitModeEnum>;

const zDateTimeInput = z
  .string()
  .trim()
  .min(1, "請選擇日期時間")
  .refine((value) => !Number.isNaN(Date.parse(value)), "日期時間格式不正確");

const ExactShareRowSchema = z.object({
  memberId: zCuid,
  amount: zMoneyString,
});

const BaseExpenseFieldsSchema = z.object({
  tripId: zCuid,
  description: z.string().trim().min(1, "請輸入項目說明").max(200),
  category: z.string().trim().min(1, "請選擇分類").max(50),
  paidAt: zDateTimeInput,
  currency: zCurrencyCode,
  amountOriginal: zPositiveMoneyString,
  payerId: zCuid,
  manualRate: zPositiveMoneyString.optional(),
});

/**
 * 依 splitMode 判別聯集：
 *   EQUAL / WEIGHT  → participantIds（至少 1 人，未指定則預設全員）
 *   BY_GROUP        → groupId（該組成員自動作為參與者，見 split.ts）
 *   EXACT           → exactShares（總和須等於換算後的 amountHome，於寫入層核對，
 *                      因為 amountHome 是換算後才知道的值，zod 這層看不到）
 */
export const ExpenseFormSchema = z.discriminatedUnion("splitMode", [
  BaseExpenseFieldsSchema.extend({
    splitMode: z.literal(SplitModeEnum.enum.EQUAL),
    participantIds: z.array(zCuid).min(1, "至少選擇一位參與者"),
  }),
  BaseExpenseFieldsSchema.extend({
    splitMode: z.literal(SplitModeEnum.enum.WEIGHT),
    participantIds: z.array(zCuid).min(1, "至少選擇一位參與者"),
  }),
  BaseExpenseFieldsSchema.extend({
    splitMode: z.literal(SplitModeEnum.enum.BY_GROUP),
    groupId: zCuid,
  }),
  BaseExpenseFieldsSchema.extend({
    splitMode: z.literal(SplitModeEnum.enum.EXACT),
    exactShares: z.array(ExactShareRowSchema).min(1, "至少指定一位成員的金額"),
  }),
]);
export type ExpenseFormInput = z.infer<typeof ExpenseFormSchema>;
