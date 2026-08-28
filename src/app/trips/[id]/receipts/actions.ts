"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, toErrorMessage } from "@/lib/actionState";
import { prisma } from "@/lib/db";
import { orchestrateParseReceipt } from "@/lib/parse/orchestrator";
import { mediaTypeForPath, persistParseResult, receiptStorageDir } from "@/lib/receipts/write";

/**
 * 對已存的收據圖片重新解析——不用重新上傳。對應確認頁的「重新解析」按鈕
 * （見 ReparseButton.tsx）。
 *
 * 跟其他 Server Action 一樣走 ActionState 慣例（見 lib/actionState.ts）：
 * 收據檔案讀不到、Gemini 呼叫失敗等狀況都回傳友善訊息，不讓例外原始
 * 冒到畫面上。
 */
export async function reparseReceiptAction(
  tripId: string,
  receiptId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  let imagePath: string;
  try {
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    imagePath = receipt.imagePath;
  } catch (error) {
    return { error: toErrorMessage(error) };
  }

  let buffer;
  try {
    buffer = await readFile(path.join(receiptStorageDir(), imagePath));
  } catch {
    return { error: "找不到原始圖檔，無法重新解析" };
  }

  const { parsed, engine } = await orchestrateParseReceipt({
    imageBuffer: buffer,
    mediaType: mediaTypeForPath(imagePath),
  });
  await persistParseResult(receiptId, parsed, engine);

  revalidatePath(`/trips/${tripId}/expenses/new`);
  redirect(`/trips/${tripId}/expenses/new?receiptId=${receiptId}`);
}
