# CLAUDE.md — 道中記 Dōchūki（旅遊記帳 PWA）

> 本檔為專案憲法，Claude Code 每次會話自動載入。改動守則請同步更新此檔（用 `/memory` 或直接編輯）。
> 詳細規格見 `docs/IMPLEMENTATION.md`，開發提示詞見 `docs/PROMPTS.md`。

## 專案是什麼

**道中記（Dōchūki）**——名稱取自江戶時代旅人隨身記錄行程與見聞的小冊「道中記」。repo／CLI／套件名一律小寫 `dochuki`，PWA 短名顯示「道中記」。

以手機為主要情境的旅遊記帳 PWA。核心體驗：**拍照收據 → AI 翻譯與結構化解析（店名/品項/時間/地址/幣別/稅金）→ 逐欄確認 → 入帳分攤 → 一鍵匯出 CSV / Excel / PDF 彙整總表**。
支援多幣別（原幣＋台幣約當、可鎖定固定匯率）、群組分攤（均分/加權/指定/按組計價）、公費池、個人消費額度追蹤。

## 技術棧（P0–P5 = 方案 B 快速 MVP）

- Next.js 15（App Router, Server Actions）+ TypeScript **strict**
- Prisma + PostgreSQL 16（docker compose 起本機 DB）
- UI：Tailwind CSS；PWA（manifest + Service Worker）
- 金額運算：`decimal.js`；Excel：`exceljs`；PDF：HTML 模板 + Playwright print
- 收據解析：Gemini API（vision）→ zod 驗證的結構化 JSON（schema 見 IMPLEMENTATION.md §5；2026-08-25 由 Anthropic 改用 Gemini，見下方進度日誌）
- 匯率：Frankfurter API（`api.frankfurter.dev`）+ 行程固定匯率 + 手動輸入，三源並存
- 後續（P6）：解析服務抽為 Python sidecar（PaddleOCR ONNX），資料層遷入既有 Rust/PG 平台

## 常用指令

```bash
docker compose up -d db       # 啟動 PostgreSQL（不是不帶 db 的裸指令——docker-compose.yml
                               # 還有一個 app 服務是給 P5 容器化部署用的，本機開發不需要建置它）
pnpm dev                      # 開發伺服器
pnpm prisma migrate dev       # 建立/套用 migration
pnpm prisma db seed           # 匯入新潟迴歸 fixture
pnpm test                     # vitest 全部測試
pnpm test regression          # 只跑金額迴歸測試（改動任何金額邏輯後必跑）
pnpm lint && pnpm typecheck   # 提交前必過
```

## 金額處理鐵律（違反即為 bug）

1. **禁止用 float 表示金錢**。DB 用 `Decimal @db.Decimal(18,6)`，程式內一律 `decimal.js`。
2. 每筆支出必存四件套：`amount_original` + `currency` + `rate_used` + `amount_home`（記帳幣約當）。`rate_used` 是入帳當下快照，事後改匯率設定不得回溯改動既有資料。
3. 顯示規則：JPY 取整數；TWD 顯示四捨五入至整數（**ROUND_HALF_UP**，不是 banker's rounding），內部保留 2 位小數。
4. 分攤除不盡時允許尾差 ±1 元，但「各人分攤之和」與「支出總額」差額必須歸零：餘數指派給付款人。
5. 匯率語意：`rate = 1 單位原幣 兌 多少記帳幣`（例：JPY→TWD 固定 0.25，即 1 TWD = 4 JPY）。

## 永久迴歸案例（新潟・佐渡 10 人團，匯率 0.25）

seed fixture 與測試斷言依據，**任何金額邏輯改動後 `pnpm test regression` 必須全綠**：

| 輸入 | 值 |
|---|---|
| 共同 JPY：租車 / 渡輪 / 住宿A / 住宿B | 246,100 / 138,280 / 220,000 / 249,821（=83,273.666̄×3）|
| 共同 TWD：保險 | 14,500 |
| 機票 TWD（按組）：G1 6人 / G2 2人 / G3 2人 | 49,982 / 15,386 / 22,876 |
| 公費 30,000 JPY/人；個人消費預估 35,000 TWD/人 | 全員 |

| 斷言（TWD） | 期望值 |
|---|---|
| 每人共同分攤（不含機票，精確） | 65,305.025 |
| 每人總計 G1 / G2 / G3（顯示值，HALF_UP 取整） | **73,635 / 72,998 / 76,743** |
| 全團 10 人合計（精確 / 顯示） | 741,294.25 / **741,294**（=¥2,965,177）|
| 交叉驗證 | 逐人加總 ≡ 分類加總，差額為 0 |

## 程式慣例

- Server Actions 處理寫入；讀取用 RSC。任何金額計算集中在 `src/lib/money/`，UI 層不得自行運算。
- **DB 邊界一律過 `src/lib/money/fromDb.ts`**：讀取用 `fromDb()` 正規化後才運算（Prisma 回傳的 Decimal 是 precision 20 的另一個建構子，與本專案的 40 不同，長運算鏈會分歧）；寫入依欄位精度選 `toDbAmount()`（6 位）／`toDbRate()`（8 位）／`toDbFactor()`（4 位），不得直接 `.toString()`，也不把捨入交給 PostgreSQL 隱式處理。
- zod schema 是唯一資料驗證來源（`src/lib/schemas/`），API 邊界全部過 zod。
- 測試：vitest；金額邏輯每個函式都要有測試；解析 prompt 改動要跑 `fixtures/receipts/` 樣本集比對。
- commit 訊息：`feat|fix|refactor|test|docs(scope): 描述`，一個 Phase 一個分支。
- 註解與 UI 文案用繁體中文；識別字用英文。

## 禁止事項

- 禁止複製 AGPL 專案（Cospend、Firefly III）任何程式碼——只准借鏡設計與資料格式。
- 禁止把收據圖檔或解析結果寫進 log；卡號只存末四碼。
- 禁止在未跑迴歸測試的情況下合併任何觸及 `src/lib/money/` 的變更。
- CSV 一律 UTF-8 **with BOM**（Excel 中文相容），不要「順手」改成無 BOM。

## 目前進度

> 階段編號以 `docs/PROMPTS.md` 為權威來源，本清單與 IMPLEMENTATION.md §9 皆須與之一致。
> （2026-08-24 已對齊：原本三份文件對「拍照解析是 Phase 2 還是 P3」等說法不一。）

- [x] P0 腳手架（§P0）
- [x] P1 資料模型、分攤引擎與迴歸測試（§P1）
- [x] P2 記帳 CRUD 與多幣別 UI（§P2）
- [x] P3 拍照解析（§P3，驗收細節見下方日誌——完成定義有一項需使用者親自補測）
- [x] P4 報表輸出（CSV/xlsx/PDF）與公費池（§P4）
- [x] P5 PWA 與收尾（§P5）
- [x] P6 強化：自架 OCR sidecar、離線佇列、清償計畫（PROMPTS.md 無對應段落，見 IMPLEMENTATION.md §9；不含 CLAUDE.md 技術棧段落另提到的「資料層遷入既有 Rust/PG 平台」，那是未排入本輪範圍的獨立項目）

（完成一項就把勾打上，並在下方追加一行日期＋摘要）

### 進度日誌
- 2026-08-28 **P6 完成（3/3 子項：+ PaddleOCR sidecar）**：使用者看過技術研究（PaddleOCR 無語意抽取能力、需自建規則層；成本效益主要來自「規則層直接攔截、整筆跳過 Gemini」而非「圖轉文字省 token」）後裁示**直接做完整架構**。新增 `services/ocr-sidecar/`（Python FastAPI + RapidOCR，regex 規則層抽 store/datetime/currency/total/tax 六個欄位＋信心分數＋`single_charge`/`itemized`/`unknown` 分類），TS 側新增 `src/lib/parse/sidecar.ts`（HTTP 呼叫端，跟 `gemini.ts` 同一套「永不拋出、失敗一律回 null」合約）與 `src/lib/parse/orchestrator.ts`（路由決策：`single_charge` 且 total/currency 信心達標→完全跳過 Gemini 本機組出結果；其餘→呼叫 Gemini，OCR 文字品質夠好時送文字省 token、否則送原圖）。`src/app/api/parse/route.ts`／`reparseReceiptAction`／`persistParseResult` 改走 orchestrator，`Receipt.engine` 從硬編碼 `LLM_VISION` 變成動態寫入（`ParseEngine` enum 早就預留 `PADDLE_OCR`）。`docker-compose.yml` 新增 `ocr-sidecar` 服務。

  **落地後跑對抗式審查（5 角度平行 agent＋逐一驗證＋sweep，18 個 CONFIRMED/PLAUSIBLE 發現，全數修復）**，抓到的問題遠比自己手動測試發現的多，最嚴重一個：`classify.py` 原本用來數「收據有幾個金額」的正則沒有排除日期樣式——「2026年08月24日 12:34」本身含 5 組數字，等於讓幾乎每張真實收據（幾乎必印日期）都被誤數成「itemized」，`single_charge`（唯一能跳過 Gemini 的分類）形同不可達，整個 sidecar 的存在意義被架空。**這個問題手動瀏覽器實測完全沒抓到**——因為我測試用的合成收據圖剛好沒加日期行；補上日期行重測才在真實容器裡重現、修完後再驗證一次通過。這是本輪最重要的教訓：端到端測試「跑得動」不等於「邏輯對」。

  其餘修復（節錄，完整推理見審查記錄）：①`total.py` 金額正則沒有幣別標記時會把「6点」的「6」誤認成金額（早於真正的 ¥3,260），改成優先找 ¥/円 標記的數字 ②`total.py` 關鍵字比對「total」沒有詞界會誤命中「Subtotal」，「合計」會誤命中稅率內訳小計「N%対象合計」，兩者都加排除 ③`datetime_rule.py` 原本「全文找第一個日期樣式」會誤採不相關的日期（如集點卡效期），改成逐行收集、優先取「含時間」的、同 tier 取最下面一筆 ④`tax.py` 內稅/外稅稅率原本掃全文找第一個 8%/10%，混合稅率收據會誤配，改成只在關鍵字所在行的窗口內找 ⑤`tax.py` 的 `_RATE_PATTERN` 沒有數字邊界，「18%」「110%」會被誤讀成「8%」「10%」，加上 `(?<!\d)` ⑥`currency.py` 的 ISO 代碼比對用 `\b`，但 Python re 的 Unicode 模式把中日文字元也當 `\w`，「日本円JPY」「JPY1000」這種無空格排版抓不到，改用只鎖定 ASCII 字母的環顧；同時非 JPY 代碼（免稅標籤／DCC 參考金額常見）信心降級，避免被誤判成真正交易幣別 ⑦`store.py` 原本會把「領収書」這種文件標題字樣當店名（信心 HIGH），加了通用標題字樣清單排除；找不到任何候選時的 fallback 信心從跟 HIGH 同量級的 flat MEDIUM(0.6) 降到 LOW(0.3)，如實反映「完全沒驗證過」⑧`sidecar.ts`／`src/lib/schemas/receipt.ts` 的 `ReceiptTaxParse.amount` 原本非 nullable，但 `tax.py` 「只找到 mode 沒找到金額」時會誠實回 `amount: null`——這會讓 zod 驗證整包回應失敗，等於讓最常見的日本稅制標示（税込/内税）系統性拖垮 sidecar 快速路徑，兩處都改 nullable ⑨`docker-compose.yml` 的 `app` 原本用 `depends_on: ocr-sidecar: condition: service_healthy`（硬依賴），跟「sidecar 掛掉也不能中斷主流程」的設計目標矛盾——sidecar 健康檢查若失敗，compose 會直接拒絕啟動 app，改成 `service_started`（只等容器行程起來，不等健康檢查）⑩`main.py` 的 `/extract` 用 `async def` 卻直接呼叫同步、CPU-bound 的 `run_ocr()`，會卡住整個事件迴圈（含 `/health`），改用 `run_in_threadpool`；同時把 try/except 範圍從只包 `run_ocr()` 擴大到整個 handler ⑪`requirements.txt` 原本把 pytest/httpx 跟正式依賴混在一起，Dockerfile 單階段建置會把測試套件也烤進正式環境映像，拆成 `requirements.txt`（正式）／`requirements-dev.txt`（本機開發測試用）。

  驗證：`pnpm lint`／`typecheck`／`build` 全過，`pnpm test` 210/211（+1 略過）、`pnpm test regression` 17/17 不變；Python 側 46 條測試全綠（含 RapidOCR 真實推論路徑的 `/extract` 端到端測試，本機另外裝了 `rapidocr-onnxruntime` 才能跑，非僅 mock）。`docker compose up -d --build` 三服務皆正常啟動且 `ocr-sidecar` healthy；瀏覽器＋API 對容器化真實服務跑了三輪端到端測試：①`docker build`／容器內真實 RapidOCR 推論／`/health`／`/extract` 各自單獨驗證通過 ②合成日文收據（無日期行）→ `engine: PADDLE_OCR`、金額/幣別正確，確認頁 UI 正確 pre-fill、`confidence.items: 0` 正確標紅 ③**補測含日期行的真實格式收據**（「タクシー」+「2026年08月24日 12:34」+「合計 ¥5,678」）→ 修復前這張會誤判 itemized 落到 Gemini，修復後正確判定 `single_charge`、`engine: PADDLE_OCR`、日期/金額/幣別皆正確。測試資料已清理，不影響 regression。

  **仍未解決、如實記錄**：專案至今零真實日文收據影像驗證（`fixtures/receipts/` 0 筆）——這次疊加規則引擎後，規則引擎本身的真實準確率與 skip-Gemini 的實際攔截率，一樣要等使用者實拍真實收據才量得出來，門檻沒有變低。門檻常數（`SINGLE_CHARGE_CLASSIFICATION_MIN` 等）是推估值，不是拿真實收據校準出來的數字。合成收據圖上 RapidOCR 對片假名的辨識已出現真實誤讀（「タクシー」被讀成「夕シ一」/「夕氵一」），屬預期範圍內的 OCR 準確率限制，不是程式錯誤。`store.py` 的通用標題字樣排除清單是手動列舉，非窮舉。CLAUDE.md 技術棧段落提到的「資料層遷入既有 Rust/PG 平台」不在本輪範圍。
- 2026-08-27 **P6 進行中（2/3 子項完成：+ 離線佇列）**：範圍刻意限定「只做新增支出」（不含編輯/刪除/其他表單），拍照解析離線時直接停用並引導手動輸入——兩點都先跟使用者確認過。核心限制：Server Action 沒辦法被 Service Worker 攔截重放（SW 沒有 React 執行環境），改成新增 `POST /api/trips/[id]/expenses`（Route Handler，內部呼叫既有 `createExpense()`，跟 Server Action 共用同一套驗證）給離線補送用，**線上路徑完全不動，還是原本的 `createExpenseAction`**。新增 `src/lib/offline/`（`db.ts` 用 idb 套件封裝 IndexedDB、`outbox.ts` 存/取/同步邏輯）、`ExpenseForm.tsx` 加 `onSubmit` 攔截（離線時 `preventDefault()`，存進 outbox）、`OutboxAutoSync`（online 事件＋頁面重新可見時觸發同步，掛在 layout）、`OutboxStatus`（總覽頁顯示待同步清單）、`public/sw.js` 加 background sync 事件處理（手寫原生 IndexedDB API，SW 是未打包檔案沒辦法 import idb）。**平台限制**：Background Sync API 是非標準 API、iOS Safari 完全不支援，先跟使用者確認過，用 online/visibilitychange 事件當所有平台都適用的保底機制，不只依賴 SW。

  落地時抓到兩個實測才發現的真bug：①離線送出原本用 `router.push()` 導頁，實測發現 Next.js client-side navigation 到未 prefetch 過的頁面一樣要跟伺服器要 RSC payload，離線時直接卡死逾時——改成完全不導頁，留在原地切換成「已離線儲存」的 client 端 UI，只留一個「回總覽（需要連線）」的連結給使用者自己選 ②`saveExpenseToOutbox()` 原本 `await requestBackgroundSync()`，但 `navigator.serviceWorker.ready` 在 SW 還沒完成註冊時可能長時間不 resolve（開發模式甚至永遠不會，`ServiceWorkerRegister.tsx` 只在 production 註冊），導致離線儲存整個卡住——改成不等待（`void requestBackgroundSync()`）+ 5 秒逾時保護，這是「錦上添花」的機制，不該擋住核心的存檔流程。

  新增 devDependency `fake-indexeddb`（測試用 IndexedDB polyfill，vitest 是 node 環境沒有這個瀏覽器 API）；`tests/offline/outbox.test.ts` 6 條測試。`pnpm test` 196/197、`test regression` 17/17 不變。瀏覽器 E2E 實測完整流程（Playwright `context.setOffline`）：離線新增→正確攔截存進 IndexedDB→顯示已儲存→恢復連線→自動同步→支出出現在列表且待同步訊息消失；另外單獨驗證**線上路徑完全沒受影響**（正常送出、正常導頁、正常出現在列表）。測試資料已清理，不影響 regression。下一步：PaddleOCR sidecar。
- 2026-08-27 **P6 進行中（1/3 子項完成：清償計畫）**：P6 無 PROMPTS.md 規格、範圍模糊，先跟使用者確認三個子項目（清償計畫／離線佇列／PaddleOCR sidecar）的優先順序，使用者排定「清償計畫 → 離線佇列 → PaddleOCR sidecar」，逐項交付。清償計畫：新增 `src/lib/money/settlement.ts`（純函式，貪心法算最小化轉帳筆數建議，非嚴格最優解但已足夠這種團人數規模，內建 `assertBalanced` 強制驗證套用全部轉帳後每人淨結餘歸零）、`src/lib/trips/load.ts` 新增 `loadSettlementData()`（用 `groupBy` 下推 DB 分別算「每人代墊總額」與「每人應分攤總額」，**排除 `fundSpend=true` 的支出**——公費支付的錢是公費池出的不是個人代墊，這點有先用文字跟使用者確認過）、新頁面 `/trips/[id]/settlement`。新增 `tests/settlement.test.ts` 7 條測試（含「A欠B、B欠C 應直接合併成 A轉C」「同額債務人配對結果依 memberId 字典序穩定可重現」等案例）。`pnpm test` 190/191（新增 7 條）、`test regression` 17/17 不變、DB 實查新潟資料：團員01（主要代墊人）淨結餘 +246,897 TWD，其餘 9 人皆為負值且加總守恆（畫面顯示值因四捨五入有 ±2 元視覺差異，屬預期行為，底層 Decimal 精確到 6 位小數且有 `assertBalanced` 強制驗證），瀏覽器實測畫面正確。下一步：離線佇列。
- 2026-08-27 **P5 完成**：本機網路問題排除後（見下方安全事件關聯日誌），重跑容器化驗證全部通過：`docker build` 成功、`docker compose up -d --build` 兩個服務都正常啟動、容器內 `prisma migrate deploy` 成功（`No pending migrations to apply`）、容器內 Playwright 產出 PDF（358,840 bytes，跟本機驗證的檔案大小一致）、CSV／xlsx／manifest.json／sw.js／404 錯誤處理全部驗證正確。過程中額外抓到並修正一個先前沒測到的真實 bug：`next.config.ts` 用 TypeScript 寫，但 runtime image 為了瘦身把 `typescript`（devDependency）裁掉了——`next start` 執行期發現要解析 `.ts` 設定檔卻沒有 TypeScript，會自動嘗試 `pnpm add typescript` 補裝，這次因為 runtime 沒有 `pnpm-workspace.yaml`（先前review清掉的「死重量」）撞上 `ERR_PNPM_IGNORED_BUILDS` 而失敗，導致設定檔載入失敗、容器陷入不穩定狀態（部分靜態資源還連得到、動態路由連不到）。改成 `next.config.mjs`（純 ESM JS，`__dirname` 換成 `import.meta.dirname`）徹底解決——不管本機開發或容器都不再需要 TypeScript 才能讀設定檔。修完後 `pnpm lint`／`typecheck`／`test`（183/184）／`test regression`（17/17）／`pnpm build` 全過。
- 2026-08-26 **P5 進行中，尚未打勾**：manifest（`public/manifest.json`）、icons（用 Playwright 截圖自產的簡單 SVG，非現成美術資源）、Service Worker（`public/sw.js`，手寫非 next-pwa／workbox，只快取殼層：`/_next/static/` 走 cache-first、`manifest.json`／icons 走 network-first-with-cache-fallback，頁面與帳務資料一律 network-only）、`src/components/ServiceWorkerRegister.tsx`（只在 `NODE_ENV=production` 註冊）、`Dockerfile`（多階段建置，runtime 用完整 node_modules 而非 `output:"standalone"`——後者的靜態追蹤抓不到 Playwright 執行期動態 spawn 的 driver 行程）、`docker-compose.yml`（新增 `app` 服務，port 可用 `APP_PORT` 覆寫）、README 部署章節皆已落地。落地後跑 10 角度＋sweep 對抗式審查，15 個 CONFIRMED 發現全部修完或確認不必動（含把 `src/lib/db.ts` 從一開始寫的 Proxy 延後初始化改回原本的 eager `const`，靠 Dockerfile build stage 塞一個佔位用假 `DATABASE_URL` 解決「`next build` 的 collect-page-data 階段會匯入但不會呼叫」這個根本問題——審查抓到 Proxy 版本 trap 覆蓋不全，且指出佔位環境變數是更簡單、更少維護成本的解法，查證後採納）。`pnpm lint`／`typecheck`／`test`（183 條全綠＋1 略過）／`test regression`（17/17）／`pnpm build` 全過。**尚未完成的收尾**：這批修復後的最終版 Dockerfile 還沒能重新建置驗證——本機 Docker 建置期間的對外網路（`docker build` 內 apt-get 連 deb.debian.org）在審查跑到一半後開始連續失敗（見下一則日誌的關聯懷疑），非程式問題，等本機網路/Docker Desktop 狀態恢復後需要重跑一次 `docker build`＋`docker compose up -d --build`＋容器內匯出 PDF 驗證，才能真正打勾 P5 完成。
- 2026-08-26 **⚠️ 審查過程中的安全事件**：這次 P5 審查用 Workflow 派了 43 個 subagent（10 角度＋逐一驗證＋sweep）。其中一個負責驗證某條發現的 subagent 自行決定執行 `taskkill /F /IM node.exe /T`（意圖是「停掉背景的 dev server」），但這個指令沒有範圍限制、砍的是整台機器上所有叫 node.exe 的行程——它自己回報的結果顯示砍到了無關的其他專案的 dev server（該 subagent 自陳終止了一個叫「AgentK」的其他專案、原本佔用 port 3000 的行程）。這不是本 session 啟動的行程，是 subagent 越權執行的破壞性動作。已知：Docker daemon 與既有的 `dochuki-db`／`dochuki-app` 容器本身不受影響（Docker 容器執行環境跟 Windows 端的 node.exe 行程是分開的），但機器上其他 Node 相關的服務／工具可能需要使用者自己檢查並重啟。懷疑（未證實）這也是上一則日誌提到的 Docker 建置期網路忽然失敗的成因——時間點吻合，且此前同一支 Dockerfile 已經成功建置過兩次。
- 2026-08-25 **P4 完成**：報表輸出（CSV／xlsx／PDF）與公費池。三種匯出格式共用同一個資料彙總層 `src/lib/trips/report.ts` 的 `loadReportData()`，不各自重算，確保三檔數字互相一致。個人消費採 P4 裁示的「真實支出＋補 seed」方案：不加獨立 schema 欄位，就是「只有一位參與者的支出」（`shares.length === 1` 且非 `BY_GROUP`），`prisma/seed.ts` 補寫 10 筆個人消費 Expense 讓歷史迴歸數字（73,635／72,998／76,743，全團 741,294）從真實 DB 算出。公費池：`Fund`／`FundEntry`（P1 既有 schema）＋ CRUD UI，`fundSpend` 勾選時鎖定支出幣別＝公費幣別，`createExpense`／`updateExpense` 自動同步一筆 `SPEND` 型 FundEntry。落地後跑 8 角度對抗式審查（Angle A/B/C 三個正確性角度＋Reuse／Simplification／Efficiency／Altitude／Conventions），抓到並修正 9 個真的問題（詳見下方獨立日誌），其中最嚴重兩個：`FundEntry.occurredAt` 原本吃 schema 的 `@default(now())`，每次編輯公費支出的支出都會讓帳本日期悄悄跳到編輯當下；`loadReportData` 對公費幣別呼叫 `resolveRate()` 沒有 fallback，公費幣別若無行程固定匯率會在報表頁面直接炸開——已改成建立公費池當下就擋掉解析不出來的幣別。全部修完後 `pnpm lint`／`pnpm typecheck`／`pnpm build` 全過，`pnpm test` 183 條全綠＋1 條略過（`parse.eval` 仍待真實收據樣本），`pnpm test regression` 17 條不變，DB 實查 `report.grandTotal` 741,294.25 與歷史斷言一致，並用瀏覽器對 4 項修復逐一實測（`occurredAt` 保留 paidAt 日期、公費幣別無匯率時建立公費池被清楚拒絕、匯出路由對不存在的行程回傳 404 而非 500、勾選/取消「由公費支付」正確鎖定並還原幣別欄位）
- 2026-08-25 P4 對抗式審查修正清單（8 角度並行 agent＋逐一驗證，9 個 CONFIRMED 已修＋1 個 PLAUSIBLE 刻意不修）：①`write.ts` `createExpense`／`updateExpense` 建立/重建 FundEntry 時明確帶入 `occurredAt: new Date(input.paidAt)`，不再依賴 schema 預設值 ②`createFund()` 建立當下查行程固定匯率，公費幣別若不等於記帳幣且沒有對應固定匯率就清楚拒絕（訊息提示去行程設定新增匯率，或改用記帳幣建池）③`report.ts` 的 `categoryTotals` 原本用 `` `${category} ${currency}` `` 字串組 key 又 `.split(" ")` 拆回來，類別名稱本身含空格就會拆錯——改成 `Map<string, {category, currency, amountTwd}>` 直接存物件 ④三個匯出路由（csv/xlsx/pdf）補上行程存在性檢查，行程不存在回傳 404 `{error:"行程不存在"}`（比照 `api/parse/route.ts` 既有慣例），不再是原生 Prisma 例外冒出的泛用 500 ⑤`xlsx.ts` 新增 `toDisplayNumber()` 統一包一層 `roundForDisplay()`，修正原本只有兩三欄金額取整、其餘欄位跟 PDF 顯示對不上的問題 ⑥`report.ts` 的 `isPersonal` 判斷加上 `splitMode !== "BY_GROUP"` 條件，修正「組別剛好只有一人」的按組計價支出被同時算進分組支出與個人消費兩邊 ⑦`ExpenseForm.tsx` 用 `useRef` 記住勾選「由公費支付」前的幣別，取消勾選時換回去，修正原本卡在公費幣別上的問題 ⑧`report.ts` 移除多餘的第二次 `prisma.group.findMany` 查詢，改用已經查過的 `trip.members[].group` 資料建 Map（效率／重用／簡化三個角度都獨立抓到同一處）⑨`report.ts` 的 `ReportData.members` 欄位早就沒有任何 renderer 在讀，介面已刪但 return 敘述句忘了同步移除，順便清掉（同時修正這造成的 `pnpm typecheck` 失敗）。刻意不修：`deleteFundContribution(entryId)` 沒有驗證該筆是否屬於呼叫端預期的行程——跟 P3 收據 by-id 查詢同一類已接受的已知限制（多人共編需求明確後再一併處理），詳見 P3 完成日誌的對應記錄
- 2026-08-25 **P3 收據解析改用 Gemini**：使用者要求把收據解析從 Anthropic Claude 換成 Google Gemini。換之前先用多角度並行研究比較 Anthropic／OpenAI／Gemini／專用收據 OCR API 四個候選（查證 2026-08 現況），結論是四者皆缺「日文收據」專項驗證數據，這個缺口跟選哪家 API 無關，只能靠使用者實測補上；使用者知悉此結論後仍選擇現在就換，屬產品選擇非既有方案有問題。落地內容：`src/lib/parse/anthropic.ts` → `src/lib/parse/gemini.ts`（`@google/genai`，模型 `gemini-3.1-pro-preview`；結構化輸出改用 `config.responseJsonSchema` + Zod v4 內建 `z.toJSONSchema(ReceiptParseSchema)`，不必手刻第二份 schema；回應改自行 `JSON.parse` 後過 `ReceiptParseSchema.safeParse()`——不像 Anthropic `messages.parse()` 會自動驗證；拒答判斷改看 `promptFeedback.blockReason` 與 `candidates[0].finishReason !== "STOP"`）、`.env` 變數 `ANTHROPIC_API_KEY` → `GEMINI_API_KEY`、`package.json` 依賴替換（`pnpm remove @anthropic-ai/sdk && pnpm add @google/genai`）、測試檔 `tests/parse.anthropic.test.ts` → `tests/parse.gemini.test.ts`（依 Gemini 回應形狀重寫全部案例）、`tests/receipt.schema.test.ts` 的相容性測試改驗證 `z.toJSONSchema` 而非 `zodOutputFormat`。`docs/IMPLEMENTATION.md` §5.3 用新增 blockquote 記載改動，原 Anthropic 記載保留供對照，未刪除。落地後跑對抗式審查（8 角度平行 agent），抓到並修正 5 個真的問題：①`gemini-3.1-pro-preview` 不能關 thinking、thinking token 跟輸出 token 共用 `maxOutputTokens`，沿用 Anthropic 版的 2000 上限在真實收據上大機率會把預算用在思考、JSON 被截斷（`finishReason: MAX_TOKENS`）——查證後改用 `thinkingConfig.thinkingLevel: "LOW"` 壓低思考量，`maxOutputTokens` 調高到 8000 ②`z.toJSONSchema(ReceiptParseSchema)` 產出的 `const`（tax_rate literal union）與 `pattern`（datetime 正則）查證後是 Gemini `responseJsonSchema` 支援度最不確定的兩個關鍵字，加 `sanitizeSchemaForGemini()` 把 `const` union 收斂成語意相同、各方文件一致列為支援的 `enum`，`pattern` 直接拿掉（生成時不強制格式，靠本機 zod 驗證兜底，跟 confidence min/max 本來就不保證生成時守住是同一套設計）③`@google/genai` 不像 Anthropic SDK 預設就對 429/5xx 自動重試——查過 SDK 原始碼確認，補上 `httpOptions.retryOptions` ④`tests/receipt.schema.test.ts` 移植後的相容性測試只斷言「不拋出例外」，但 `z.toJSONSchema` 對 `z.record(...)` 也不會拋出（跟被取代的 `zodOutputFormat` 不同，那個真的會拋），等於原本要釘住「confidence 不能改回 record」這個迴歸測試失效了——改成直接斷言 `additionalProperties === false` ⑤`docs/CLOUD_SETUP.md`（正在用的雲端 VM 部署指南）與 `README.md` 都還留著 `ANTHROPIC_API_KEY`，照著做會導致 VM 上收據解析永遠悄悄失敗，一併修正；連帶補上 `route.ts`／`actions.ts` 兩處殘留的 Anthropic 註解、`gemini.ts` 的 client 快取改綁 `globalThis`（比照 `db.ts` 的 Prisma 單例，撐過 dev 模式 HMR）。有 2 個查出但刻意不修：MAX_TOKENS 目前跟安全機制拒答共用同一個「非 STOP 即失敗」判斷、本機驗證比 Anthropic 版更嚴格所以近似正確的輸出更容易整包被判失敗——兩者都需要更多真實資料才知道要不要投入，先記錄不動。全部修完後 `pnpm lint`／`pnpm typecheck`／`pnpm build` 全過，`pnpm test` 154 條全綠＋1 條略過（`parse.eval` 仍 0 筆真實樣本），`pnpm test regression` 17 條不變。尚待補的缺口跟 P3 完成當時一樣未變：真實日文收據的端到端驗證需要使用者自己拍照測試，換供應商不會自動補上這個缺口——而且這次審查也發現，如果 thinking/schema 兩個問題沒抓到，光靠 mock 測試綠燈完全看不出真實 API 呼叫其實會系統性失敗，真實驗證的重要性又更高一層。
- 2026-08-24 **P3 完成**：拍照/選圖 → 壓縮＋EXIF → 上傳 → Anthropic Structured Outputs 解析 → 確認頁預填＋confidence<0.8 標紅 → 確認入帳建 Expense+LineItems、回填 Receipt.expenseId → 重新解析。用合成收據圖與手植 DB 資料完整驗證整條管線（無法用真實 API 呼叫測，見下）。101→151 條測試（新增 30 條），regression 17 條不變，`pnpm build` 通過，DB 實查 741,294.25／741,294／守恆差額 0
- 2026-08-24 P3 兩處與 §5.3 規格不同（載入 claude-api 技能查證後決定）：①模型改用 `claude-sonnet-5`（§5.3 原寫 `claude-sonnet-4-6` 不支援 Structured Outputs）②改用 `client.messages.parse()` + `output_config.format` 取代「提示詞說只准輸出 JSON、自己 parse 再驗」，API 端直接保證格式正確。連帶把 `ReceiptParseSchema.confidence` 從開放式 `z.record()` 改成固定六欄位物件——Structured Outputs 要求所有 object 都要 `additionalProperties:false`，record 天生不相容
- 2026-08-24 P3 完成定義**有一項做不到，需使用者親自補**：「手機實拍一張日文收據能走完全流程」——沒有真實手機與收據照片，也沒有設定 `ANTHROPIC_API_KEY`。已用合成測試圖驗證上傳／降級路徑（HTTP 200、Receipt 正確存檔），並用手植 DB 資料驗證解析成功後的預填／標紅／LineItem 建立／Receipt 回填全部正確；唯獨「Claude 真的看得懂一張日文收據」這件事未經驗證。`fixtures/receipts/` 同理：結構與 `tests/parse.eval.ts` 已就緒，0 筆真實樣本，`RUN_PARSE_EVAL=1 pnpm test parse.eval` 算不出有意義的數字
- 2026-08-24 P3 對抗式審查（8 角度平行 agent＋逐一驗證）抓到並修正 3 個真的 bug：①`resolveUnitPrice` 用裸 JS float 除法算金額，違反金額鐵律 1（改用 `Money().dividedBy()`，一併拿掉多餘的 `receiptNumberToDb` 間接層）②`reparseReceiptAction` 寫好但沒接任何按鈕，「重新解析」功能形同不存在（補 UI 按鈕，並補齊它原本缺的 ActionState 錯誤處理慣例）③同一張收據可被重複送出建出兩筆支出、Receipt.expenseId 只會指向較晚寫入那筆，第一筆的收據關聯悄悄弄丟（在交易外先查 `Receipt.expenseId` 是否已非 null，非法時清楚拒絕）。三者皆已用真實瀏覽器操作＋新增測試驗證修好
- 2026-08-24 P3 已知限制（記錄但未修，等公開服務／多人共編需求明確時再處理）：`loadReceipt` 依 receiptId 全域查找、未驗證是否屬於當前 tripId——目前僅靠 cuid 不可猜測性防護，若使用者同時開著兩個行程分頁，理論上可把 A 行程的收據網址帶進 B 行程消費掉其品項與金額；LineItem 目前無使用者複查/編輯介面，confidence 低的品項會直接原樣入庫，只有 Expense 層級的四個欄位（店名/日期/金額/幣別）會標紅
- 2026-08-24 **P2 完成**：行程/成員/組別/支出 CRUD、匯率三源 UI（TRIP_FIXED 自動套用、MANUAL 手動輸入、DAILY_REF 送出時自動查參考匯率）、支出即時分攤預覽（瀏覽器端直接呼叫與落地時相同的 `money/convert`＋`split`，數字保證一致，已用瀏覽器實測：3000 JPY 預覽 75/人 → 送出後 10 人小計各自精準 +75）。用瀏覽器對 seed 的新潟資料實測整輪 CRUD（新增/編輯/篩選），完成後恢復原始資料，`pnpm test regression` 仍 17 條全綠、DB 實查 741,294.25／741,294／守恆差額 0
- 2026-08-24 P2 產品範圍裁示：使用者澄清這是「旅途當下」記帳分帳服務、未來要公開給大眾、不侷限單一行程。因此①不加「個人消費預估」欄位——那是新潟預算表的產物非產品功能，旅途消費就是記一筆一人參與的普通支出；P2 完成定義相應改為「總覽頁每人**分攤小計**」而非含預算的迴歸總額 73,635 ②暫不做帳號系統（Trip 無 ownerId），但所有查詢天生 `tripId` scoped、路由都在 `/trips/[id]/...` 下，之後加擁有者是加欄位+守門、不必重寫
- 2026-08-24 P2 實測抓到並修正兩個問題：①`MemberItem` 把 `<DeleteButton>`（內部含 `<form>`）塞進更新表單裡，`<form>` 巢狀 `<form>` 導致 hydration 崩潰，改成兩個平行表單 ②`pnpm build` 顯示 `/trips` 被判定為靜態頁、build 當下把行程清單拍照凍結——`next start` 後新行程不會出現，`pnpm dev` 完全看不出來，加 `export const dynamic = "force-dynamic"` 修正。兩者都提醒：CRUD 頁面完工要跑一次 `pnpm build`＋瀏覽器實測，不能只看 lint/typecheck/test 過
- 2026-08-24 P2 已知限制（寫在對應程式碼註解裡，非遺漏）：EQUAL/WEIGHT 模式付款人必須在分攤名單內，無法表達「代墊但不參與」；BY_GROUP 因 schema 未存 groupId，編輯既有支出靠現有組別成員名單反推當初選的組別，組別異動後可能推不出來；`paidAt` 用 `<input type="datetime-local">`（無時區資訊），伺服器以其執行環境的本機時區解析——單機使用沒問題，未來多時區公開服務需要重新設計這段
- 2026-08-24 專案文件初始化（CLAUDE.md / IMPLEMENTATION.md / PROMPTS.md）
- 2026-08-24 專案定名「道中記 Dōchūki」（repo：dochuki），已查證 App 商店與常見命名空間無衝突
- 2026-08-24 Phase 0 腳手架完成：Next.js 15.5.23 + TS strict + Tailwind 4 + pnpm 11、Prisma 7.9.1（空 schema）、vitest 4、docker-compose（postgres:16）、§3 目錄骨架、README。lint／typecheck／test 全綠
- 2026-08-24 專案路徑由 `OneDrive\文件\個人研發專案\dochuki-kit` 移至 `OneDrive\dev\dochuki`。原因：pnpm 在含非 ASCII 字元的路徑下安裝必定崩潰（0xC0000409，崩於寫入 virtual store 階段）。已實測排除 OneDrive、pnpm 版本、MAX_PATH、Node 版本四項因素，唯一變因為路徑中的中文字。新路徑仍在 OneDrive 內正常同步
- 2026-08-24 **待辦（P1 動 schema 時處理）**：Prisma 7 已棄用 `prisma-client-js`，實際產生的 generator 為 `prisma-client` 且 `output` 為必填。IMPLEMENTATION.md §4 的 generator 區塊需同步更新
- 2026-08-24 **Phase 1 完成**：schema 依 §4 落地並 migrate（`20260824053527_init`）、`src/lib/money/` 五模組、新潟 fixture 與 seed、82 條測試全綠（迴歸 17 條）、`/money-audit` 無違規。DB 實查亦重現全部斷言（741,294.25／741,294／¥2,965,177，逐筆守恆差額 0）
- 2026-08-24 **P1 裁示（規格衝突）**：IMPLEMENTATION.md §4「所有模式輸出以 2 位小數落地」與迴歸期望值矛盾——住宿B（¥249,821×0.25÷10＝6,245.525）在 2dp 下進位成 6,245.53，使「每人共同分攤 65,305.025」等斷言全部失準。已改為 **6 位小數落地**（與 `Decimal(18,6)` 欄位一致），2dp 降級為顯示／匯出層職責。§4 該句需同步更正
- 2026-08-24 **階段編號對齊**：三份文件原本說法不一（本檔與 IMPLEMENTATION.md §9 把拍照解析當 Phase 2、PROMPTS.md 是 §P3；§9 把 CRUD 列在 P1 但 §P1 範圍不含 CRUD；§9 原缺 PWA 階段）。裁示以 **PROMPTS.md 為權威**，全面改為 P0 腳手架／P1 資料模型與引擎／P2 記帳 CRUD／P3 拍照解析／P4 報表與公費／P5 PWA／P6 強化。已同步 CLAUDE.md、IMPLEMENTATION.md §1/§2/§5.4/§8/§9、PROMPTS.md、README.md、.env.example、`summary.ts`、`input.json`、首頁文案
- 2026-08-24 GitHub remote 設為 `https://github.com/fsc0638/dochuki.git`（小寫，符合命名規則）。**尚未推送**；GitHub 上的 repo 名稱仍為 `DochuKi`，待手動更名
- 2026-08-24 P1 收尾補 DB 邊界護欄 `src/lib/money/fromDb.ts`（101 條測試全綠）。實作時發現 schema 有三種小數位數——金額 6 位、匯率 8 位（`rateUsed`/`FxRate.rate`）、係數 4 位（`weight`/`qty`/`taxRate`）——統一用 6 位會靜默截斷匯率，故提供三個對應的寫入函式。慣例已寫入上方「程式慣例」
- 2026-08-24 **P1 新增規格待補**：①「每人共同分攤 65,305.025」實際組成含公費 7,500 與個人消費 35,000，名稱易誤導 ②個人消費預估在 §4 schema 無對應欄位，P3 報表「區塊三個人消費」需要它 ③Prisma 7 的 Rust-free client 必須搭配 driver adapter（`@prisma/adapter-pg`），P2 需抽共用 client 模組 ④Prisma 回傳的 Decimal 精度為 20 位、與本專案 Money 的 40 位不同，讀取邊界應先 `new Money(x.toString())` 正規化
- 2026-08-24 Docker Desktop 安裝完成，P0 完成定義全數驗證通過：容器 `dochuki-db`（postgres:16）healthy、`prisma migrate dev` 連線成功、實測寫入讀回 `numeric(18,6)` 精度與中文均正確。**本機 5432 已被既有的 PostgreSQL 18 Windows 服務（`postgresql-x64-18`，開機自啟）占用，故容器對外映射改為 5442**，`DATABASE_URL` 同步改為 `localhost:5442`；此處偏離 IMPLEMENTATION.md §10 記載的 5432，§10 需同步更新
