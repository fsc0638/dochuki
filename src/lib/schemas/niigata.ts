import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 新潟迴歸 fixture 的型別與載入。
 *
 * prisma/seed.ts 與 tests/money.regression.test.ts 共用本檔，確保兩者讀的是
 * 同一份資料、同一套形狀定義——否則 seed 進 DB 的內容與測試斷言的內容可能
 * 不知不覺分歧。
 *
 * 待辦：CLAUDE.md 定「zod schema 是唯一資料驗證來源」。本檔目前只有 TypeScript
 * 型別（編譯期），尚未做執行期驗證；P2 把 API 邊界接上 zod 時一併改為 zod schema。
 */

/** 金額一律以字串承載，避免 JSON number 的浮點誤差（CLAUDE.md 鐵律 1） */
export type MoneyString = string;

export interface NiigataTrip {
  /** 固定 id：讓 seed 只清除並重建本行程的資料 */
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  homeCurrency: string;
  fixedRates: Record<string, MoneyString>;
}

export interface NiigataGroup {
  id: string;
  name: string;
}

export interface NiigataMember {
  id: string;
  name: string;
  groupId: string;
}

export interface NiigataExpense {
  id: string;
  description: string;
  category: string;
  paidAt: string;
  currency: string;
  amountOriginal: MoneyString;
  splitMode: "EQUAL" | "WEIGHT" | "EXACT" | "BY_GROUP";
  payerId: string;
  groupId?: string;
}

export interface NiigataInput {
  trip: NiigataTrip;
  groups: NiigataGroup[];
  members: NiigataMember[];
  expenses: NiigataExpense[];
  fund: {
    name: string;
    currency: string;
    contributionPerMember: MoneyString;
  };
  /**
   * 個人消費預估的來源數字。P4：不是 schema 欄位，seed.ts 用它替每位成員
   * 各建一筆單人 Expense；regression 測試另外把它當 summarizeTrip() 的
   * extras 使用，見 fixtures/niigata/input.json 的 personalBudget._comment。
   */
  personalBudget: {
    currency: string;
    perMember: MoneyString;
  };
}

export interface NiigataExpected {
  rateUsed: Record<string, MoneyString>;
  expenseAmountHome: Record<string, MoneyString>;
  lodgeBPerRoom: MoneyString;
  commonTotalHome: MoneyString;
  perMemberCommonShare: MoneyString;
  fundPerMemberHome: MoneyString;
  personalPerMemberHome: MoneyString;
  perMemberExFlight: MoneyString;
  flightPerMember: Record<string, MoneyString>;
  perMemberTotalDisplay: Record<string, MoneyString>;
  grandTotalExact: MoneyString;
  grandTotalDisplay: MoneyString;
  grandTotalJpyEquivalent: MoneyString;
  expenseTotalHome: MoneyString;
  fundTotalHome: MoneyString;
  personalTotalHome: MoneyString;
  crossCheckDifference: MoneyString;
}

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "niigata",
);

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, fileName), "utf8")) as T;
}

export function loadNiigataInput(): NiigataInput {
  return readJson<NiigataInput>("input.json");
}

export function loadNiigataExpected(): NiigataExpected {
  return readJson<NiigataExpected>("expected.json");
}
