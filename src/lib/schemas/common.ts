import { z } from "zod";
import { Money } from "@/lib/money/decimal";

/**
 * 金額字串的 zod schema。
 *
 * 只驗證「能被 Money 無損解析成有限數」，不在這裡限制正負或位數——
 * 那些是欄位語意（例如金額必須為正、匯率必須為正），由呼叫端疊加額外規則。
 * 落地精度由 src/lib/money/fromDb.ts 的 toDbAmount/toDbRate/toDbFactor 決定，
 * 不在 zod 這一層先行捨入。
 */
export const zMoneyString = z
  .string()
  .trim()
  .min(1, "請輸入金額")
  .refine((value) => {
    try {
      return new Money(value).isFinite();
    } catch {
      return false;
    }
  }, "請輸入有效的數字");

export const zPositiveMoneyString = zMoneyString.refine(
  (value) => new Money(value).isPositive(),
  "金額必須大於 0",
);

export const zNonNegativeMoneyString = zMoneyString.refine(
  (value) => !new Money(value).isNegative(),
  "不可為負數",
);

/** ISO 4217 幣別代碼：三個英文字母，統一轉大寫 */
export const zCurrencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "幣別代碼須為 3 個英文字母（如 JPY、TWD）");

/** cuid：Prisma 各 model 的 id 格式 */
export const zCuid = z.string().min(1, "缺少必要的識別碼");
