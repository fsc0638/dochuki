import { inputClass } from "@/components/ui/Field";
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
        <span className="text-xs text-neutral-500">分類</span>
        <select
          name="category"
          defaultValue={filter.category ?? ""}
          className={`${inputClass} py-1.5`}
        >
          <option value="">全部</option>
          {EXPENSE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">成員</span>
        <select
          name="memberId"
          defaultValue={filter.memberId ?? ""}
          className={`${inputClass} py-1.5`}
        >
          <option value="">全部</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">從</span>
        <input
          type="date"
          name="dateFrom"
          defaultValue={filter.dateFrom}
          className={`${inputClass} py-1.5`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">到</span>
        <input
          type="date"
          name="dateTo"
          defaultValue={filter.dateTo}
          className={`${inputClass} py-1.5`}
        />
      </label>

      <button
        type="submit"
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700"
      >
        篩選
      </button>
      {(filter.category !== undefined ||
        filter.memberId !== undefined ||
        filter.dateFrom !== undefined ||
        filter.dateTo !== undefined) && (
        <a
          href={`/trips/${tripId}`}
          className="px-2 py-1.5 text-neutral-500 underline"
        >
          清除
        </a>
      )}
    </form>
  );
}
