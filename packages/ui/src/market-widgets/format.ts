/** Shared number presentation. Safe in server components and client views. */
export function instrumentNumber(
  value: number | null | undefined,
  precision = 2,
) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      });
}
