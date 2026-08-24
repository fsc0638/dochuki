/**
 * 支出分類。沿用 docs/IMPLEMENTATION.md §5.2 收據解析 schema 定義的集合，
 * 讓手動輸入與未來 P3 拍照解析出來的分類是同一套詞彙，不會日後對不起來。
 */
export const EXPENSE_CATEGORIES = [
  "餐飲",
  "交通",
  "住宿",
  "購物",
  "門票",
  "雜項",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** 表單常見幣別的下拉選項；使用者仍可手動輸入其他 ISO 4217 代碼 */
export const COMMON_CURRENCIES = ["TWD", "JPY", "USD", "EUR", "KRW"] as const;
