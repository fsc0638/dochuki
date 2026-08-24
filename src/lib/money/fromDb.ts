import type Decimal from "decimal.js";
import {
  FACTOR_SCALE,
  MONEY_SCALE,
  Money,
  RATE_SCALE,
  type MoneyInput,
} from "./decimal";
import { quantize } from "./round";

/**
 * 資料庫邊界的金額轉換。
 *
 * 為什麼需要這一層：Prisma 從 Decimal 欄位讀回的是它自己的 decimal.js 實例
 * （precision 20），與本專案的 Money（precision 40）是不同的建構子。直接在
 * Prisma 回傳的實例上做運算，會落在「它的」設定上而非我們的：
 *
 *   Prisma 實例 ÷3 → 20818.416666666666667
 *   Money  實例 ÷3 → 20818.41666666666666666666666666666666667
 *
 * 兩者捨入模式雖同為 HALF_UP，但有效位數不同，長運算鏈會分歧。故讀取一律先
 * 經 fromDb() 正規化、寫入一律經 toDbAmount()／toDbRate()／toDbFactor()。
 *
 * 本模組刻意不匯入任何 Prisma 型別——參數型別只要求結構上有 toString()，
 * 讓 src/lib/money/ 保持與資料層解耦。
 */

/** 任何能無損轉成十進位字串的載體：Prisma 的 Decimal、字串、安全整數 */
export type DbDecimalLike = string | number | { toString(): string };

function textOf(value: DbDecimalLike): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    // 非整數 number 在到達這裡之前就可能已經失真，不能當金額來源（鐵律 1）
    if (!Number.isInteger(value)) {
      throw new Error(
        `金額不得以非整數 number 表示（可能已失真），收到 ${String(value)}；請改用字串或 Decimal`,
      );
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error(`整數 ${String(value)} 超出安全範圍，請改用字串`);
    }
    return String(value);
  }
  return value.toString();
}

/**
 * 把 DB 讀回的值正規化為本專案設定的 Decimal。
 * 讀取路徑上任何要參與運算的金額都必須先過這裡。
 */
export function fromDb(value: DbDecimalLike): Decimal {
  const text = textOf(value);
  let result: Decimal;
  try {
    result = new Money(text);
  } catch {
    throw new Error(`無法解析為十進位數值：${text}`);
  }
  if (!result.isFinite()) {
    throw new Error(`金額必須為有限數，收到 ${text}`);
  }
  return result;
}

/** 可為 null 的欄位（如 LineItem.taxRate、Expense.payerId 相關金額） */
export function fromDbOrNull(
  value: DbDecimalLike | null | undefined,
): Decimal | null {
  if (value === null || value === undefined) return null;
  return fromDb(value);
}

/**
 * 寫入金額欄位（`Decimal(18,6)`）。
 * 明確收斂到 6 位，不把捨入交給 PostgreSQL 隱式處理。
 */
export function toDbAmount(value: MoneyInput): string {
  return quantize(value, MONEY_SCALE).toFixed(MONEY_SCALE);
}

/** 寫入匯率欄位（`Decimal(18,8)`） */
export function toDbRate(value: MoneyInput): string {
  return quantize(value, RATE_SCALE).toFixed(RATE_SCALE);
}

/** 寫入係數欄位（`Decimal(8,4)` / `Decimal(12,4)` / `Decimal(6,4)`） */
export function toDbFactor(value: MoneyInput): string {
  return quantize(value, FACTOR_SCALE).toFixed(FACTOR_SCALE);
}
