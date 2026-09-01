export function Field({
  label,
  htmlFor,
  errors,
  children,
}: {
  label: string;
  htmlFor: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink-soft">
        {label}
      </label>
      {children}
      {errors?.map((message) => (
        <p key={message} className="text-xs text-red-600">
          {message}
        </p>
      ))}
    </div>
  );
}

export const inputClass =
  "rounded-md border border-washi bg-white px-3 py-2 text-base text-ink focus:border-stamp-mid focus:outline-none";
