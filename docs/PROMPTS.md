# 道中記（Dōchūki）× Claude Code 開發提示詞集

> 用法：在 repo 根目錄執行 `claude` 進入互動模式，`CLAUDE.md` 會自動載入。
> 每個 Phase 開新會話、貼對應提示詞；大改動先要 Claude 提計畫、你確認後才動工（提示詞已內建此要求）。
> 官方文件：https://docs.claude.com/en/docs/claude-code/overview

## 0. 開工前一次性設定

1. 建 repo，把本交接包四份檔案放進去：`CLAUDE.md`（根目錄）、`docs/IMPLEMENTATION.md`、`docs/PROMPTS.md`、`.claude/commands/*`。
2. 進入 Claude Code 後可用：`/memory` 編輯 CLAUDE.md；訊息開頭打 `#` 快速把一句話加進記憶；`/review` 請它審查變更。
3. 自訂指令已備好（`.claude/commands/`）：輸入 `/regression` 跑金額迴歸並修到綠、`/money-audit` 稽核金額處理鐵律、`/parse-eval` 跑解析評估。
4. 慣例：一個 Phase 一個分支；合併前必跑 `/regression`。

---

## P0 — 腳手架（開新會話貼這段）

```text
讀 CLAUDE.md 與 docs/IMPLEMENTATION.md 第 1–3、10 節後開工。

目標：建立「道中記」專案腳手架（套件／目錄名一律 dochuki）。
範圍：
1. Next.js 15（App Router）+ TypeScript strict + Tailwind + pnpm
2. docker-compose.yml 起 postgres:16（帳密庫名照 IMPLEMENTATION.md §10）
3. Prisma 初始化（先空 schema，P1 才填）、vitest、eslint、typecheck script
4. 目錄結構照 IMPLEMENTATION.md §3 建好（含空的 src/lib/money/ 與 tests/）
5. README 寫最小啟動步驟

約束：不要裝用不到的套件；不要先寫任何業務邏輯。
流程：先列出你要建立/修改的檔案清單與版本選擇，等我回覆「開工」再動手。
完成定義：pnpm dev 可開首頁、docker compose up 後 prisma migrate dev 成功、lint/typecheck/test 全綠。
```

## P1 — 資料模型、分攤引擎與迴歸測試（本專案的地基，最重要）

```text
讀 CLAUDE.md（金額鐵律、迴歸案例）與 docs/IMPLEMENTATION.md 第 4 節後開工。

目標：落地資料模型與分攤引擎，並讓新潟迴歸案例全綠。
範圍：
1. prisma/schema.prisma 完整照 IMPLEMENTATION.md §4 實作，migrate
2. src/lib/money/：convert.ts（原幣→記帳幣，rateUsed 快照）、round.ts（HALF_UP、JPY 0 位、TWD 顯示 0 位內部 2 位）、split.ts（EQUAL/WEIGHT/EXACT/BY_GROUP，餘數歸付款人，Σshares ≡ amountHome）
3. prisma/seed.ts：把 CLAUDE.md 迴歸案例的新潟 fixture 完整建進 DB（10 人、3 組、全部支出、公費、固定匯率 0.25）
4. tests/money.regression.test.ts：斷言 CLAUDE.md 表列全部期望值（65,305.025 / 73,635 / 72,998 / 76,743 / 741,294.25，交叉驗證差額 0）
5. tests/split.test.ts：四種分攤模式的單元測試，含除不盡、權重為 0、EXACT 總和不符要拒絕等邊界

約束：全程 decimal.js，出現任何 float 金額運算就是錯；不准為了讓測試過而在測試裡放寬精度。
流程：先給我 money/ 三個模組的函式簽名與測試案例清單，確認後再實作。
完成定義：pnpm test regression 與 pnpm test 全綠，/money-audit 無違規。
```

## P2 — 記帳 CRUD 與多幣別 UI

```text
讀 docs/IMPLEMENTATION.md §3、§6 後開工。

目標：手動記帳全流程可用（先不做拍照）。
範圍：
1. 行程/成員/組別管理頁（建行程時可設 homeCurrency 與 fixedRates，例 JPY:0.25）
2. 支出新增/編輯頁：幣別選擇、金額、分攤模式四選（BY_GROUP 要能挑組別）、分類、日期、付款人；即時預覽每人分攤
3. 匯率來源三選一 UI（行程固定/參考匯率/手動），src/lib/fx/frankfurter.ts 實作含 fx_rates 快取
4. 行程總覽頁：支出列表（filter by 分類/成員/日期）、每人小計、幣別切換顯示

約束：手機優先版面（375px 起）；所有金額顯示走 round.ts，UI 不得自行算錢。
流程：先給頁面路由表與元件切分，確認後實作。
完成定義：用 seed 的新潟資料操作一輪 CRUD 不出錯，總覽頁每人小計與迴歸期望一致。
```

## P3 — 拍照解析（核心賣點）

```text
讀 docs/IMPLEMENTATION.md 第 5 節（流程、zod schema、生產提示詞全文照抄使用）。

目標：拍照 → 解析 → 確認 → 入帳 全流程。
範圍：
1. src/lib/parse/preprocess.ts：前端壓縮（長邊1600/q80）、讀取 EXIF GPS+時間後剝除 EXIF
2. src/lib/parse/anthropic.ts：呼叫 messages API（model claude-sonnet-4-6、base64 圖、max_tokens 2000），回傳過 ReceiptParse zod，失敗重試一次後回 null
3. 上傳 API：原圖存 RECEIPT_STORAGE_DIR，建 Receipt 記錄
4. 確認編輯頁：解析結果逐欄可改，confidence < 0.8 的欄位標紅；「確認入帳」建 Expense + LineItems 並回填 receipt.expenseId；「重新解析」可重跑
5. fixtures/receipts/ 建評估集結構與 tests/parse.eval.ts（對照人工標註算關鍵欄位錯誤率）

約束：API key 只從環境變數讀；圖檔與解析 JSON 不得進 log；卡號只留末四碼（提示詞已含，落地時再驗一次）。
流程：先畫時序圖（上傳→解析→確認→入帳）與錯誤降級路徑，確認後實作。
完成定義：手機實拍一張日文收據能走完全流程；解析失敗能降級手動；parse.eval 能跑出報告。
```

## P4 — 報表輸出與公費池

```text
讀 docs/IMPLEMENTATION.md 第 7 節（三種格式欄位與版型規格）。

目標：一鍵輸出 CSV + Excel + PDF，公費池可用。
範圍：
1. src/lib/export/csv.ts：UTF-8 with BOM，欄位照 §7
2. src/lib/export/xlsx.ts：exceljs 五工作表（明細/分類彙總/成員分攤/公費收支/匯率），凍結首列、千分位、總計列底色
3. src/lib/export/pdf/：HTML 模板照 §7 版型（計算基準框、三區塊各含總計方塊、最終每人總計、附註、收據縮圖索引頁），Playwright print A4，內嵌 Noto Sans TC
4. 公費池：Fund/FundEntry CRUD，提撥（成員→公費）與支用（expense.fundSpend=true 自動記一筆 SPEND），餘額即時顯示
5. 報表頁：一鍵產三檔下載

約束：三檔數字必須互相一致且與畫面一致（同一計算入口）；PDF 中文不可變豆腐字。
流程：先給 PDF 模板的區塊結構草稿（文字描述即可），確認後實作。
完成定義：用新潟 seed 產出三檔，PDF 每人總計 = 73,635/72,998/76,743、全團 741,294；公費餘額 = Σ提撥 − Σ支用。
```

## P5 — PWA 與收尾（Phase 3 尾聲）

```text
目標：可安裝的 PWA 與部署。
範圍：manifest（name「道中記 Dōchūki」、short_name「道中記」）+ icons + Service Worker（殼層快取）；Dockerfile 多階段建置；docker compose 一鍵起全套（app+db）；README 部署章節。
完成定義：手機 Safari/Chrome 可加入主畫面全螢幕開啟；容器內 Playwright 能產 PDF（記得裝 chromium 依賴）。
```

---

## 常備工具提示詞

**除錯模板**
```text
症狀：<貼錯誤訊息或行為>
重現步驟：<步驟>
先讀相關檔案並提出 2–3 個假設與驗證方法，逐一驗證找到根因後再修；修完跑受影響測試 + /regression。不要在找到根因前就改碼。
```

**新增功能模板**
```text
需求：<一句話>
請先做三件事再動工：1) 指出受影響的模組與資料表 2) 提出方案與取捨（若有多案）3) 列驗收條件。我確認後實作，完成後補測試並更新 CLAUDE.md 進度日誌。
```

**每階段收尾（合併前）**
```text
執行收尾檢查：1) /regression 2) /money-audit 3) pnpm lint && pnpm typecheck && pnpm test 4) 用 /review 審自己這次 diff，列出風險點 5) 更新 CLAUDE.md 進度勾選與日誌。全部完成後給我 commit 訊息建議。
```
