/** Provider-defined, completed-session screens; not real-time exchange rankings. */
import type { Client, Result } from "./eodhd-market-data-operations.js";
import { record, rows, date, type Row } from "./eodhd-market-data-values.js";
const sorts = {
  gainers: "refund_1d_p.desc",
  losers: "refund_1d_p.asc",
  active: "avgvol_1d.desc",
} as const;
export async function marketMovers(sdk: Client, args: Row): Promise<Result> {
  const kind = args.kind as keyof typeof sorts;
  const limit = args.limit;
  if (
    !Object.hasOwn(sorts, kind) ||
    !Number.isSafeInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 10
  )
    throw Error("invalid_request");
  const filters = [
    ["exchange", "=", "us"],
    ["sub_exchange", "in", ["NYSE", "NASDAQ"]],
    ["market_capitalization", ">", 1e9],
    ["avgvol_1d", ">", 1e5],
  ];
  if (kind !== "active")
    filters.push(["refund_1d_p", kind === "gainers" ? ">" : "<", 0]);
  const response = record(
    await sdk.screener({
      filters: JSON.stringify(filters),
      sort: sorts[kind],
      limit: Number(limit),
    }),
  );
  const seen = new Set<string>();
  const number = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const data = rows(response.data, Number(limit)).map((row) => {
    if (
      typeof row.code !== "string" ||
      !/^[A-Z][A-Z0-9-]{0,15}$/u.test(row.code) ||
      row.exchange !== "US" ||
      row.currency_symbol !== "$" ||
      seen.has(row.code) ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      row.name.length > 256
    )
      throw Error("binding_mismatch");
    seen.add(row.code);
    const session = date(row.last_day_data_date);
    const price = number(row.adjusted_close),
      percent = number(row.refund_1d_p),
      volume = number(row.avgvol_1d),
      cap = number(row.market_capitalization);
    if (
      session > new Date().toISOString().slice(0, 10) ||
      price === null ||
      price <= 0 ||
      percent === null ||
      volume === null ||
      volume <= 1e5 ||
      cap === null ||
      cap <= 1e9
    )
      throw Error("invalid_response");
    return {
      symbol: `${row.code}.US`,
      name: row.name,
      session,
      price,
      percent,
      volume,
    };
  });
  // Preserve the provider's rank and each row's session; never backfill or
  // relabel a stale constituent as belonging to the majority trading date.
  return {
    data: {
      kind,
      rows: data,
      retrieved_at: new Date().toISOString(),
      filters,
      sort: sorts[kind],
      source: "eodhd.screener",
    },
    issues: [],
    complete: false,
  };
}
