import type Decimal from "decimal.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Money } from "@/lib/money/decimal";
import { fromDb, toDbRate } from "@/lib/money/fromDb";

/**
 * 參考匯率（DAILY_REF）：查 fx_rates 快取，miss 則打 Frankfurter API 後寫入快取。
 * 依 docs/IMPLEMENTATION.md §6。
 *
 * 三個實測發現（2026-08-24，直接打 api.frankfurter.dev 驗證，見 CLAUDE.md 進度日誌）
 * 決定了以下設計，不是隨意選擇：
 *
 * 1. 端點是 `/v2/rates?base=&quotes=&date=`，回應是**陣列**，`rate` 是 JSON number。
 * 2. 假日／非交易日請求會**靜默回退**到前一個交易日，且回應的 `date` 是那個交易日、
 *    不是你問的日期。快取鍵因此必須用【請求日期】，不能用回應的 `date`——否則週末
 *    查詢會永遠 cache miss、每次都重打 API。
 * 3. 同一個請求日期，經不同路徑取得的 rate **不保證一致**（同一天直接問與經隔天回退
 *    問到的值不同，見稽核記錄）。API 非幂等，故「問過一次就必須快取死」，事後同一筆
 *    支出的 rateUsed 不會因為重新整理頁面而跳動。
 *
 * 呼叫端注意：本函式只在 TRIP_FIXED 與 MANUAL 都不可用時才該被呼叫（避免不必要的
 * 外部請求），這個判斷屬於 src/lib/trips/write.ts 的職責，不在這裡做。
 */

const FX_API_BASE_DEFAULT = "https://api.frankfurter.dev";

const FrankfurterResponseSchema = z.array(
  z.object({
    date: z.string(),
    base: z.string(),
    quote: z.string(),
    rate: z.number().finite(),
  }),
);

export interface DailyRateResult {
  rate: Decimal;
  source: "cache" | "api";
}

export interface GetDailyRateArgs {
  base: string;
  quote: string;
  /** 請求日期，YYYY-MM-DD（例如支出的 paidAt 當天）；同時是快取鍵 */
  date: string;
  /** 測試用：覆寫 API base，預設讀 FX_API_BASE 環境變數 */
  apiBase?: string;
}

/** 把 YYYY-MM-DD 轉成 UTC 午夜時間戳，避免時區把日期推到前一天或後一天 */
function toUtcMidnight(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

/**
 * 取得參考匯率。呼叫端不需自行判斷快取或呼叫 API，本函式內部處理。
 *
 * 回傳 null 代表無法取得（快取沒有、API 也失敗或查無資料）——呼叫端應
 * 降級為要求使用者手動輸入匯率，不得因此擋住入帳（§6 精神）。
 */
export async function getDailyRate(
  args: GetDailyRateArgs,
): Promise<DailyRateResult | null> {
  const base = args.base.toUpperCase();
  const quote = args.quote.toUpperCase();
  const cacheKey = toUtcMidnight(args.date);

  const cached = await prisma.fxRate.findUnique({
    where: { date_base_quote: { date: cacheKey, base, quote } },
  });
  if (cached !== null) {
    return { rate: fromDb(cached.rate), source: "cache" };
  }

  const apiBase = args.apiBase ?? process.env.FX_API_BASE ?? FX_API_BASE_DEFAULT;
  const url = `${apiBase}/v2/rates?base=${encodeURIComponent(base)}&quotes=${encodeURIComponent(quote)}&date=${encodeURIComponent(args.date)}`;

  let payload: unknown;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    // 網路錯誤、逾時、DNS 失敗等——一律視為「取不到」，不拋出，交呼叫端降級
    return null;
  }

  const parsed = FrankfurterResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.length === 0) return null;

  const entry = parsed.data.find((row) => row.quote.toUpperCase() === quote);
  if (entry === undefined) return null;

  // 刻意不走 fromDb()：fromDb 的「非整數 number 一律拒絕」規則是針對本專案
  // 自己的 DB 邊界（讀到浮點數代表某處繞過了寫入層、可能已被污染）。這裡是
  // 剛從外部 JSON 解析出來的字面值，還沒有經過任何浮點運算，decimal.js 的
  // number 建構子會取其最短可還原十進位表示（例如 0.20034 → "0.20034"，
  // 已用 node -e 實測確認），直接轉換是安全的；當初若硬套 fromDb 反而會擋下
  // 這個合法情境（見 2026-08-24 測試踩雷紀錄）。
  const rate = new Money(entry.rate);

  // 以【請求日期】存快取，不是回應裡的 date（見上方發現 2）
  await prisma.fxRate.upsert({
    where: { date_base_quote: { date: cacheKey, base, quote } },
    create: {
      date: cacheKey,
      base,
      quote,
      rate: toDbRate(rate),
      source: "frankfurter",
    },
    // 已存在代表兩個並發請求都 cache miss，內容應相同，直接覆蓋即可
    update: { rate: toDbRate(rate), source: "frankfurter" },
  });

  return { rate, source: "api" };
}
