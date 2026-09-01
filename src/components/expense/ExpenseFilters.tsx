import { inputClass } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { EXPENSE_CATEGORIES } from "@/lib/constants";
import type { ExpenseFilter } from "@/lib/trips/load";

/**
 * 純 GET 表單，瀏覽器原生送出、不需要任何 client JS——篩選結果直接反映在
 * URL query string 上，可分享連結、可上一頁/下一頁。
 */
export function ExpenseFilters({
  tripId,
  members,
  filter,
}: {
  tripId: string;
  members: Array<{ id: string; name: string }>;
  filter: ExpenseFilter;
}) {
  return (
    <form
      method="get"
      action={`/trips/${tripId}`}
      className="flex flex-wrap items-end gap-2 text-sm"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-soft">分類</span>
        <Select
          name="category"
          defaultValue={filter.category ?? ""}
          className="py-1.5"
          options={[
            { value: "", label: "全部" },
            ...EXPENSE_CATEGORIES.map((category) => ({ value: category, label: category })),
          ]}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-soft">成員</span>
        <Select
          name="memberId"
          defaultValue={filter.memberId ?? ""}
          className="py-1.5"
          options={[
            { value: "", label: "全部" },
            ...members.map((member) => ({ value: member.id, label: member.name })),
          ]}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-soft">從</span>
        <input
          type="date"
          name="dateFrom"
          defaultValue={filter.dateFrom}
          className={`${inputClass} py-1.5`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-soft">到</span>
        <input
          type="date"
          name="dateTo"
          defaultValue={filter.dateTo}
          className={`${inputClass} py-1.5`}
        />
      </label>

      <button
        type="submit"
        className="rounded-full border border-dashed border-washi px-3 py-1.5 text-ink-soft hover:border-stamp-mid"
      >
        篩選
      </button>
      {(filter.category !== undefined ||
        filter.memberId !== undefined ||
        filter.dateFrom !== undefined ||
        filter.dateTo !== undefined) && (
        <a
          href={`/trips/${tripId}`}
          className="px-2 py-1.5 text-ink-soft underline"
        >
          清除
        </a>
      )}
    </form>
  );
}
