import type Decimal from "decimal.js";
import { MONEY_SCALE, Money, type MoneyInput } from "./decimal";

/**
 * 各幣別的顯示小數位數。
 * CLAUDE.md 金額鐵律 3：JPY 取整數、TWD 顯示四捨五入至整數。
 */
const DISPLAY_SCALE: Readonly<Record<string, number>> = {
  JPY: 0,
  TWD: 0,
  KRW: 0,
};

/** 未登記幣別的預設顯示位數（USD/EUR 等大多為 2 位） */
const DEFAULT_DISPLAY_SCALE = 2;

/** 取某幣別的顯示小數位數 */
export function displayScale(currency: string): number {
  return DISPLAY_SCALE[currency.toUpperCase()] ?? DEFAULT_DISPLAY_SCALE;
}

/**
 * 顯示用四捨五入（ROUND_HALF_UP）。
 * UI 與報表一律走此函式，不得自行 toFixed 或 Math.round。
 */
export function roundForDisplay(amount: MoneyInput, currency: string): Decimal {
  return new Money(amount).toDecimalPlaces(
    displayScale(currency),
    Money.ROUND_HALF_UP,
  );
}

/** 顯示字串：依幣別取位後加千分位 */
export function formatMoney(amount: MoneyInput, currency: string): string {
  const scale = displayScale(currency);
  const fixed = roundForDisplay(amount, currency).toFixed(scale);
  const negative = fixed.startsWith("-");
  const [integerPart, fractionPart] = (
    negative ? fixed.slice(1) : fixed
  ).split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (
    (negative ? "-" : "") + grouped + (fractionPart ? `.${fractionPart}` : "")
  );
}

/**
 * 收斂到指定小數位數（ROUND_HALF_UP）。
 * schema 有三種精度（金額 6、匯率 8、係數 4），故位數必須由呼叫端明確指定。
 */
export function quantize(value: MoneyInput, scale: number): Decimal {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new Error(`小數位數必須為非負整數，收到 ${String(scale)}`);
  }
  return new Money(value).toDecimalPlaces(scale, Money.ROUND_HALF_UP);
}

/**
 * 落地用：收斂到 MONEY_SCALE 位小數（ROUND_HALF_UP）。
 * 任何要寫進 DB 的金額都必須經過這裡，確保與 Decimal(18,6) 欄位精度一致。
 */
export function toStorageScale(amount: MoneyInput): Decimal {
  return quantize(amount, MONEY_SCALE);
}
