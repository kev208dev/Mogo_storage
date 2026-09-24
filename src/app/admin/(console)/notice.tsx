/** Server Action 결과 안내 (?notice=...) */
export function AdminNotice({ value }: { value: string | string[] | undefined }) {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text) return null;
  return (
    <p
      role="status"
      className="bg-primary-soft text-primary-strong rounded-md px-3 py-2 text-sm font-semibold"
    >
      {text.slice(0, 300)}
    </p>
  );
}
