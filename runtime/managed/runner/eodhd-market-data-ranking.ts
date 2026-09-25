/** Ranked common stocks from one whole-exchange EOD snapshot, not the Screener API.
 * https://eodhd.com/financial-apis/bulk-api-eod-splits-dividends
 * https://eodhd.com/financial-apis/exchanges-api-list-of-tickers-and-trading-hours */
import type { EODHDClient } from "eodhd";
import {
  text,
  symbol,
  rows,
  decimal,
  date,
  type Row,
} from "./eodhd-market-data-values.js";

export async function volumeRanking(
  sdk: Pick<EODHDClient, "bulkEod" | "exchanges">,
  args: Row,
) {
  if (
    typeof args.exchange !== "string" ||
    !/^[A-Z0-9]{1,16}$/u.test(args.exchange) ||
    typeof args.limit !== "number" ||
    !Number.isInteger(args.limit) ||
    args.limit < 1 ||
    args.limit > 50
  )
    throw Error("invalid_request");
  // Exact native-code join within EODHD. No cross-provider identity decision,
  // company grouping, ISIN matching or ticker/name similarity is involved.
  const inputs = await Promise.allSettled([
    sdk.exchanges.symbols(args.exchange, { delisted: 0 }),
    sdk.bulkEod(args.exchange),
  ]);
  for (const input of inputs)
    if (input.status === "rejected") throw input.reason;
  const catalogue = rows(
    (inputs[0] as PromiseFulfilledResult<unknown>).value,
    100_000,
  );
  const raw = rows(
    (inputs[1] as PromiseFulfilledResult<unknown>).value,
    100_000,
  );
  const stocks = new Map<string, Row>();
  const seenCodes = new Set<string>();
  for (const entry of catalogue) {
    const code = text(entry.Code, 64);
    if (!code || seenCodes.has(code)) throw Error("invalid_response");
    seenCodes.add(code);
    if (entry.Type === "Common Stock") stocks.set(code, entry);
  }
  const seen = new Set<string>();
  let latestDate: string | null = null;
  const candidates = raw.flatMap((row) => {
    const code = text(row.code, 64),
      exchange = text(row.exchange_short_name, 16);
    if (!code || exchange?.toUpperCase() !== args.exchange || seen.has(code))
      throw Error("invalid_response");
    seen.add(code);
    const metadata = stocks.get(code);
    if (!metadata) return [];
    let sessionDate: string;
    try {
      sessionDate = date(row.date);
    } catch {
      return [];
    }
    if (latestDate === null || sessionDate > latestDate)
      latestDate = sessionDate;
    const volume = decimal(row.volume);
    if (volume === null || !Number.isSafeInteger(row.volume)) return [];
    const nativeId = symbol(`${code}.${args.exchange}`);
    const currency = text(metadata.Currency, 3);
    return [
      {
        provider_ref: {
          provider: "eodhd",
          native_id: nativeId,
          native_scope: "catalogue",
          ...(currency && /^[A-Z]{3}$/u.test(currency)
            ? { qualifiers: { currency } }
            : {}),
        },
        symbol: code,
        name: text(metadata.Name),
        exchange: args.exchange,
        currency,
        volume,
        session_date: sessionDate,
      },
    ];
  });
  const sameSession = candidates.filter(
    (row) => row.session_date === latestDate,
  );
  const omitted = stocks.size - sameSession.length;
  // Stable tie order is presentation only, not a claim that equal volumes differ.
  sameSession.sort(
    (a, b) =>
      Number(b.volume) - Number(a.volume) ||
      a.symbol.localeCompare(b.symbol, "en"),
  );
  const ranked = sameSession
    .slice(0, args.limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  return {
    data: {
      provider: "eodhd",
      metric: "share_volume",
      period: "completed_session",
      universe: args.exchange,
      requested_limit: args.limit,
      retrieved_at: new Date().toISOString(),
      session_date: latestDate,
      as_of: null,
      rows: ranked,
      batch_complete: true,
      source_query: {
        endpoint: "eod-bulk-last-day",
        exchange: args.exchange,
        catalogue_type: "Common Stock",
        ranking: "volume descending, native symbol ascending for ties",
        date_selection: "latest returned common-stock session",
      },
      coverage: {
        catalogue_common_stocks: stocks.size,
        snapshot_records: raw.length,
        eligible_same_session: sameSession.length,
        omitted_common_stocks: Math.max(0, omitted),
      },
      limitations: [
        "Pythia ranks EODHD's dated exchange snapshot; this is not EODHD's native screener ranking.",
        "Current catalogue Common Stock listings with valid volume on the latest returned session date; funds, stale rows and missing values are excluded.",
        `${sameSession.length} eligible listings from ${stocks.size} catalogue common stocks. The snapshot does not establish universal market coverage.`,
        "Each refresh requests the catalogue and a whole-exchange snapshot (100 API credits for the bulk request).",
      ],
    },
    issues: omitted > 0 ? ["ranking_coverage_limited"] : [],
    complete: true,
  };
}
