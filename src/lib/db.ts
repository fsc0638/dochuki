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
