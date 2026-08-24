# 道中記 Dōchūki

以手機為主要情境的旅遊記帳 PWA。拍照收據 → AI 解析與翻譯 → 逐欄確認 → 入帳分攤 → 匯出 CSV / Excel / PDF 彙整總表。支援多幣別、群組分攤、公費池。

- 專案憲法與金額鐵律：[CLAUDE.md](CLAUDE.md)
- 詳細規格：[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)
- 各階段開發提示詞：[docs/PROMPTS.md](docs/PROMPTS.md)

目前進度：**P1 完成**（資料模型、分攤引擎、新潟迴歸測試全綠）。下一步 P2 記帳 CRUD 與多幣別 UI。階段編號見 [docs/PROMPTS.md](docs/PROMPTS.md)。

## 前置需求

| 工具 | 版本 |
|---|---|
| Node.js | >= 20 |
| pnpm | 11.x |
| Docker | 需能執行 `docker compose`（起 PostgreSQL 16） |

## 啟動

```bash
pnpm install
```

```bash
cp .env.example .env
```

`.env` 的 `DATABASE_URL` 預設值已對應 `docker-compose.yml`，本機開發不需修改。`ANTHROPIC_API_KEY` 到 P3 拍照解析才會用到。

> **連接埠note**：容器對外映射 **5442**（非 IMPLEMENTATION.md §10 記載的 5432）。開發機的 5432 已被既有的 PostgreSQL 18 Windows 服務（`postgresql-x64-18`）占用，兩者互不影響。

```bash
docker compose up -d
```

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

## 目錄結構

```
dochuki/
├─ docker-compose.yml     # postgres:16
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
