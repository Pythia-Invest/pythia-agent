/** SDK 1.1.0 parses JSON numbers before Pythia receives them. No claim to recover
 * original lexical precision; expand the finite JS value without exponent form. */
export type Row = Record<string, unknown>;
export const record = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("invalid_response");
  return value as Row;
};
export function text(value: unknown, maximum = 512): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    ![...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
    ? value
    : null;
}
export function symbol(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9.-]{0,63}\.[A-Za-z0-9]{1,16}$/u.test(value)
  )
    throw Error("invalid_request");
  return value;
}
export function decimal(value: unknown): string | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1e100
  )
    return null;
  const [mantissa = "", exponent] = String(value).split("e");
  if (!exponent) return mantissa;
  const parts = mantissa.split("."),
    digits = parts.join("");
  const position = (parts[0]?.length ?? 0) + Number(exponent);
  return position <= 0
    ? `0.${"0".repeat(-position)}${digits}`
    : position >= digits.length
      ? digits + "0".repeat(position - digits.length)
      : `${digits.slice(0, position)}.${digits.slice(position)}`;
}
export function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw Error("invalid_request");
  return value;
}
export function epoch(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 253402300799
  )
    throw Error("invalid_response");
  return value;
}
export function rows(value: unknown, limit: number): Row[] {
  if (!Array.isArray(value) || value.length > limit)
    throw Error("invalid_response");
  return value.map(record);
}
export function prices(row: Row) {
  return Object.fromEntries(
    ["open", "high", "low", "close", "adjusted_close", "volume"].map((key) => [
      key,
      decimal(row[key]),
    ]),
  );
}
