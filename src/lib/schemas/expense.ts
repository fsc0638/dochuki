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

/**
 * 收據品項（P8）。
 *
 * ⚠️ **這是對 P3「刻意不信任表單」決定的反轉，是刻意的。** P3 當時品項沒有
 * 任何複查介面，所以建立支出時是從 `Receipt.parseJson` 重讀，避免有人送出
 * 偽造的品項。P8 加上逐筆可編輯的複查介面之後，表單就**必須**是品項的真相
 * 來源——否則使用者的修正會被默默丟掉，比沒有這個介面更糟。
 *
 * 安全性由兩件事接手：①這裡的 zod 驗證 ②品項金額**不參與分攤計算**
 * （`src/lib/money/` 完全不碰 LineItem，已查證），所以就算填了離譜的數字，
 * 也污染不了任何人的分攤金額，只會讓這筆支出的明細不好看。
 */
const LineItemRowSchema = z.object({
  nameRaw: z.string().trim().min(1, "品項名稱不可空白").max(200),
  nameZh: z.string().trim().max(200).nullable(),
  qty: zPositiveMoneyString,
  // 收據常常讀不到單價，允許留空；寫入層會用 金額÷數量 推算（見 write.ts）
  unitPrice: zPositiveMoneyString.nullable(),
  amount: zMoneyString,
  // 只允許日本現行的兩種稅率或空白——這裡不是通用發票系統，
  // 開放任意數字只會讓錯字變成看起來合理的資料
  taxRate: z.enum(["0.08", "0.1"]).nullable(),
  category: z.string().trim().max(50).nullable(),
});
export type LineItemRowInput = z.infer<typeof LineItemRowSchema>;

/** 收據稅金明細（P8）。rate 與 amount 都可空——解析層允許只認得出內外稅 */
const TaxRowSchema = z.object({
  mode: z.enum(["INCLUSIVE", "EXCLUSIVE"]).nullable(),
  rate: z.enum(["0.08", "0.1"]).nullable(),
  amount: zNonNegativeMoneyString.nullable(),
});
export type TaxRowInput = z.infer<typeof TaxRowSchema>;

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

  // --- P8：收據解析抓得到、但 P3 沒有落地到畫面上的部分 ---
  /** 店名原文（未翻譯）。description 放的是中譯，日本店家對帳時原文才是關鍵 */
  // 這四個用 optional 而不是 default([])：`.default()` 會讓它們在**輸出型別**
  // 變成必填，所有既有呼叫端（含測試、離線佇列補送）都得補上空值才編譯得過。
  // 用 optional 更貼近事實——手動輸入的支出本來就沒有品項，**而且離線佇列裡
  // 可能還躺著這次改版前存的 payload，那些沒有這幾個 key**。
  // 寫入層統一用 `?? []` 正規化。
  storeNameRaw: z.string().trim().max(200).nullable().optional(),
  storeAddress: z.string().trim().max(300).nullable().optional(),
  /** 收據品項。手動輸入的支出沒有，不是錯誤 */
  lineItems: z.array(LineItemRowSchema).max(200).optional(),
  /** 稅金明細。日本收據 8% 與 10% 可能並存，所以是陣列 */
  taxes: z.array(TaxRowSchema).max(10).optional(),
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
/**
 * 從 FormData 收集索引式的重複欄位（`lineItem.0.nameRaw`、`tax.1.rate` …）。
 *
 * 用索引而不是 `getAll()` 陣列：品項有七個欄位，`getAll` 只能保證同名欄位
 * 之間的順序，跨欄位對不對得起來得靠「每個欄位都送出相同筆數」這個脆弱前提
 * ——刪掉一列而某個欄位剛好是空值時就會整排錯位。索引把配對關係寫死在
 * 欄位名裡，刪列不會影響其他列。
 *
 * 空字串一律轉成 null，交給 zod 判斷該欄位允不允許空。
 */
function emptyToNull(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function collectIndexedRows(formData: FormData, prefix: string, fields: string[]): unknown[] {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; ; i++) {
    // 以第一個欄位是否存在判斷這一列在不在——刪除某列時整列的 input
    // 都會從 DOM 移除，不會留下空殼
    if (!formData.has(`${prefix}.${i}.${fields[0]}`)) break;
    const row: Record<string, unknown> = {};
    for (const field of fields) {
      const value = formData.get(`${prefix}.${i}.${field}`);
      row[field] = typeof value === "string" && value.trim() !== "" ? value.trim() : null;
    }
    rows.push(row);
  }
  return rows;
}

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

    // --- P8 ---
    storeNameRaw: emptyToNull(formData.get("storeNameRaw")),
    storeAddress: emptyToNull(formData.get("storeAddress")),
    lineItems: collectIndexedRows(formData, "lineItem", [
      "nameRaw",
      "nameZh",
      "qty",
      "unitPrice",
      "amount",
      "taxRate",
      "category",
    ]),
    taxes: collectIndexedRows(formData, "tax", ["mode", "rate", "amount"]),
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
