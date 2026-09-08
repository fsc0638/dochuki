-- P8：收據解析結果的完整落地。
--
-- P3 把六類資訊（店名／品項／時間／地址／幣別／稅金）都解析出來了，但只有
-- 四類進得了畫面與資料庫；地址與稅金解析完就只留在 Receipt.parseJson，
-- 店名原文則直接丟棄（description 放的是中譯）。這支 migration 補上缺的部分。
--
-- 全部是新增，既有資料不需要回填：舊支出的 storeNameRaw／storeAddress 為
-- NULL、沒有 ExpenseTax 列，語意就是「這筆沒有這些資訊」，正確。

-- CreateEnum
CREATE TYPE "TaxMode" AS ENUM ('INCLUSIVE', 'EXCLUSIVE');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "storeAddress" TEXT,
ADD COLUMN     "storeNameRaw" TEXT;

-- CreateTable
CREATE TABLE "ExpenseTax" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "mode" "TaxMode",
    "rate" DECIMAL(6,4),
    "amount" DECIMAL(18,6),

    CONSTRAINT "ExpenseTax_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseTax_expenseId_idx" ON "ExpenseTax"("expenseId");

-- AddForeignKey
ALTER TABLE "ExpenseTax" ADD CONSTRAINT "ExpenseTax_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
