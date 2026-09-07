-- P7.2：登入失敗節流的兩個欄位。
--
-- 連續失敗會鎖一小段時間，時間隨次數遞增但上限 15 分鐘，成功登入歸零。
-- 刻意不做永久鎖定——鎖帳號本身可以被拿來癱瘓別人的帳號（知道 email 就能
-- 一直亂猜），15 分鐘足以讓自動化撞庫不划算，又不會把正常使用者永久擋在外面。
--
-- 兩欄都有預設值／可為空，既有的 User 列不需要回填。

ALTER TABLE "User" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);
