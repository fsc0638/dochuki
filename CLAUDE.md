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
- 收據解析：Anthropic API（vision）→ zod 驗證的結構化 JSON（schema 見 IMPLEMENTATION.md §5）
- 匯率：Frankfurter API（`api.frankfurter.dev`）+ 行程固定匯率 + 手動輸入，三源並存
- 後續（P6）：解析服務抽為 Python sidecar（PaddleOCR ONNX），資料層遷入既有 Rust/PG 平台

## 常用指令

```bash
docker compose up -d          # 啟動 PostgreSQL
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
- [ ] P2 記帳 CRUD 與多幣別 UI（§P2）
- [ ] P3 拍照解析（§P3）
- [ ] P4 報表輸出（CSV/xlsx/PDF）與公費池（§P4）
- [ ] P5 PWA 與收尾（§P5）
- [ ] P6 強化：自架 OCR sidecar、離線佇列、清償計畫（PROMPTS.md 無對應段落，見 IMPLEMENTATION.md §9）

（完成一項就把勾打上，並在下方追加一行日期＋摘要）

### 進度日誌
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
