import type { SplitModeInput } from "@/lib/schemas/expense";

const OPTIONS: Array<{ value: SplitModeInput; label: string; hint: string }> = [
  { value: "EQUAL", label: "均分", hint: "選定成員平均分攤" },
  { value: "WEIGHT", label: "按權重", hint: "依成員設定的權重比例分攤" },
  { value: "BY_GROUP", label: "按組計價", hint: "整筆金額由選定組別均分" },
  { value: "EXACT", label: "指定金額", hint: "逐人輸入各自要付的金額" },
];

export function SplitModePicker({
  value,
  onChange,
}: {
  value: SplitModeInput;
  onChange: (mode: SplitModeInput) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-ink-soft">分攤方式</legend>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer flex-col rounded-xl border border-dashed px-3 py-2 text-sm ${
              value === option.value
                ? "border-stamp bg-stamp-pale"
                : "border-washi"
            }`}
          >
            <span className="flex items-center gap-2 font-medium">
              <input
                type="radio"
                name="splitMode"
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </span>
            <span className="text-xs text-ink-soft">{option.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
