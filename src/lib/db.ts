import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 單例。
 *
 * Prisma 7 的 Rust-free client 必須搭配 driver adapter，不能直接
 * `new PrismaClient()`（見 prisma/seed.ts 的說明）。
 *
 * 掛在 globalThis 上是為了扛過 Next.js dev 模式的 HMR：每次改檔案模組會被
 * 重新求值，若每次都 `new PrismaClient()` 會不斷開新的連線池，很快撞到
 * PostgreSQL 的 max_connections。正式環境（NODE_ENV=production）每個
 * process 只會初始化一次，不受影響。
 *
 * `next build` 的「collect page data」階段會匯入這個模組（但不會真的呼叫
 * prisma.*），Docker 建置階段本來就不該有、也不會有真正的 DATABASE_URL，
 * 若模組頂層求值就直接建置失敗——Dockerfile 的 build stage 因此帶一個
 * 佔位用的假 DATABASE_URL（見 Dockerfile 註解）。這樣做是安全的：
 * `PrismaPg`／`PrismaClient` 建構時都不會真的連線（connection pool 是
 * lazy，第一次查詢才連），佔位字串只要格式合法、不必連得到，換來的是
 * 不必用 Proxy 延後初始化整個 client——省掉自己重新實作 Proxy trap
 * （instanceof／in／Object.keys 這類操作 Proxy 沒特別處理就會回傳跟真正
 * PrismaClient 不一致的結果）的維護成本。
 */

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    throw new Error("缺少環境變數 DATABASE_URL（複製 .env.example 成 .env）");
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
