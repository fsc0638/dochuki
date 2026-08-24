import type Decimal from "decimal.js";
import { Money } from "@/components/ui/Money";

export interface PreviewShare {
  memberId: string;
  name: string;
  shareHome: Decimal;
}

/**
 * 即時分攤預覽。
 *
 * 送出前就用跟落地時完全相同的引擎（@/lib/money/convert、split）在瀏覽器
 * 端算一次，讓使用者送出前就看得到「這樣分等一下會變成多少錢」，數字保證
 * 與送出後真正落地的數字一致——因為根本是同一段程式碼跑出來的，不是另外
 * 刻一份預覽用的近似算法。
 */
export function SplitPreview({
  status,
  shares,
  homeCurrency,
}: {
  status:
    | { kind: "empty" }
    | { kind: "error"; message: string }
    | { kind: "needs-server-rate" }
    | { kind: "ready" };
  shares: PreviewShare[];
  homeCurrency: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-3">
      <div className="mb-2 text-xs font-medium text-neutral-500">分攤預覽</div>

      {status.kind === "empty" && (
        <p className="text-sm text-neutral-400">填寫金額與參與者後會顯示預覽</p>
      )}
      {status.kind === "error" && (
        <p className="text-sm text-red-600">{status.message}</p>
      )}
      {status.kind === "needs-server-rate" && (
        <p className="text-sm text-neutral-500">
          此幣別尚無固定匯率也未手動輸入，送出後會自動查詢參考匯率
          （無法在送出前預覽實際金額，但分攤比例已固定）。
        </p>
      )}
      {status.kind === "ready" && shares.length > 0 && (
        <ul className="flex flex-col gap-1">
          {shares.map((share) => (
            <li key={share.memberId} className="flex justify-between text-sm">
              <span>{share.name}</span>
              <Money value={share.shareHome} currency={homeCurrency} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
