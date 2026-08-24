import Decimal from "decimal.js";

/**
 * 全專案唯一的 Decimal 設定入口。
 *
 * 各模組一律 `import { Money } from "./decimal"`，不要在別處呼叫 `Decimal.set()`
 * ——那會改動 decimal.js 的全域狀態，造成「哪個模組先被載入就贏」的隱性耦合。
 * 這裡用 clone() 產生獨立建構子，設定不外洩。
 */
export const Money = Decimal.clone({
  // 遠高於 Decimal(18,6) 所需位數，確保連乘除的中間值不失真
  precision: 40,
  // CLAUDE.md 金額鐵律 3：四捨五入一律 ROUND_HALF_UP，不是 banker's rounding
  rounding: Decimal.ROUND_HALF_UP,
  // 避免大額或小額被轉成指數記法（金額字串要能直接進 DB 與報表）
  toExpNeg: -18,
  toExpPos: 40,
});

/** 可作為金額輸入的型別（number 僅限整數字面常數，勿用於運算結果） */
export type MoneyInput = Decimal.Value;

/**
 * 計算與落地精度，對應 schema 的 `Decimal(18,6)`。
 *
 * 註：docs/IMPLEMENTATION.md §4 原文寫「所有模式輸出以 2 位小數落地」，但該值與
 * CLAUDE.md 迴歸案例互相矛盾——住宿B（¥249,821 × 0.25 ÷ 10 人 = 6,245.525）在
 * 2 位小數下會進位成 6,245.53，使「每人共同分攤 65,305.025」等一連串斷言全部失準。
 * 6 位小數與 schema 欄位本身一致，且實測讓全部迴歸斷言吻合，故採 6。
 * 2 位小數降級為顯示／匯出層的職責，見 round.ts。
 */
export const MONEY_SCALE = 6;

/**
 * 匯率精度，對應 schema 的 `Decimal(18,8)`（`Expense.rateUsed`、`FxRate.rate`）。
 * 比金額多兩位——匯率會被乘上大額金額，位數不足會放大誤差。
 */
export const RATE_SCALE = 8;

/**
 * 係數精度，對應 schema 的 `Decimal(8,4)` / `Decimal(12,4)` / `Decimal(6,4)`
 * （`Member.weight`、`LineItem.qty`、`LineItem.taxRate`）。
 */
export const FACTOR_SCALE = 4;
