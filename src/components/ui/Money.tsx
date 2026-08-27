import { type DbDecimalLike, fromDb } from "@/lib/money/fromDb";
import { formatMoney } from "@/lib/money/round";

/**
 * 唯一能顯示金額的元件。CLAUDE.md 程式慣例：UI 層不得自行運算金額，
 * 一律傳 Decimal 或字串進來，取位與千分位由 round.ts 處理。
 *
 * 內部先過 fromDb() 正規化再顯示，呼叫端不必記得「讀出來的 Prisma Decimal
 * 要先正規化」——這裡是唯一入口，規則在此強制執行一次就好。
 */
export function Money({
  value,
  currency,
  className,
}: {
  value: DbDecimalLike;
  currency: string;
  className?: string;
}) {
  return (
    <span className={className}>
      {formatMoney(fromDb(value), currency)}
      <span className="ml-1 text-xs text-ink-muted">{currency}</span>
    </span>
  );
}
