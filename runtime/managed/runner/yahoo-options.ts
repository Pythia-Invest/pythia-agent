/** Required SDK fields narrowed before entry; SDK validates all query options. */
export function dated(options: Record<string, unknown>) {
  const { period1, period2 } = options;
  if (
    (typeof period1 !== "string" && typeof period1 !== "number") ||
    (period2 !== undefined &&
      typeof period2 !== "string" &&
      typeof period2 !== "number")
  )
    throw Error("invalid_request");
  return { ...options, period1, ...(period2 === undefined ? {} : { period2 }) };
}
export function statements(options: Record<string, unknown>) {
  if (typeof options.module !== "string") throw Error("invalid_request");
  return { ...dated(options), module: options.module };
}
export function screen(options: Record<string, unknown>) {
  // Pinned ScreenerOptions.scrIds union, validated before the SDK call.
  const supported = [
    "aggressive_small_caps",
    "conservative_foreign_funds",
    "day_gainers",
    "day_losers",
    "growth_technology_stocks",
    "high_yield_bond",
    "most_actives",
    "most_shorted_stocks",
    "portfolio_anchors",
    "small_cap_gainers",
    "solid_large_growth_funds",
    "solid_midcap_growth_funds",
    "top_mutual_funds",
    "undervalued_growth_stocks",
    "undervalued_large_caps",
  ] as const;
  const scrIds = supported.find((id) => id === options.scrIds);
  if (!scrIds) throw Error("invalid_request");
  return { ...options, scrIds };
}
