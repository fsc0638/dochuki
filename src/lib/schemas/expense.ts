import { z } from "zod";
import {
  zCuid,
  zCurrencyCode,
  zMoneyString,
  zNonNegativeMoneyString,
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

/**
 * WEIGHT 分攤模式的權重是「這一筆支出當下決定」，不是成員的固定屬性
 * （2026-09 使用者裁示改版：見 CLAUDE.md 進度日誌——同一人在不同支出裡
 * 該占多少比例本來就可能不同，不該綁在成員身上整趟旅程套用同一個值）。
 * 未指定的參與者由 split.ts 預設為權重 1。
 */
const WeightRowSchema = z.object({
  memberId: zCuid,
  weight: zNonNegativeMoneyString,
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
  /** 由公費支付：true 時幣別須等於行程公費幣別，寫入層會自動記一筆 SPEND FundEntry */
  fundSpend: z.boolean().default(false),
});

/**
 * 依 splitMode 判別聯集：
 *   EQUAL    → participantIds（至少 1 人，未指定則預設全員）
 *   WEIGHT   → participantIds ＋ weights（逐人權重，這一筆支出當下決定；
 *              未指定的參與者由 split.ts 預設權重 1）
 *   BY_GROUP → groupId（該組成員自動作為參與者，見 split.ts）
 *   EXACT    → exactShares（總和須等於換算後的 amountHome，於寫入層核對，
 *              因為 amountHome 是換算後才知道的值，zod 這層看不到）
 */
/**
 * 從 <form> 的 FormData 組出 ExpenseFormSchema 能解析的形狀。
 * `memberIds` 是行程全體成員 id，用來從 `exactShare.<memberId>` 這種
 * 逐人欄位重建 EXACT 模式的陣列——只收有填值的列，空白代表「這人不用付」。
 */
export function parseExpenseFormData(
  formData: FormData,
  memberIds: string[],
): unknown {
  const manualRate = formData.get("manualRate");
  const base = {
    tripId: formData.get("tripId"),
    description: formData.get("description"),
    category: formData.get("category"),
    paidAt: formData.get("paidAt"),
    currency: formData.get("currency"),
    amountOriginal: formData.get("amountOriginal"),
    payerId: formData.get("payerId"),
    manualRate:
      typeof manualRate === "string" && manualRate.trim() !== ""
        ? manualRate
        : undefined,
    // checkbox 未勾選時 FormData 裡完全不會有這個 key，不是 "false"
    fundSpend: formData.get("fundSpend") === "true",
  };

  const splitMode = formData.get("splitMode");
  switch (splitMode) {
    case "EQUAL":
      return {
        ...base,
        splitMode,
        participantIds: formData.getAll("participantIds"),
      };
    case "WEIGHT": {
      const participantIds = formData.getAll("participantIds");
      const weights = participantIds
        .filter((id): id is string => typeof id === "string")
        .map((memberId) => ({
          memberId,
          weight: formData.get(`weight.${memberId}`),
        }))
        .filter(
          (row): row is { memberId: string; weight: string } =>
            typeof row.weight === "string" && row.weight.trim() !== "",
        );
      return { ...base, splitMode, participantIds, weights };
    }
    case "BY_GROUP":
      return { ...base, splitMode, groupId: formData.get("groupId") };
    case "EXACT": {
      const exactShares = memberIds
        .map((memberId) => ({
          memberId,
          amount: formData.get(`exactShare.${memberId}`),
        }))
        .filter(
          (row): row is { memberId: string; amount: string } =>
            typeof row.amount === "string" && row.amount.trim() !== "",
        );
      return { ...base, splitMode, exactShares };
    }
    default:
      return { ...base, splitMode };
  }
}

export const ExpenseFormSchema = z.discriminatedUnion("splitMode", [
  BaseExpenseFieldsSchema.extend({
    splitMode: z.literal(SplitModeEnum.enum.EQUAL),
    participantIds: z.array(zCuid).min(1, "至少選擇一位參與者"),
  }),
  BaseExpenseFieldsSchema.extend({
    splitMode: z.literal(SplitModeEnum.enum.WEIGHT),
    participantIds: z.array(zCuid).min(1, "至少選擇一位參與者"),
    weights: z.array(WeightRowSchema).default([]),
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
