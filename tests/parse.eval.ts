import "dotenv/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseReceipt } from "@/lib/parse/anthropic";
import {
  ReceiptGroundTruthSchema,
  type ReceiptGroundTruth,
  type ReceiptParseOutput,
} from "@/lib/schemas/receipt";

/**
 * 收據解析準確率評估。依 docs/IMPLEMENTATION.md §5.4。
 * 樣本格式與跑法見 fixtures/receipts/README.md。
 *
 * ★ 目前 0 筆樣本，這個檔案只證明評估管線本身接得對（scan→逐筆呼叫真實
 * API→比對→算錯誤率），算不出有意義的數字——那需要使用者實際拍 30 張
 * 收據放進 fixtures/receipts/。
 *
 * ★★ 每筆樣本都是一次真的 Anthropic API 呼叫、花真的錢。故意要求
 * RUN_PARSE_EVAL=1 才會真的跑，避免這個成本在有人不小心打
 * `pnpm test`／`pnpm test parse-eval` 時被默默觸發。
 */

const FIXTURES_DIR = path.join(process.cwd(), "fixtures", "receipts");
const IMAGE_EXTENSIONS: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

interface FixturePair {
  name: string;
  imagePath: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  groundTruth: ReceiptGroundTruth;
}

function discoverFixtures(): FixturePair[] {
  let entries: string[];
  try {
    entries = readdirSync(FIXTURES_DIR);
  } catch {
    return [];
  }

  const pairs: FixturePair[] = [];
  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    const mediaType = IMAGE_EXTENSIONS[ext];
    if (mediaType === undefined) continue;

    const name = entry.slice(0, -ext.length);
    const jsonPath = path.join(FIXTURES_DIR, `${name}.json`);
    if (!existsSync(jsonPath)) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(jsonPath, "utf8"));
    } catch {
      continue;
    }
    const groundTruth = ReceiptGroundTruthSchema.safeParse(raw);
    if (!groundTruth.success) continue;

    pairs.push({
      name,
      imagePath: path.join(FIXTURES_DIR, entry),
      mediaType,
      groundTruth: groundTruth.data,
    });
  }
  return pairs;
}

interface FieldCheck {
  field: "total" | "currency" | "datetime" | "tax_rate";
  correct: boolean;
}

function compareReceipt(
  predicted: ReceiptParseOutput,
  truth: ReceiptGroundTruth,
): { fieldChecks: FieldCheck[]; itemRecall: { matched: number; total: number } } {
  const fieldChecks: FieldCheck[] = [
    { field: "total", correct: predicted.total === truth.total },
    { field: "currency", correct: predicted.currency === truth.currency },
    {
      field: "datetime",
      // 只比日期部分——時分秒的判讀落差是另一層的細節，§5.4 只列
      // total/datetime/currency/tax_rate 這四個「關鍵欄位」
      correct:
        predicted.datetime !== null &&
        truth.datetime !== null &&
        predicted.datetime.slice(0, 10) === truth.datetime.slice(0, 10),
    },
  ];

  // tax_rate：用 name_raw 配對品項，只對「兩邊都有」的品項比對稅率
  const truthByName = new Map(truth.items.map((item) => [item.name_raw, item]));
  let taxChecked = 0;
  let taxCorrect = 0;
  for (const item of predicted.items) {
    const match = truthByName.get(item.name_raw);
    if (match === undefined) continue;
    taxChecked += 1;
    if (item.tax_rate === match.tax_rate) taxCorrect += 1;
  }
  if (taxChecked > 0) {
    fieldChecks.push({ field: "tax_rate", correct: taxCorrect === taxChecked });
  }

  const predictedNames = new Set(predicted.items.map((item) => item.name_raw));
  const itemRecall = {
    matched: truth.items.filter((item) => predictedNames.has(item.name_raw)).length,
    total: truth.items.length,
  };

  return { fieldChecks, itemRecall };
}

const fixtures = discoverFixtures();

describe("parse.eval · 收據解析準確率評估", () => {
  if (fixtures.length === 0) {
    it.skip("尚無樣本（fixtures/receipts/ 目前只有 README，見說明補上真實收據）", () => {});
    return;
  }

  if (process.env.RUN_PARSE_EVAL !== "1") {
    it.skip(
      `發現 ${fixtures.length} 筆樣本，但未設定 RUN_PARSE_EVAL=1——每筆都會真的呼叫 API、花真的錢，預設不跑`,
      () => {},
    );
    return;
  }

  it(
    `對 ${fixtures.length} 筆樣本計算關鍵欄位錯誤率與品項召回率`,
    async () => {
      // 依序呼叫（不平行）：避免一次送出一堆請求撞到 rate limit，這個腳本
      // 不追求快，追求穩定跑完並給出可信的數字
      const results: Array<
        | { name: string; failed: true }
        | {
            name: string;
            failed: false;
            fieldChecks: FieldCheck[];
            itemRecall: { matched: number; total: number };
          }
      > = [];

      for (const fixture of fixtures) {
        const buffer = readFileSync(fixture.imagePath);
        const parsed = await parseReceipt({
          imageBase64: buffer.toString("base64"),
          mediaType: fixture.mediaType,
        });
        if (parsed === null) {
          results.push({ name: fixture.name, failed: true });
          continue;
        }
        const { fieldChecks, itemRecall } = compareReceipt(parsed, fixture.groundTruth);
        results.push({ name: fixture.name, failed: false, fieldChecks, itemRecall });
      }

      const parseFailures = results.filter((r) => r.failed);
      const succeeded = results.filter(
        (r): r is Extract<(typeof results)[number], { failed: false }> => !r.failed,
      );

      const allChecks = succeeded.flatMap((r) => r.fieldChecks);
      const errorRate =
        allChecks.length === 0 ? null : 1 - allChecks.filter((c) => c.correct).length / allChecks.length;

      const totalItems = succeeded.reduce((acc, r) => acc + r.itemRecall.total, 0);
      const matchedItems = succeeded.reduce((acc, r) => acc + r.itemRecall.matched, 0);
      const itemRecallRate = totalItems === 0 ? null : matchedItems / totalItems;

      console.log(
        [
          `樣本數：${fixtures.length}（解析失敗 ${parseFailures.length} 筆）`,
          `關鍵欄位錯誤率：${errorRate === null ? "n/a" : `${(errorRate * 100).toFixed(1)}%`}`,
          `品項召回率：${itemRecallRate === null ? "n/a" : `${(itemRecallRate * 100).toFixed(1)}%`}`,
          "§5.4 驗收線「30 張人工修正率 < 20%」是另一個指標（要真人核對每張的修正量），",
          "這裡算的是「跟人工標註逐欄位比對的錯誤率」，方向一致但不是同一個數字，不能互相取代。",
        ].join("\n"),
      );

      // 不對錯誤率設斷言門檻：這是產出報告的評估腳本，不是通過/失敗的品質
      // 閘門。硬設門檻會做出「跟真實使用者修正感受不同步」的假把關。
      expect(results.length).toBe(fixtures.length);
    },
    120_000,
  );
});
