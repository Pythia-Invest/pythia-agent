/** Fail at fixture setup rather than silently weakening an assertion. */
export function requiredFixture<T>(value: T | null | undefined): T {
  if (value == null)
    throw new Error("Required synthetic fixture value is missing.");
  return value;
}
