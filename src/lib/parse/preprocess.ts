/**
 * 瀏覽器端的收據圖片前處理。只能被 client component 匯入——用到
 * `createImageBitmap`／`document.createElement("canvas")` 等瀏覽器 API，
 * 在伺服器端執行會直接丟錯。
 *
 * 依 docs/IMPLEMENTATION.md §5.1：長邊 ≤1600px、JPEG q80。壓縮本身會把
 * EXIF 燒掉（Canvas 重新編碼不帶原圖的中繼資料段），這是免費的副作用，
 * 不用另外寫剝除邏輯。
 *
 * ★ 範圍縮減（相對規格原文「讀取 EXIF GPS/時間後即剝除」）：只讀取拍攝
 * 時間，不讀 GPS。GPS 目前沒有任何欄位可以存（Trip/Expense 皆無地點欄位），
 * 讀出來只是丟棄的死程式碼，不寫比較誠實。要加地點功能時再補。
 */

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.8;

export interface CompressedReceiptImage {
  blob: Blob;
  mediaType: "image/jpeg";
}

/**
 * 壓縮收據照片。任何一步失敗都拋出，呼叫端依錯誤降級路徑決定要不要
 * 改傳未壓縮的原始檔（見 ExpenseCapture 元件）。
 */
export async function compressReceiptImage(
  file: File,
  options?: { maxEdge?: number; quality?: number },
): Promise<CompressedReceiptImage> {
  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = options?.quality ?? DEFAULT_QUALITY;

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("瀏覽器不支援 2D canvas");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });
    if (blob === null) throw new Error("圖片壓縮失敗");

    return { blob, mediaType: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}

/**
 * 讀取原始檔案的拍攝時間（EXIF DateTimeOriginal）。必須在壓縮**之前**對
 * 原始檔呼叫——壓縮後的 canvas 輸出已經沒有 EXIF 可讀。
 *
 * 讀不到（沒有 EXIF、格式不支援、解析失敗）一律回傳 null，不拋出——這只是
 * 輔助用的日期備援，不該讓整個拍照流程因此卡住。
 */
export async function extractTakenAt(file: File): Promise<Date | null> {
  try {
    const exifr = await import("exifr");
    const tags = await exifr.parse(file, { pick: ["DateTimeOriginal"] });
    const value: unknown = tags?.DateTimeOriginal;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}
