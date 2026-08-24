# 道中記（Dōchūki）詳細實作報告

> 版本 2026-08-24 v1.0 ｜ 搭配 `CLAUDE.md`（憲法）與 `docs/PROMPTS.md`（開發提示詞）使用。
> 背景調查見前置文件《旅遊記帳App 開源普查報告與實作規劃書》。

## 1. 範圍與目標

專案名：**道中記 Dōchūki**（repo `dochuki`）。

**MVP 定義（Phase 1–3）**：單一行程、單一團體可完整走完「建行程 → 建成員/組別 → 拍照或手動入帳 → 多幣別分攤 → 公費池 → 一鍵輸出 CSV + Excel + PDF」。
**非目標（Phase 4 之後）**：多人即時協作、帳號系統、清償計畫、歷史統計儀表板、iOS 原生殼。

驗收基準以真實資料為準：2026/09 新潟・佐渡 10 人團全部單據與分攤結果（見 CLAUDE.md 迴歸案例）。

## 2. 系統架構

```
┌─ 手機瀏覽器 (PWA) ─────────────────────────────┐
│  Next.js App Router（RSC + Server Actions）      │
│  相機/相簿上傳 · 確認編輯頁 · 分攤 · 報表下載      │
└──────────────┬─────────────────────────────────┘
               │
   ┌───────────┼──────────────┬───────────────┐
   ▼           ▼              ▼               ▼
 Prisma     解析服務        匯率服務        報表引擎
 PostgreSQL  Anthropic API   Frankfurter    exceljs / CSV
 (docker)    vision→JSON     + fx_rates快取  Playwright→PDF
   │
   ▼
 檔案儲存 /data/receipts（原圖永久保存，可重跑解析）
```

Phase 4 演進：解析服務抽成 Python FastAPI sidecar（PaddleOCR ONNX，低信心案件才升級呼叫 LLM）；資料庫與檔案儲存遷入既有 Rust/PostgreSQL 平台，收據圖檔套用既有 vault 靜態加密。

## 3. 目錄結構

```
dochuki/
├─ CLAUDE.md
├─ docs/{IMPLEMENTATION.md, PROMPTS.md}
├─ .claude/commands/{regression.md, money-audit.md, parse-eval.md}
├─ docker-compose.yml              # postgres:16
├─ prisma/{schema.prisma, seed.ts}
├─ fixtures/
│  ├─ niigata/                     # 迴歸案例輸入與期望值 JSON
│  └─ receipts/                    # 收據測試圖＋人工標註 ground truth
├─ src/
│  ├─ app/                         # 頁面與 route handlers
│  │  ├─ trips/[id]/{expenses,members,funds,reports}/
│  │  └─ api/{parse,export,fx}/
│  ├─ lib/
│  │  ├─ money/                    # ★ 所有金額運算唯一入口
│  │  │  ├─ convert.ts  split.ts  round.ts
│  │  ├─ schemas/                  # zod（含 ReceiptParse schema）
│  │  ├─ parse/{anthropic.ts, prompt.ts, preprocess.ts}
│  │  ├─ fx/frankfurter.ts
│  │  └─ export/{csv.ts, xlsx.ts, pdf/}
│  └─ components/
└─ tests/{money.regression.test.ts, split.test.ts, parse.eval.ts}
```

## 4. 資料模型（Prisma schema 全文）

> **Prisma 7 實作要點**（2026-08-24 P1 落地時修正）
> 1. `prisma-client-js` 已棄用，實際 generator 為 `prisma-client` 且 `output` 為必填。
> 2. `datasource` 不再寫 `url`，改由 `prisma.config.ts` 提供（該檔需 `dotenv` devDependency）。
> 3. **Rust-free client 必須搭配 driver adapter**，`new PrismaClient()` 不能直接連線：
>    需 `@prisma/adapter-pg`，以 `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })` 建立。
> 4. Prisma 回傳的 Decimal 是它自己的 decimal.js 實例（precision 20），與本專案的
>    `Money`（precision 40）不同建構子。**讀寫一律經 `src/lib/money/fromDb.ts`**，
>    詳見本節末「DB 邊界精度」。

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}
datasource db { provider = "postgresql" }

enum SplitMode  { EQUAL WEIGHT EXACT BY_GROUP }
enum FundType   { CONTRIBUTION SPEND }
enum RateSource { TRIP_FIXED DAILY_REF MANUAL }
enum ParseEngine{ LLM_VISION PADDLE_OCR MANUAL }

model Trip {
  id           String   @id @default(cuid())
  name         String
  startDate    DateTime
  endDate      DateTime
  homeCurrency String   @default("TWD")
  fixedRates   Json?    // {"JPY": "0.25"} 幣別→記帳幣固定匯率
  // ★ 待決定（P1 發現的缺口，尚未實作）：個人消費預估目前無落地欄位。
  //   迴歸案例的「35,000 TWD/人」只存在 fixtures/niigata/input.json，而 §7 的
  //   PDF「區塊三個人消費」與 CLAUDE.md 的「個人消費額度追蹤」都需要它。
  //   兩個選項待拍板：
  //     (a) 行程層級統一額度  Trip.personalBudgetPerMember Decimal? @db.Decimal(18,6)
  //     (b) 逐人額度          Member.personalBudget        Decimal? @db.Decimal(18,6)
  //   (a) 足以支撐迴歸案例；(b) 才能表達每人不同額度。實作前需先決定。
  members      Member[]
  groups       Group[]
  expenses     Expense[]
  funds        Fund[]
  createdAt    DateTime @default(now())
}

model Group {
  id      String   @id @default(cuid())
  tripId  String
  trip    Trip     @relation(fields: [tripId], references: [id])
  name    String   // 銀髮組 / 夫妻組 / 兄弟組…
  members Member[]
}

model Member {
  id       String  @id @default(cuid())
  tripId   String
  trip     Trip    @relation(fields: [tripId], references: [id])
  groupId  String?
  group    Group?  @relation(fields: [groupId], references: [id])
  name     String
  weight   Decimal @default(1) @db.Decimal(8, 4)
  shares      ExpenseShare[]
  paid        Expense[]      @relation("payer")
  fundEntries FundEntry[]
}

model Expense {
  id             String     @id @default(cuid())
  tripId         String
  trip           Trip       @relation(fields: [tripId], references: [id])
  payerId        String?
  payer          Member?    @relation("payer", fields: [payerId], references: [id])
  paidAt         DateTime
  category       String
  description    String
  currency       String     // ISO 4217
  amountOriginal Decimal    @db.Decimal(18, 6)
  rateSource     RateSource
  rateUsed       Decimal    @db.Decimal(18, 8)  // 1 原幣 = rateUsed 記帳幣（快照）
  amountHome     Decimal    @db.Decimal(18, 6)  // = amountOriginal × rateUsed
  splitMode      SplitMode
  fundSpend      Boolean    @default(false)      // true = 由公費支付，不進個人分攤
  shares         ExpenseShare[]
  lineItems      LineItem[]
  receipts       Receipt[]
  createdAt      DateTime   @default(now())
  @@index([tripId, paidAt])
}

model ExpenseShare {
  expenseId   String
  expense     Expense @relation(fields: [expenseId], references: [id], onDelete: Cascade)
  memberId    String
  member      Member  @relation(fields: [memberId], references: [id])
  shareHome   Decimal @db.Decimal(18, 6) // 記帳幣分攤額（引擎輸出落地）
  @@id([expenseId, memberId])
}

model LineItem {
  id        String   @id @default(cuid())
  expenseId String
  expense   Expense  @relation(fields: [expenseId], references: [id], onDelete: Cascade)
  nameRaw   String   // 原文（如日文）
  nameZh    String?  // 譯文
  qty       Decimal  @db.Decimal(12, 4)
  unitPrice Decimal  @db.Decimal(18, 6)
  amount    Decimal  @db.Decimal(18, 6)
  taxRate   Decimal? @db.Decimal(6, 4)   // 0.08 / 0.10
  category  String?
}

model Receipt {
  id         String      @id @default(cuid())
  expenseId  String?
  expense    Expense?    @relation(fields: [expenseId], references: [id])
  imagePath  String      // /data/receipts/... 原圖永久保存
  engine     ParseEngine
  parseJson  Json?       // 解析輸出（§5 schema）
  confidence Json?       // 逐欄信心
  parsedAt   DateTime?
  createdAt  DateTime    @default(now())
}

model Fund {
  id      String      @id @default(cuid())
  tripId  String
  trip    Trip        @relation(fields: [tripId], references: [id])
  name    String      @default("公費")
  currency String     @default("JPY")
  entries FundEntry[]
}

model FundEntry {
  id        String   @id @default(cuid())
  fundId    String
  fund      Fund     @relation(fields: [fundId], references: [id])
  memberId  String?
  member    Member?  @relation(fields: [memberId], references: [id])
  type      FundType
  amount    Decimal  @db.Decimal(18, 6) // 公費幣別
  linkedExpenseId String?
  note      String?
  occurredAt DateTime @default(now())
}

model FxRate {
  date   DateTime
  base   String
  quote  String
  rate   Decimal @db.Decimal(18, 8)
  source String  // frankfurter / manual
  @@id([date, base, quote])
}
```

**分攤引擎規則（`src/lib/money/split.ts`）**：
EQUAL＝amountHome ÷ 參與人數；WEIGHT＝按 member.weight 比例；EXACT＝直接指定各人金額（總和必須等於 amountHome，否則拒絕）；BY_GROUP＝金額先屬於某 Group，組內均分（機票情境）。所有模式輸出以 **6 位小數**落地，除不盡的餘數加到付款人的 share，保證 Σshares ≡ amountHome（嚴格相等，回傳前實際驗證）。

> **為何是 6 位而非原訂的 2 位**（2026-08-24 P1 裁示）
> 本文件原文寫「以 2 位小數落地」，但該值與 CLAUDE.md 迴歸案例互相矛盾：
> 住宿B（¥249,821 × 0.25 ÷ 10 人 = **6,245.525**）在 2 位小數下會進位成 6,245.53，
> 使「每人共同分攤 65,305.025 → 每人總計 73,635 / 72,998 / 76,743 → 全團 741,294.25」
> 整條斷言鏈失準。6 位小數與 `ExpenseShare.shareHome` 的 `Decimal(18,6)` 欄位一致，
> 且實測讓全部迴歸斷言吻合。2 位小數降級為**顯示／匯出層**的職責（`round.ts`），
> 對應 CLAUDE.md 鐵律 3 的「TWD 內部保留 2 位小數」。
>
> 尾差量級隨之改變：不再是 ±0.01×n，而是 ≤ n × 0.5 × 10⁻⁶。
> 實例：機票 G1（49,982 ÷ 6）餘 0.000002 歸付款人；住宿B 餘 0。

**DB 邊界精度（`src/lib/money/fromDb.ts`）**：schema 有三種小數位數，寫入必須用對應函式，不得直接 `.toString()`，也不把捨入交給 PostgreSQL 隱式處理。讀取一律先 `fromDb()` 正規化才運算。

| 用途 | 欄位 | 型別 | 寫入函式 |
|---|---|---|---|
| 金額 | `amountOriginal` / `amountHome` / `shareHome` / `FundEntry.amount` / `LineItem.unitPrice` / `LineItem.amount` | `Decimal(18,6)` | `toDbAmount()` |
| 匯率 | `Expense.rateUsed` / `FxRate.rate` | `Decimal(18,8)` | `toDbRate()` |
| 係數 | `Member.weight` / `LineItem.qty` / `LineItem.taxRate` | `Decimal(8,4)` / `(12,4)` / `(6,4)` | `toDbFactor()` |

## 5. 收據解析（核心功能）

### 5.1 流程

拍照/選圖 → 前端壓縮（長邊 ≤1600px、JPEG q80、EXIF 讀取 GPS/時間後即剝除）→ 上傳存原圖 → 呼叫解析 → zod 驗證 → 確認頁（低信心欄位標紅、逐欄可改）→ 建立 Expense＋LineItems → 修正結果回存 `fixtures/receipts/` 作評估樣本。

### 5.2 解析輸出 zod schema（`src/lib/schemas/receipt.ts`）

```ts
export const ReceiptParse = z.object({
  store: z.string().nullable(),        store_zh: z.string().nullable(),
  address: z.string().nullable(),      datetime: z.string().datetime({ offset: true }).nullable(),
  currency: z.string().length(3).nullable(),
  payment_method: z.string().nullable(),
  items: z.array(z.object({
    name_raw: z.string(), name_zh: z.string().nullable(),
    qty: z.number().positive().default(1),
    unit_price: z.number().nullable(), amount: z.number(),
    tax_rate: z.union([z.literal(0.08), z.literal(0.10)]).nullable(),
    category: z.enum(["餐飲","交通","住宿","購物","門票","雜項"]).nullable(),
  })),
  subtotal: z.number().nullable(),
  tax: z.array(z.object({
    rate: z.number(), amount: z.number(),
    mode: z.enum(["內稅(税込)","外稅(税抜)"]).nullable(),
  })),
  total: z.number(),
  confidence: z.record(z.string(), z.number().min(0).max(1)),
});
```

### 5.3 生產用抽取提示詞（`src/lib/parse/prompt.ts`，隨圖片送出）

```text
You are a receipt-parsing engine for a travel expense app. The user is Taiwanese;
receipts are mostly Japanese (also EN/ZH). Extract structured data from the image
and translate names into Traditional Chinese (zh-TW).

Rules:
1. Output ONLY a single JSON object matching the provided schema. No markdown, no prose.
2. Never invent values. If a field is unreadable or absent, use null and lower its confidence.
3. Numbers: plain numbers (no thousand separators). Currency as ISO 4217 (JPY/TWD/USD...).
   Infer currency from symbols/context (円/¥→JPY; NT$/元 in Taiwan context→TWD).
4. datetime: ISO 8601 with offset. Japanese receipts: assume +09:00. Convert 令和/和暦 years
   (令和N = 2018+N). If only date visible, use T00:00:00.
5. Japan tax: 8% (軽減税率, take-away food/drink) and 10% may coexist on one receipt.
   Detect 内税/税込 (tax-included) vs 外税/税抜 (tax-excluded) and set tax[].mode.
   Mark each line item's tax_rate when the receipt marks it (e.g. ※ = 8%).
6. name_zh: natural zh-TW translation of each item (おにぎり→飯糰), keep brand names as-is.
7. category: pick from 餐飲/交通/住宿/購物/門票/雜項 by item nature.
8. Mask any card number except last 4 digits; never output full PAN.
9. confidence: per-field 0–1 (keys: store, datetime, currency, total, items, tax).
10. Sanity check before answering: sum(items.amount) should reconcile with subtotal/total
    given the tax mode; if it doesn't, re-read the image once, then report your best
    reading with lowered confidence rather than forcing the numbers to balance.
```

呼叫端（`src/lib/parse/anthropic.ts`）：`POST https://api.anthropic.com/v1/messages`，模型建議 `claude-sonnet-4-6`（品質/成本平衡；量大或簡單超商收據可降 `claude-haiku-4-5`），`ANTHROPIC_API_KEY` 走環境變數，圖片以 base64 附上，`max_tokens: 2000`，回傳過 zod，失敗重試一次後降級為手動輸入模式。

### 5.4 準確率評估

`fixtures/receipts/` 每張圖配一份人工標註 JSON。`pnpm test parse-eval` 計算關鍵欄位（total/datetime/currency/tax_rate）錯誤率與品項召回率；Phase 2 驗收線：30 張實體收據關鍵欄位人工修正率 < 20%。

## 6. 匯率模組

優先序：`TRIP_FIXED`（trip.fixedRates 有該幣別）→ `MANUAL`（該筆手動輸入）→ `DAILY_REF`（查 `fx_rates` 快取，miss 則打 `https://api.frankfurter.dev/v2/rates?base=JPY&quotes=TWD&date=YYYY-MM-DD` 後寫入快取）。入帳當下把採用值寫進 `expense.rateUsed`，永不回溯。報表附錄列出全部採用匯率與來源。

## 7. 匯出規格

**CSV**（UTF-8 with BOM；一列一品項，無品項的支出輸出一列）：
`expense_id, date, trip, group, payer, category, description, item_name_raw, item_name_zh, qty, unit_price, currency, amount_original, rate_used, amount_twd, tax_rate, store, address, payment_method, split_mode, fund_spend, receipt_id`

**Excel（exceljs，五工作表）**：`明細`（同 CSV）、`分類彙總`（category × 幣別樞紐）、`成員分攤`（member × category，含每人總計列）、`公費收支`（提撥/支用流水＋餘額）、`匯率`（date/base/quote/rate/source）。凍結首列、金額欄千分位格式、總計列底色。

**PDF 彙整總表**：HTML 模板（`src/lib/export/pdf/template.tsx` 產出靜態 HTML）→ Playwright headless print A4。版型沿用已驗證設計：標題＋計算基準框 → 區塊一旅費均攤（共同項目表/機票表/各組總額表＋三色總計方塊）→ 區塊二公費 → 區塊三個人消費 → 最終每人總計表＋方塊 → 附註 → **收據縮圖索引頁**（每筆支出對照單據縮圖與編號）。中文字型用 Noto Sans TC，內嵌。

## 8. PWA 與離線

`manifest.json`（name「道中記 Dōchūki」、short_name「道中記」）+ Service Worker（next-pwa 或手寫 workbox）。Phase 3 僅要求可安裝與快取殼層；Phase 4 加離線佇列：入帳寫 IndexedDB `outbox`，連線恢復由 SW background sync 補傳，衝突以 client 時間戳後寫覆蓋（單人使用前提）。

## 9. 分階段驗收（Definition of Done）

| Phase | 交付 | 驗收（全部必須為真） |
|---|---|---|
| P0 腳手架 | repo 可跑、DB 起得來、CI 綠 | `pnpm dev` 可開首頁；`prisma migrate dev` 成功；lint/typecheck/test 通過 |
| P1 記帳核心 | schema、split 引擎、CRUD、seed | `pnpm test regression` 全綠（新潟數字逐項吻合）；四種分攤模式測試齊備 |
| P2 拍照解析 | 上傳、解析、確認頁 | 30 張樣本關鍵欄位修正率 <20%；解析失敗可降級手動；原圖可重跑 |
| P3 報表與公費 | CSV/xlsx/PDF、公費池、匯率 | 一鍵產出三檔且數字互相一致；PDF 版型含縮圖索引；公費餘額 = Σ提撥−Σ支用 |
| P4 強化 | PaddleOCR sidecar、離線、清償 | 低信心才走 LLM，單張均攤成本下降；斷網入帳恢復後自動補傳 |

> **★ 待釐清：本表與 `docs/PROMPTS.md` 的階段編號／範圍不一致**（2026-08-24 發現，尚未裁示）
> 1. **CRUD 歸屬**：本表把「CRUD」列在 P1，但 PROMPTS.md §P1 的範圍與完成定義都不含 CRUD
>    （§P1 只有 schema、`money/` 模組、seed、迴歸測試、分攤測試）。實際 P1 交付依 §P1 執行，
>    未含 CRUD。
> 2. **解析階段編號**：本表與 CLAUDE.md 的「Phase 2」是拍照解析，但 PROMPTS.md 的
>    **§P2 是「記帳 CRUD 與多幣別 UI」**、解析在 §P3，之後全部順延一號。
>
> 三份文件需對齊。建議以 PROMPTS.md 的順序為準（CRUD 先於解析——解析的終點是建立
> Expense，沒有 CRUD 與確認頁，解析結果無處落地），並據此修正本表與 CLAUDE.md 的勾選項。

## 10. 環境變數

```
DATABASE_URL=postgresql://dochuki:dochuki@localhost:5442/dochuki
ANTHROPIC_API_KEY=sk-ant-...
RECEIPT_STORAGE_DIR=./data/receipts
FX_API_BASE=https://api.frankfurter.dev
```

> **本機實作差異**（2026-08-24 P0/P1 落地時修正，權威值見專案內 `.env.example`）
> - **連接埠 5442**（原訂 5432）：開發機的 5432 已被既有的 PostgreSQL 18 Windows 服務
>   （`postgresql-x64-18`，開機自啟）占用，compose 無法綁定，且 prisma migrate 會連到
>   該服務並以 `P1000` 認證失敗告終。容器對外改映射 5442，容器內仍為標準 5432，
>   既有服務不受影響、無需停用。
> - **`RECEIPT_STORAGE_DIR` 改用相對路徑**：`/data/receipts` 在 Windows 會解析到
>   `C:\data\receipts`。容器／正式環境仍用絕對路徑 `/data/receipts`。
> - **專案路徑不可含非 ASCII 字元**：pnpm 在中文路徑下安裝會於寫入 virtual store
>   階段硬當機（`0xC0000409`），無設定可繞過。專案因此置於 `OneDrive\dev\dochuki`。
