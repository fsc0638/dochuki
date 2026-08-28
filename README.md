# 道中記 Dōchūki

以手機為主要情境的旅遊記帳 PWA。拍照收據 → AI 解析與翻譯 → 逐欄確認 → 入帳分攤 → 匯出 CSV / Excel / PDF 彙整總表。支援多幣別、群組分攤、公費池。

- 專案憲法與金額鐵律：[CLAUDE.md](CLAUDE.md)
- 詳細規格：[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)
- 各階段開發提示詞：[docs/PROMPTS.md](docs/PROMPTS.md)

目前進度：**P0–P6 全數完成**（PWA 可安裝、Docker 容器化部署、清償計畫、離線佇列、PaddleOCR sidecar）。階段編號見 [docs/PROMPTS.md](docs/PROMPTS.md)。

## 前置需求

| 工具 | 版本 |
|---|---|
| Node.js | >= 22.13 |
| pnpm | 11.x |
| Docker | 需能執行 `docker compose`（起 PostgreSQL 16） |

## 啟動

```bash
pnpm install
```

```bash
cp .env.example .env
```

`.env` 的 `DATABASE_URL` 預設值已對應 `docker-compose.yml`，本機開發不需修改。`GEMINI_API_KEY` 到 P3 拍照解析才會用到。

> **連接埠note**：容器對外映射 **5442**（非 IMPLEMENTATION.md §10 記載的 5432）。開發機的 5432 已被既有的 PostgreSQL 18 Windows 服務（`postgresql-x64-18`）占用，兩者互不影響。

```bash
docker compose up -d db
```

只起資料庫；`app` 服務是給下方「部署」章節的容器化跑法用的，本機開發用 `pnpm dev` 即可，不需要建置 app 的映像。

```bash
pnpm prisma migrate dev
```

```bash
pnpm dev
```

開 http://localhost:3000 。

## 常用指令

```bash
pnpm dev                      # 開發伺服器
pnpm build                    # 正式建置
pnpm lint                     # ESLint
pnpm typecheck                # tsc --noEmit
pnpm test                     # vitest 全部測試
pnpm test regression          # 只跑金額迴歸測試（改動任何金額邏輯後必跑）
pnpm prisma migrate dev       # 建立/套用 migration
```

停掉資料庫（保留資料）：

```bash
docker compose down
```

連同資料一併刪除：

```bash
docker compose down -v
```

## 部署

一鍵起全套（app + db）容器化跑法，適合單機自架（例如雲端 VM）。

```bash
cp .env.example .env   # 填入 GEMINI_API_KEY，其餘可留預設
docker compose up -d --build
```

`app` 服務的 `DATABASE_URL` 是寫死在 `docker-compose.yml` 裡指向 compose 內部網路的
`db:5432`（跟本機開發用的 `localhost:5442` 不是同一個，不需要也不應該去改 `.env`
裡那份），`GEMINI_API_KEY`／`FX_API_BASE` 才是從 `.env` 讀進去的。

`ocr-sidecar`（P6 新增，PaddleOCR 收據 OCR）隨這條指令自動一起建置啟動，不需要
另外的手動步驟；`app` 連它的位址（`OCR_SIDECAR_URL=http://ocr-sidecar:8000`）同樣
寫死在 `docker-compose.yml`，不吃 `.env`。它不對外開 port，僅供 `app` 內部呼叫；
sidecar 若掛掉或還沒 ready，收據解析會自動降級成原本的 Gemini 全圖辨識路徑，不影響
既有功能。

首次啟動需手動套 migration（容器不會自動跑，避免每次重啟都嘗試 migrate）：

```bash
docker compose exec app prisma migrate deploy
```

（不是 `pnpm exec prisma migrate deploy`——runtime image 的 `PATH` 已經掛進
`node_modules/.bin`，直接呼叫執行檔即可；`pnpm exec`／`pnpm run` 在這個容器裡會
誤判 node_modules「沒裝好」而觸發整套重新 install，見 Dockerfile 內的說明。）

開 `http://<主機位址>:${APP_PORT:-3000}`（預設 3000；本機這台開發機因為 3000 是
Windows 保留的排除 port range 綁不了，`.env` 裡設了 `APP_PORT=3010`）。

停掉／移除：

```bash
docker compose down        # 保留資料
docker compose down -v     # 連同 DB 與收據儲存的 volume 一併清除
```

**PWA 安裝**：`manifest.json` + `public/sw.js` 只快取靜態殼層（JS/CSS bundle、
icons），頁面與帳務資料一律不快取，帳務金額永遠讀最新的。Service Worker 只在
正式環境（`NODE_ENV=production`）註冊，`pnpm dev` 不會註冊——用上面容器化部署起
來的網址（不是 `pnpm dev`）搭配 Chrome DevTools 的 Application／Lighthouse 面板
確認 manifest 與 Service Worker 皆正確註冊。手機瀏覽器要能跳出「加入主畫面」，
需要透過 HTTPS 或至少同網段存取——這個服務本身沒有另外處理網域／SSL，請依部署
環境自行加一層反向代理（nginx／Caddy／Cloudflare Tunnel 皆可）。

**容器內 PDF 匯出**：Dockerfile 的 runtime 階段已內建 Chromium 與其系統依賴
（`playwright install --with-deps chromium`），匯出 PDF 不需要額外設定。

## 目錄結構

```
dochuki/
├─ docker-compose.yml     # postgres:16 + app + ocr-sidecar（一鍵起全套）
├─ Dockerfile             # app 多階段建置（含 Playwright/Chromium）
├─ services/
│  └─ ocr-sidecar/        # PaddleOCR 收據 OCR sidecar（P6，FastAPI + RapidOCR）
├─ public/                # manifest.json、icons、sw.js（PWA 殼層快取）
├─ prisma/                # schema、migration、seed（新潟迴歸 fixture）
├─ prisma.config.ts       # Prisma 7 設定（schema/migration/datasource 位置）
├─ fixtures/
│  ├─ niigata/            # 新潟迴歸案例輸入與期望值
│  └─ receipts/           # 收據測試圖與人工標註
├─ src/
│  ├─ app/                # Next.js App Router
│  ├─ lib/
│  │  ├─ money/           # ★ 所有金額運算唯一入口
│  │  ├─ schemas/         # zod 驗證
│  │  ├─ parse/           # 收據解析
│  │  ├─ fx/              # 匯率
│  │  └─ export/          # CSV / xlsx / PDF
│  └─ components/
└─ tests/
```

## 專案路徑限制（重要）

**專案路徑不可含非 ASCII 字元。** pnpm 在含中文（或其他非 ASCII 字元）的路徑下安裝時，會在寫入 virtual store 階段使行程硬當機（`STATUS_STACK_BUFFER_OVERRUN` / `0xC0000409`），無設定可繞過。

已實測排除的因素：與 OneDrive 無關、與 pnpm 版本無關（10／11 皆然）、與 `MAX_PATH` 無關（`LongPathsEnabled=1`，同長度 ASCII 路徑正常）、與 Node 版本無關（同一個 Node 跑 `npm install` 完全正常）。唯一變因就是路徑中的非 ASCII 字元。

本專案因此置於 `C:\Users\kicl1\OneDrive\dev\dochuki`（純 ASCII，仍在 OneDrive 內正常同步）。搬移專案時請維持這個限制。
