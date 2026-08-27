import { Money } from "@/components/ui/Money";
import type { MemberTotal } from "@/lib/trips/load";

export function MemberTotals({
  totals,
  currency,
}: {
  totals: MemberTotal[];
  currency: string;
}) {
  if (totals.length === 0) {
    return <p className="text-sm text-ink-soft">還沒有成員。</p>;
  }

  return (
    <ul className="divide-y divide-dashed divide-washi-light overflow-hidden rounded-xl border border-dashed border-washi">
      {totals.map((member) => (
        <li
          key={member.memberId}
          className="flex items-center justify-between px-4 py-2.5"
        >
          <div>
            <div className="text-sm font-medium">{member.name}</div>
            {member.groupName !== null && (
              <div className="text-xs text-ink-muted">{member.groupName}</div>
            )}
          </div>
          <Money
            value={member.expenseShareTotal}
            currency={currency}
            className="text-sm font-semibold tabular-nums"
          />
        </li>
      ))}
    </ul>
  );
}
