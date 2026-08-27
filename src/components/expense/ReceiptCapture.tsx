"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Emoji } from "@/components/ui/Emoji";
import { FormMessage } from "@/components/ui/FormMessage";
import { compressReceiptImage, extractTakenAt } from "@/lib/parse/preprocess";

const FALLBACK_ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface ParseResponse {
  receiptId: string;
  parsed: boolean;
}

/**
 * 拍照/選圖 → 壓縮 → 上傳 → 導到確認頁。錯誤降級路徑（依 P3 計畫）：
 *   - EXIF 讀取失敗：忽略，不影響後續
 *   - 壓縮失敗：改傳原始檔（僅限 jpeg/png/webp，其餘格式擋下並提示）
 *   - 上傳或解析失敗：顯示錯誤，讓使用者重試或改走「手動輸入」
 * 解析本身失敗（parsed:false）不算錯誤——確認頁會用空白表單接手，見
 * expenses/new/page.tsx。
 */
export function ReceiptCapture({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleFile(file: File): Promise<void> {
    setStatus("uploading");
    setErrorMessage(null);

    // EXIF 讀取跟壓縮都只讀「原始檔」、互不依賴對方的結果，平行跑。
    // 用 allSettled 而非 all：壓縮失敗時還是要拿到 takenAt 的結果，不能因為
    // 壓縮那條 reject 就把兩個都丟掉。
    // （EXIF 讀取本身內部已吞掉例外、保證不 reject，這裡仍用 allSettled
    //  統一處理，不必為它單獨假設「一定成功」。）
    const [takenAtResult, compressedResult] = await Promise.allSettled([
      extractTakenAt(file),
      compressReceiptImage(file),
    ]);
    const takenAt = takenAtResult.status === "fulfilled" ? takenAtResult.value : null;

    let blob: Blob;
    let mediaType: string;
    if (compressedResult.status === "fulfilled") {
      blob = compressedResult.value.blob;
      mediaType = compressedResult.value.mediaType;
    } else {
      if (!FALLBACK_ACCEPTED_TYPES.has(file.type)) {
        setStatus("error");
        setErrorMessage("圖片壓縮失敗，且原始格式不支援，請改用 JPEG、PNG 或 WebP");
        return;
      }
      blob = file;
      mediaType = file.type;
    }

    try {
      const body = new FormData();
      body.set("image", blob, "receipt");
      body.set("tripId", tripId);
      body.set("mediaType", mediaType);

      const response = await fetch("/api/parse", { method: "POST", body });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setStatus("error");
        setErrorMessage(payload?.error ?? "上傳失敗，請稍後再試");
        return;
      }

      const result = (await response.json()) as ParseResponse;
      const params = new URLSearchParams({ receiptId: result.receiptId });
      if (takenAt !== null) params.set("takenAt", takenAt.toISOString());
      router.push(`/trips/${tripId}/expenses/new?${params.toString()}`);
    } catch {
      setStatus("error");
      setErrorMessage("上傳失敗，請檢查網路連線後再試");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-washi bg-paper px-6 py-12 text-center text-sm text-ink-soft ${status === "uploading" ? "opacity-60" : "hover:border-stamp-mid"}`}
      >
        <Emoji name="camera" size={32} />
        {status === "uploading" ? "上傳並解析中…" : "點此拍照或選擇收據照片"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={status === "uploading"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void handleFile(file);
          }}
        />
      </label>

      <FormMessage error={errorMessage ?? undefined} />

      <a
        href={`/trips/${tripId}/expenses/new`}
        className="text-center text-sm text-ink-soft underline"
      >
        或改成手動輸入
      </a>
    </div>
  );
}
