# syntax=docker/dockerfile:1
#
# 多階段建置。刻意不用 Next.js 的 output:"standalone"——那是靠靜態追蹤
# require() 決定要打包哪些 node_modules，Playwright 啟動瀏覽器時會動態
# spawn 一個獨立的 driver 行程並用執行期路徑找檔案，靜態追蹤抓不到，
# 追蹤出來的精簡版經常在容器裡啟動瀏覽器失敗。runtime 階段改保留完整的
# production node_modules，用「跟本機開發一樣的安裝方式」換取可靠性，
# 犧牲的只是映像大小。

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate

# ---- deps：含 devDependencies，build 階段要用 ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- prod-deps：從 deps 已經裝好的 node_modules 剪掉 devDependencies，
# 不是另開一個 stage 重新 install 一次——同一份 lockfile 沒必要跟 registry
# 要兩次相同的套件 ----
FROM deps AS prod-deps
RUN pnpm prune --prod

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# collect page data 階段會匯入 src/lib/db.ts，模組頂層的
# `createClient()` 需要看到非空字串——不必連得到，PrismaPg／PrismaClient
# 建構時都不會真的連線（見 src/lib/db.ts 說明），純粹是為了通過建置期的
# 存在性檢查，這個值不會被複製進 runtime stage
ENV DATABASE_URL=postgresql://build:build@build.invalid:5432/build
RUN pnpm prisma generate
RUN pnpm build

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
# 直接呼叫 node_modules/.bin 底下的執行檔，不透過 `pnpm exec`／`pnpm run`——
# pnpm 11 這兩者都會先做一次 deps status check，這裡的 node_modules 是從別的
# build 階段複製過來的、沒有本機安裝紀錄，check 會誤判成沒裝好而觸發整套
# 重新 install，連帶撞到 ERR_PNPM_IGNORED_BUILDS。用 PATH 掛進去，容器內
# 之後不管跑 `playwright`、`next`、還是 `docker compose exec app prisma
# migrate deploy` 都一體適用，不必每個呼叫點各自記得補 node_modules/.bin/ 前綴
ENV PATH="/app/node_modules/.bin:${PATH}"
COPY --from=prod-deps /app/node_modules ./node_modules

# Chromium 系統依賴（fonts、libnss3 等）＋瀏覽器本體放在最前面、緊接著
# node_modules——版本只跟 package.json 釘的 playwright 有關，跟原始碼／
# .next 建置產物無關，擺這裡才不會每次原始碼一改就連帶被 Docker layer
# cache 判定失效、重新下載一次；裝完順手清掉 apt 快取，不然那份中繼資料
# 會永久留在這層裡
RUN playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/.next ./.next
COPY --from=build /app/src/generated ./src/generated
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
# 不帶 pnpm-lock.yaml／pnpm-workspace.yaml——CMD 直接呼叫 next 執行檔，
# 整個 runtime image 不會再跑 pnpm install，這兩個檔案在這裡純粹是死重量
COPY package.json next.config.mjs prisma.config.ts ./

EXPOSE 3000
CMD ["next", "start"]
