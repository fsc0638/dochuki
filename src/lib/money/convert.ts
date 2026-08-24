import type Decimal from "decimal.js";
import { Money, type MoneyInput } from "./decimal";
import { toStorageScale } from "./round";

/** 匯率來源，對應 schema 的 RateSource enum */
export type RateSource = "TRIP_FIXED" | "DAILY_REF" | "MANUAL";

export interface RateResolution {
  /** 匯率語意：1 單位原幣 兌 rate 單位記帳幣（CLAUDE.md 鐵律 5） */
  rate: Decimal;
  source: RateSource;
}

export interface ResolveRateArgs {
  currency: string;
  homeCurrency: string;
  /** 行程固定匯率，例 `{"JPY": "0.25"}` */
  tripFixedRates?: Record<string, string> | null;
  /** 該筆手動輸入的匯率 */
  manualRate?: MoneyInput | null;
  /** 由 fx_rates 快取或 Frankfurter 取得的參考匯率 */
  dailyRefRate?: MoneyInput | null;
}

function assertPositiveRate(value: MoneyInput): Decimal {
  const rate = new Money(value);
  if (!rate.isFinite() || rate.lessThanOrEqualTo(0)) {
    throw new Error(`匯率必須為正的有限數，收到 ${String(value)}`);
  }
  return rate;
}

/**
 * 依 docs/IMPLEMENTATION.md §6 的優先序決定匯率：
 * TRIP_FIXED（行程固定）→ MANUAL（該筆手動）→ DAILY_REF（參考匯率快取）。
 *
 * 原幣即記帳幣時匯率恆為 1，來源記為 TRIP_FIXED（行程層級的既定事實）。
 */
export function resolveRate(args: ResolveRateArgs): RateResolution {
  const currency = args.currency.toUpperCase();
  const homeCurrency = args.homeCurrency.toUpperCase();

  if (currency === homeCurrency) {
    return { rate: new Money(1), source: "TRIP_FIXED" };
  }

  const fixed = args.tripFixedRates?.[currency];
  if (fixed != null) {
    return { rate: assertPositiveRate(fixed), source: "TRIP_FIXED" };
  }
  if (args.manualRate != null) {
    return { rate: assertPositiveRate(args.manualRate), source: "MANUAL" };
  }
  if (args.dailyRefRate != null) {
    return { rate: assertPositiveRate(args.dailyRefRate), source: "DAILY_REF" };
  }

  throw new Error(
    `找不到 ${currency} → ${homeCurrency} 的匯率：行程固定匯率、手動輸入、參考匯率三者皆缺`,
  );
}

/**
 * 原幣 → 記帳幣。
 *
 * 刻意設計成純函式：只吃傳入的 rate，不讀行程設定、不讀當下時間、不查 DB。
 * 這是 CLAUDE.md 鐵律 2「rateUsed 是入帳當下的快照，事後改匯率設定不得回溯
 * 改動既有資料」的實作保證——呼叫端負責把當下決定的 rate 一併存進
 * `expense.rateUsed`，之後任何重算都拿該快照值，不會重新解析匯率。
 */
export function convertToHome(args: {
  amountOriginal: MoneyInput;
  rate: MoneyInput;
}): Decimal {
  const amount = new Money(args.amountOriginal);
  if (!amount.isFinite()) {
    throw new Error(`金額必須為有限數，收到 ${String(args.amountOriginal)}`);
  }
  const rate = assertPositiveRate(args.rate);
  return toStorageScale(amount.times(rate));
}
