/**
 * OpenMoji（https://openmoji.org，CC BY-SA 4.0）圖示包裝。原樣使用官方
 * SVG（public/emoji/ 下按 Unicode codepoint 命名，未經修改），授權致謝見
 * RootLayout 的頁尾——不修改圖示本身即不構成衍生作品，不受 ShareAlike
 * 條款拘束。
 */

const EMOJI_MAP = {
  castle: "1F3EF",
  plane: "2708",
  receipt: "1F9FE",
  yen: "1F4B4",
  people: "1F465",
  moneyBag: "1F4B0",
  chart: "1F4CA",
  camera: "1F4F7",
  gear: "2699",
  trash: "1F5D1",
  calendar: "1F4C5",
  pin: "1F4CD",
  globe: "1F30F",
  plus: "2795",
} as const;

export type EmojiName = keyof typeof EMOJI_MAP;

export function Emoji({
  name,
  size = 20,
  className,
  label,
}: {
  name: EmojiName;
  size?: number;
  className?: string;
  /** 圖示本身帶有語意（非純裝飾）時才傳，會用來設定 alt／role */
  label?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 純裝飾用小圖示，不需要 next/image 的最佳化
    <img
      src={`/emoji/${EMOJI_MAP[name]}.svg`}
      alt={label ?? ""}
      aria-hidden={label === undefined ? true : undefined}
      width={size}
      height={size}
      className={className}
      style={{ display: "inline-block", flexShrink: 0 }}
    />
  );
}
