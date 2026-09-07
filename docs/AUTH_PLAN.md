# 帳號系統實作計畫（P7）

> 本檔是計畫與 checklist，**尚未執行任何步驟**，寫於 2026-09-07。
> 體例沿用 `docs/CLOUD_SETUP.md`：先講結論與取捨，再列步驟，最後記已知限制。
>
> 階段編號 P7 是新的——`docs/IMPLEMENTATION.md` §「非目標」目前把帳號系統
> 列在 P6 之後不做，本計畫落地時需同步更新該處與 `docs/PROMPTS.md`。

## 為什麼現在做

正式站已經跑在雲端 VM 上（見 `CLOUD_SETUP.md`「自動同步與正式站部署」），
但刻意只綁 `127.0.0.1:3100` 不對外。原因就是沒有帳號系統：這個服務目前
任何人拿到網址就能看與改行程和金額資料。**帳號系統是對外公開的前置條件，
不是錦上添花。**

P2 當時（2026-08-24）的裁示已經預留了這條路：

> 暫不做帳號系統（Trip 無 ownerId），但所有查詢天生 `tripId` scoped、
> 路由都在 `/trips/[id]/...` 下，之後加擁有者是加欄位+守門、不必重寫。

這個判斷成立。實際盤點後要補的東西比「加欄位+守門」多一些，但架構確實不用重寫。

## 核心決定：登入身分與分攤身分分開

**`Member` 維持現狀，不動它。** 現在的 `Member` 只有 `name` 一個識別欄位，
從屬於單一 `Trip`，同一個真人參加兩趟行程就是兩筆獨立的列。這個設計對
分攤引擎是對的，不該為了帳號去改它。

新增 `User` 當登入身分，用 `TripMembership` 把兩者綁起來：

```
User（登入身分，跨行程唯一）
  └─ TripMembership（一個 User 在一個 Trip 裡的角色）
       └─ memberId ──> Member（這個人在該行程的分攤身分）
```

**這樣做的最大好處：`src/lib/money/` 一行都不用改。** 分攤、清償、報表全部
繼續以 `memberId` 為準，`pnpm test regression` 的 17 條斷言天生保持全綠，
不需要為帳號系統重跑金額驗證。

## 資料模型

四張新表，既有的表只有 `Receipt` 需要加欄位（見下方「必須改 schema 的地方」）。

```prisma
model User {
  id           String   @id @default(cuid())
  email        String?  @unique   // 密碼帳號才有；邀請進來的帳號為 null
  passwordHash String?            // 同上
  displayName  String
  createdAt    DateTime @default(now())
  sessions     Session[]
  memberships  TripMembership[]
}

model Session {
  id         String   @id @default(cuid())
  tokenHash  String   @unique     // 只存 SHA-256，不存原 token
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt  DateTime
  lastSeenAt DateTime @default(now())
  userAgent  String?
  createdAt  DateTime @default(now())

  @@index([userId])
}

enum TripRole {
  OWNER    // 建立者：可改設定、邀請、刪行程
  EDITOR   // 一般團員：可記帳、改自己與他人的支出
  VIEWER   // 只能看
}

model TripMembership {
  id       String   @id @default(cuid())
  tripId   String
  trip     Trip     @relation(fields: [tripId], references: [id], onDelete: Cascade)
  userId   String
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  memberId String?  @unique      // 綁到該行程的哪個 Member
  member   Member?  @relation(fields: [memberId], references: [id])
  role     TripRole @default(EDITOR)
  joinedAt DateTime @default(now())

  @@unique([tripId, userId])
}

model Invite {
  id        String    @id @default(cuid())
  tripId    String
  trip      Trip      @relation(fields: [tripId], references: [id], onDelete: Cascade)
  memberId  String                    // 具名：這張券就是給這位成員的
  member    Member    @relation(fields: [memberId], references: [id])
  role      TripRole  @default(EDITOR)
  tokenHash String    @unique         // 同樣只存雜湊
  expiresAt DateTime
  maxUses   Int       @default(5)
  usedCount Int       @default(0)
  revokedAt DateTime?
  createdBy String                    // User.id
  createdAt DateTime  @default(now())
}
```

**不加 `Trip.ownerId`**。擁有者用 `TripMembership.role = OWNER` 表達即可，
多一個欄位就多一個要維持同步的真相來源。代價是「查這趟誰是團長」要 join
一次，這個成本在本專案的資料量下無所謂。

## 兩種登入

### 密碼登入（自行註冊）

- 雜湊用 **Node 內建的 `scrypt`**（`node:crypto`），不引入原生相依套件。
  `bcrypt` 要 node-gyp 編譯、`argon2` 要原生模組，VM 是 aarch64，本專案在
  ARM 上已經吃過苦頭（見 `CLOUD_SETUP.md` ARM 相容性章節），沒必要為了
  邊際的強度差異再賭一次。`scrypt` 強度足夠且零風險。
- 登入失敗要限制次數，否則等於開放線上猜密碼。以 email 與來源 IP 兩個維度
  各自計數即可，存 DB 不必另外架 Redis。

### 邀請登入（**具名且可重複使用**，2026-09-07 使用者裁示）

團長在成員管理頁對著某位 `Member` 按「產生邀請連結」，得到一組帶 token 的
網址，透過 LINE 之類的管道傳給本人。對方開啟後看到「你是〈成員名〉，確認
加入這趟行程？」，確認即建立一個 `passwordHash` 為 null 的 `User`、寫入
`TripMembership`、簽發 session。

選這個方案而非「一次性認領」的理由：旅途中換手機、清 cookie、用平板再開
一次都是常態，一次性連結會讓團長不斷被要求重發。可重複使用搭配**到期日、
可用次數上限、隨時可撤銷**三道閘門，是實務上的平衡點。

**必須認清的事：這是一個「知道網址就能進」的憑證。** 被截圖轉發、留在
瀏覽器紀錄、共用裝置，都等於身分外流。所以：

- 預設到期日不要長（建議 7 天，且不超過行程結束日）
- `maxUses` 給小的預設值（5），用完自動失效
- 團長頁面要能看到每張券的使用次數並隨時撤銷
- **被邀請者拿不到 OWNER**，不能改行程設定、不能刪行程、不能再邀請別人

## Session 機制

- httpOnly cookie 裝一組 256-bit 隨機 token，DB 只存 `sha256(token)`。
  DB 外洩不等於 session 被冒用。
- `SameSite=Lax`。`Secure` 旗標**依環境開關**——現在走 SSH tunnel 是純
  HTTP，開了會直接登不進去；等 P7.5 掛上 TLS 再固定開啟。
- 滑動到期：每次驗證更新 `lastSeenAt`，超過 30 天未使用即失效。
- CSRF：Server Actions 有 Next.js 內建的 origin 檢查；`POST /api/trips/[id]/expenses`
  是自己寫的 route handler，靠 `SameSite=Lax` 擋跨站表單提交即可，但要
  明確驗證 `Content-Type: application/json`（簡單表單無法送出這個型別）。

## 要守門的進出口：31 處

| 類型 | 數量 | 備註 |
|---|---|---|
| Route handlers | 5 | `api/parse` 與三支 export、一支離線補送 |
| Server Actions | 14 | 分散在 5 個 `actions.ts` |
| 頁面（page.tsx） | 12 | 含 `/` 的 redirect |

Route handlers：

| 檔案 | 用途 |
|---|---|
| [api/parse/route.ts:21](../src/app/api/parse/route.ts) | 收據上傳與解析 |
| [api/trips/[id]/expenses/route.ts:16](../src/app/api/trips/[id]/expenses/route.ts) | 離線佇列補送專用 |
| [api/trips/[id]/export/csv/route.ts:7](../src/app/api/trips/[id]/export/csv/route.ts) | CSV 匯出 |
| [api/trips/[id]/export/xlsx/route.ts:7](../src/app/api/trips/[id]/export/xlsx/route.ts) | Excel 匯出 |
| [api/trips/[id]/export/pdf/route.ts:7](../src/app/api/trips/[id]/export/pdf/route.ts) | PDF 匯出 |

**`api/parse` 要優先處理**：它會呼叫 Gemini，沒守門等於任何人都能燒掉
API 額度，這是唯一一個「被濫用會直接產生帳單」的端點。

### 守門要靠型別強制，不能靠自律

31 個點靠「每個地方記得呼叫檢查函式」遲早會漏一個，而漏掉的那個不會有任何
症狀，直到被人發現。建議讓資料存取層的函式簽章強制接收一個身分情境參數，
漏掉就是 `pnpm typecheck` 失敗，而不是安全漏洞。

再配一支測試，列舉 `src/app` 底下所有 route/action/page，斷言每一個都經過
守門。這符合本專案既有的測試文化（`tests/` 已有 17 條金額迴歸與各層單元測試）。

**注意：守門不能只包在 `src/lib/trips/` 裡。** 有 6 個進出口繞過資料層直接
碰 Prisma：三支 export route 各自 `prisma.trip.findUnique`、`api/parse/route.ts`
直接 `receipt.create`、`receipts/actions.ts` 直接 `receipt.findUniqueOrThrow`。
這些檔案要自己被納入強制範圍。

## 必須先修的既有問題（P7.0）

以下三類都**不改行為**，可以在帳號系統落地前先合併，讓 P7 後續階段站在
乾淨的地基上。

### 一、六個寫入函式沒有行程歸屬驗證

| 函式 | 位置 |
|---|---|
| `deleteGroup(groupId)` | [write.ts:103](../src/lib/trips/write.ts) |
| `updateMember(memberId, …)` | [write.ts:122](../src/lib/trips/write.ts) |
| `deleteMember(memberId)` | [write.ts:144](../src/lib/trips/write.ts) |
| `updateExpense(expenseId, …)` | [write.ts:441](../src/lib/trips/write.ts) |
| `deleteExpense(expenseId)` | [write.ts:495](../src/lib/trips/write.ts) |
| `deleteFundContribution(entryId)` | [write.ts:558](../src/lib/trips/write.ts) |

上層 action 其實都有拿到 `tripId`，但只拿去 `revalidatePath`，沒用來驗證。
修法一致：把 `tripId` 下推成必要參數，放進 where 條件一併比對。

CLAUDE.md 先前只記載了其中一個（`deleteFundContribution`，P4 對抗式審查抓到
但刻意不修，理由是「等多人共編需求明確後再一併處理」）。實際盤點後是六個，
條件現在成立了。

### 二、`listTrips()` 是無條件 `findMany`

[load.ts:32](../src/lib/trips/load.ts) 目前列出資料庫裡**所有**行程。多使用者
的那一刻，`/trips` 會讓每個人看到別人的旅程清單。這是最醒目的一處，優先度
高於前面六個。改成以 `TripMembership` 過濾。

### 三、`Receipt` 沒有 `tripId`，這是 schema 問題

`Receipt` 表只有 `expenseId`（且可為 null）。剛上傳、還沒建立支出的收據
**與任何行程都沒有關聯**，所以現在連「這張收據屬不屬於我的行程」這個問題
都問不出來——不是查詢寫錯，是資料模型缺一塊。

`/trips/[id]/expenses/new?receiptId=xxx` 直接拿 query string 的 `receiptId`
呼叫 `loadReceipt`，未驗證歸屬。CLAUDE.md 2026-08-24 記過這個限制，當時的
防護只有「cuid 不可猜測」。

要做的事：

1. `Receipt` 加 `tripId` 欄位並建立關聯
2. 回填既有資料：已綁支出的從 `Expense.tripId` 推回去
3. **孤兒收據**（上傳後從未建立支出的）推不出歸屬，要裁示是刪除還是保留為
   不可存取。建議刪除，那些是使用者放棄的上傳。
4. `api/parse/route.ts` 建立 `Receipt` 時直接寫入 `tripId`（它本來就收到了）

## 既有資料的遷移

**這一步漏掉會當場把自己鎖在門外。** 開發環境的資料庫裡有新潟團的 seed 資料，
加上守門的瞬間，所有行程都會變成沒有任何 `TripMembership` 指向它們，等於
沒有人有權限存取。

migration 必須：

1. 建立第一個管理者 `User`（密碼由執行者當場輸入，不寫進版控）
2. 為每一趟既有的 `Trip` 建立一筆 `role = OWNER` 的 `TripMembership`
3. 既有的 `Member` 不自動綁 `User`——那是後續由團長發邀請券完成的事

正式站的資料庫是空的（只套 migration 不灌 seed），沒有這個問題。

## 確認不受影響的部分

以下是實際看過程式碼確認的，不需要為它們做事：

- **PDF 匯出**：[pdf/render.ts:50](../src/lib/export/pdf/render.ts) 用
  `page.setContent(html)` 直接餵 HTML，不是 `page.goto(url)`。字型走 `file://`、
  收據縮圖讀磁碟轉 base64 內嵌。headless 瀏覽器全程不打自己的 server，
  因此**不需要為它發內部憑證**。
- **Service Worker 快取**：只快取靜態殼層（`/_next/static/`、manifest、icons），
  頁面與帳務資料一律 network-only。不會有 A 使用者從快取讀到 B 使用者的資料。
- **`FxRate`**：全域共享表，不屬於任何行程，本來就沒有隔離需求。

## 需要處理的：離線佇列的 401

重放打的是 `POST /api/trips/[id]/expenses`，主執行緒（`offline/outbox.ts`）
與 Service Worker（`public/sw.js`）都用預設的同源 `fetch`，**會自動夾帶
cookie**。所以 cookie session 不需要為離線佇列另外設計攜帶方式。

要改的是語意：現在的邏輯是「HTTP 非 2xx → 寫入 `lastError` 留在佇列」，
session 過期回的 401 會被歸類成「這筆資料有問題」。應該把 401 特別處理，
保留項目但提示「請重新登入後再同步」，而不是顯示成一筆壞掉的帳。

另外，IndexedDB 的佇列是**依裝置**存的。同一台裝置換人登入時，前一個使用者
未送出的項目還在。登出時要清空佇列，或把 store 依 `userId` 分隔。

## 分期

沿用一階段一分支的做法。

| 階段 | 內容 | 完成定義 |
|---|---|---|
| **P7.0** | 六個函式下推 `tripId`、`listTrips` 改成可過濾、`Receipt` 加 `tripId` 並回填 | 行為不變，`pnpm test regression` 17/17 不變 |
| **P7.1** | 四張表、migration（含既有行程收編）、session 簽發與驗證、`scrypt` 雜湊 | 可用指令建立帳號並取得有效 session |
| **P7.2** | 註冊／登入／登出頁、`middleware.ts` 做未登入導向、登入失敗次數限制 | 能用密碼登入登出 |
| **P7.3** | 團長發券與撤銷 UI、認領頁、綁定 `Member` | 用邀請連結能在另一台裝置加入並看到自己的分攤 |
| **P7.4** | 31 個進出口逐一守門、列舉測試、離線重放 401、登出清佇列 | 列舉測試全綠；用 A 帳號無法讀寫 B 的行程 |
| **P7.5** | 反向代理＋TLS＋OCI Security List 開 80/443 | 手機用真實網域連得到 |

P7.5 正好接上 `CLOUD_SETUP.md` 裡卡住的地方。**P7.4 沒有全綠之前不要做 P7.5**，
那等於把沒守門的服務放上公網。

## 尚未裁示的事項

以下兩項本計畫先採用預設，實作前若無異議即照此執行：

1. **密碼帳號的識別欄位**：暫定用 email。用 email 才有未來自助重設密碼的
   可能，但**目前沒有寄信管道**，所以忘記密碼只能由管理者手動重設。若不想
   收集 email，改成自訂帳號名亦可，代價是永遠只能手動重設。
2. **被邀請者能否再邀請別人**：暫定不行，發券限 `OWNER`。

已裁示：

- **邀請連結採具名且可重複使用**（2026-09-07）——綁定特定 `Member`，帶到期日
  與可用次數上限，團長可隨時撤銷。

## 相關文件

- `docs/CLOUD_SETUP.md`——正式站部署現況，以及對外公開前的前置條件
- `CLAUDE.md`——P2 帳號系統裁示、P3/P4 記載的已知越權限制
- `docs/IMPLEMENTATION.md` §「非目標」——落地時需同步移除「帳號系統」
