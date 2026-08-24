import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { parseReceipt } from "@/lib/parse/anthropic";
import { persistParseResult, receiptStorageDir } from "@/lib/receipts/write";

/**
 * 收據上傳＋解析。依 docs/IMPLEMENTATION.md §5.1、§3（`src/app/api/parse/`）。
 *
 * 「上傳存原圖」的「原圖」＝這裡收到的檔案（前端已壓縮過），不是手機相簿
 * 裡那份未壓縮的原始照片——不重複儲存使用者傳完就不再需要的大檔。
 *
 * ★ 依 CLAUDE.md 禁止事項：圖檔內容與解析結果不得進 log。本檔任何錯誤處理
 * 都只回傳固定文字訊息，不 log 例外物件本身（可能夾帶請求內容）。
 */

const ACCEPTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const image = formData.get("image");
  const tripId = formData.get("tripId");
  const mediaType = formData.get("mediaType");

  if (!(image instanceof File)) {
    return NextResponse.json({ error: "缺少圖片" }, { status: 400 });
  }
  if (typeof tripId !== "string" || tripId === "") {
    return NextResponse.json({ error: "缺少 tripId" }, { status: 400 });
  }
  if (typeof mediaType !== "string" || !ACCEPTED_MEDIA_TYPES.has(mediaType)) {
    return NextResponse.json(
      { error: "不支援的圖片格式，請使用 JPEG、PNG 或 WebP" },
      { status: 400 },
    );
  }

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (trip === null) {
    return NextResponse.json({ error: "行程不存在" }, { status: 404 });
  }

  const buffer = Buffer.from(await image.arrayBuffer());
  const dir = receiptStorageDir();
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}.${extensionFor(mediaType)}`;

  // 存檔、建 Receipt 記錄、呼叫 Anthropic 三者互不依賴彼此的結果，平行跑——
  // 解析是多秒等級的呼叫，跟另外兩個毫秒等級的 I/O 序列疊加沒有意義
  const [, receipt, parsed] = await Promise.all([
    writeFile(path.join(dir, filename), buffer),
    prisma.receipt.create({
      data: {
        // 相對於 RECEIPT_STORAGE_DIR 的檔名，不存絕對路徑——環境之間
        // RECEIPT_STORAGE_DIR 本身可能不同，讀取時才組完整路徑
        imagePath: filename,
        engine: "LLM_VISION",
      },
    }),
    parseReceipt({
      imageBase64: buffer.toString("base64"),
      mediaType: mediaType as "image/jpeg" | "image/png" | "image/webp",
    }),
  ]);
  await persistParseResult(receipt.id, parsed);

  return NextResponse.json({
    receiptId: receipt.id,
    parsed: parsed !== null,
  });
}

function extensionFor(mediaType: string): string {
  switch (mediaType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}
