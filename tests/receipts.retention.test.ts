import "dotenv/config";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createPasswordUser } from "@/lib/auth/users";
import { createTrip } from "@/lib/trips/write";

/**
 * P9 收據原圖保存期限（24 小時後自動刪除）。
 *
 * ★ 需要本機 docker compose 的 PostgreSQL 已啟動。
 *
 * 用臨時目錄當儲存區，避免動到真正的 RECEIPT_STORAGE_DIR。
 */

let tripId: string;
let storageDir: string;

async function purge(): Promise<void> {
  const trips = await prisma.trip.findMany({
    where: { name: { startsWith: "P9retention" } },
    select: { id: true },
  });
  const ids = trips.map((t) => t.id);
  if (ids.length > 0) {
    await prisma.receipt.deleteMany({ where: { tripId: { in: ids } } });
    await prisma.tripMembership.deleteMany({ where: { tripId: { in: ids } } });
    await prisma.trip.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: "p9@retention.invalid" } });
}

/** 建一張收據：寫一個實體檔案，並用指定的建立時間寫入資料列 */
async function makeReceipt(name: string, ageHours: number): Promise<string> {
  await writeFile(path.join(storageDir, name), "fake-image-bytes");
  const receipt = await prisma.receipt.create({
    data: { tripId, imagePath: name, engine: "LLM_VISION" },
  });
  await prisma.receipt.update({
    where: { id: receipt.id },
    data: { createdAt: new Date(Date.now() - ageHours * 3_600_000) },
  });
  return receipt.id;
}

describe("receipts/retention · 24 小時後刪除原圖", () => {
  beforeEach(async () => {
    await purge();
    storageDir = await mkdtemp(path.join(tmpdir(), "dochuki-retention-"));
    process.env.RECEIPT_STORAGE_DIR = storageDir;

    const user = await createPasswordUser({
      email: "p9@retention.invalid",
      password: "a-very-good-password",
      displayName: "P9保存期限",
    });
    const trip = await createTrip(
      {
        name: "P9retention 行程",
        startDate: "2026-12-01",
        endDate: "2026-12-05",
        homeCurrency: "TWD",
        fixedRates: [],
      },
      user.id,
    );
    tripId = trip.id;
  });

  afterAll(async () => {
    await purge();
  });

  it("超過 24 小時的刪除，未滿的保留", async () => {
    const { purgeExpiredReceiptImages } = await import("@/lib/receipts/retention");
    await makeReceipt("old.jpg", 25);
    await makeReceipt("fresh.jpg", 23);

    const result = await purgeExpiredReceiptImages();

    expect(result.deleted).toBe(1);
    const remaining = await readdir(storageDir);
    expect(remaining).toContain("fresh.jpg");
    expect(remaining).not.toContain("old.jpg");
  });

  it("只刪檔案，**不刪 Receipt 資料列**——解析結果是帳務資料，要留著", async () => {
    const { purgeExpiredReceiptImages } = await import("@/lib/receipts/retention");
    const id = await makeReceipt("keep-row.jpg", 30);
    await prisma.receipt.update({
      where: { id },
      data: { parseJson: { store: "測試店", total: 100 }, parsedAt: new Date() },
    });

    await purgeExpiredReceiptImages();

    const row = await prisma.receipt.findUniqueOrThrow({ where: { id } });
    expect(row.parseJson).not.toBeNull();
    // imagePath 也刻意保留：日後追查「原圖曾經存在、叫什麼名字」用得到
    expect(row.imagePath).toBe("keep-row.jpg");
  });

  it("可重複執行：第二次把已經不存在的算成 alreadyGone，不算失敗", async () => {
    const { purgeExpiredReceiptImages } = await import("@/lib/receipts/retention");
    await makeReceipt("twice.jpg", 48);

    const first = await purgeExpiredReceiptImages();
    expect(first.deleted).toBe(1);
    expect(first.failed).toBe(0);

    const second = await purgeExpiredReceiptImages();
    expect(second.deleted).toBe(0);
    expect(second.alreadyGone).toBe(1);
    expect(second.failed).toBe(0);
  });

  it("邊界：剛好 24 小時前的算過期", async () => {
    const { purgeExpiredReceiptImages, RECEIPT_RETENTION_MS } = await import(
      "@/lib/receipts/retention"
    );
    expect(RECEIPT_RETENTION_MS).toBe(24 * 60 * 60 * 1000);

    await makeReceipt("boundary.jpg", 24.01);
    expect((await purgeExpiredReceiptImages()).deleted).toBe(1);
  });

  it("數得出孤兒檔（磁碟上有、資料庫沒有），但不刪它", async () => {
    const { purgeExpiredReceiptImages } = await import("@/lib/receipts/retention");
    await writeFile(path.join(storageDir, "orphan.jpg"), "no-db-row");

    const result = await purgeExpiredReceiptImages();

    expect(result.orphanFiles).toBe(1);
    // 只計數不刪除：自動刪掉「資料庫沒紀錄的檔案」風險太高
    expect(await readdir(storageDir)).toContain("orphan.jpg");
  });
});
