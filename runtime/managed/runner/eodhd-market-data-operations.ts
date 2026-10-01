/** Documented SDK endpoints only; reverse pagination retains identifier records.
 * https://eodhd.com/financial-apis/id-mapping-api-cusip-isin-figi-lei-cik-%E2%86%94-symbol */
import type { EODHDClient } from "eodhd";
import { failure } from "./eodhd-market-data-errors.js";
import { createHash } from "node:crypto";
import { research } from "./eodhd-market-data-research.js";
import {
  record,
  text,
  symbol,
  rows,
  prices,
  date,
  epoch,
  type Row,
} from "./eodhd-market-data-values.js";
export type Client = Pick<
  EODHDClient,
  | "search"
  | "idMapping"
  | "eod"
  | "realTime"
  | "intraday"
  | "exchanges"
  | "news"
  | "fundamentals"
>;
export type Result = {
  data: unknown;
  issues: string[];
  complete: boolean;
  http_status?: number;
  retry_after?: number | null;
};
function candidate(row: Row) {
  const code = text(row.Code, 64),
    exchange = text(row.Exchange, 16);
  if (!code || !exchange) throw Error("invalid_response");
  return {
    symbol: symbol(`${code}.${exchange}`),
    name: text(row.Name),
    type: text(row.Type),
    currency: text(row.Currency, 3),
    isin: text(row.ISIN, 12),
  };
}
async function mapping(
  sdk: Client,
  field: "isin" | "symbol",
  value: string,
): Promise<Result> {
  const data: Row[] = [],
    seenRecords = new Set<string>(),
    seenPages = new Set<string>();
  let total: number | undefined,
    offset = 0;
  for (let page = 0; page < 4; page++) {
    let raw: Row;
    try {
      raw = record(
        await sdk.idMapping({
          [`filter[${field}]`]: value,
          "page[limit]": 100,
          "page[offset]": offset,
        }),
      );
    } catch (error) {
      if (!data.length) throw error;
      const failed = failure(error);
      return {
        ...failed,
        data,
        issues: ["pagination_interrupted", ...failed.issues],
      };
    }
    try {
      const meta = record(raw.meta),
        links = record(raw.links),
        batch = rows(raw.data, 100);
      if (
        !Number.isSafeInteger(meta.total) ||
        Number(meta.total) < 0 ||
        meta.limit !== 100 ||
        meta.offset !== offset ||
        (total !== undefined && total !== meta.total) ||
        offset + batch.length > Number(meta.total)
      )
        return { data, issues: ["pagination_changed"], complete: false };
      total = Number(meta.total);
      const normalized = batch.map((row) => ({
        symbol: symbol(row.symbol),
        isin: text(row.isin, 12),
        figi: text(row.figi),
        lei: text(row.lei),
        cusip: text(row.cusip),
        cik: text(row.cik),
      }));
      if (normalized.some((row) => row[field] !== value))
        return { data, issues: ["identifier_conflict"], complete: false };
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(normalized))
        .digest("hex");
      if (seenPages.has(fingerprint) && batch.length)
        return { data, issues: ["pagination_repeated"], complete: false };
      seenPages.add(fingerprint);
      for (const row of normalized) {
        const key = JSON.stringify(row);
        if (!seenRecords.has(key)) {
          data.push(row);
          seenRecords.add(key);
        }
      }
      offset += batch.length;
      if (offset === total && links.next === null)
        return { data, issues: [], complete: true };
      if (!batch.length || typeof links.next !== "string" || !links.next)
        return { data, issues: ["pagination_incomplete"], complete: false };
    } catch {
      return { data, issues: ["invalid_response"], complete: false };
    }
  }
  return { data, issues: ["pagination_limit"], complete: false };
}
export async function execute(
  sdk: Client,
  operation: string,
  args: Row,
): Promise<Result> {
  if (["catalogue_snapshot", "news", "fundamentals"].includes(operation))
    return research(sdk, operation, args);
  if (operation === "reverse") {
    if (
      typeof args.isin !== "string" ||
      !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/u.test(args.isin)
    )
      throw Error("invalid_request");
    return mapping(sdk, "isin", args.isin);
  }
  if (operation === "identifiers")
    return mapping(sdk, "symbol", symbol(args.symbol));
  if (operation === "latest_batch") {
    if (
      !Array.isArray(args.symbols) ||
      args.symbols.length < 1 ||
      args.symbols.length > 32
    )
      throw Error("invalid_request");
    const list = args.symbols.map(symbol);
    if (new Set(list).size !== list.length) throw Error("invalid_request");
    const first = list[0];
    if (!first) throw Error("invalid_request");
    const response: unknown = await sdk.realTime(first, {
      s: list.slice(1).join(","),
    });
    const result: Record<string, unknown[]> = {};
    for (const raw of rows(
      Array.isArray(response) ? response : [response],
      32,
    )) {
      const code = symbol(raw.code);
      if (!list.includes(code) || code in result)
        throw Error("binding_mismatch");
      result[code] = [
        {
          ...prices(raw),
          timestamp:
            typeof raw.timestamp === "number" &&
            Number.isSafeInteger(raw.timestamp) &&
            raw.timestamp >= 0 &&
            raw.timestamp <= 253402300799
              ? raw.timestamp
              : null,
          gmtoffset: raw.gmtoffset,
          change: raw.change,
          change_p: raw.change_p,
        },
      ];
    }
    return {
      data: result,
      issues: [],
      complete: Object.keys(result).length === list.length,
    };
  }
  const ticker = symbol(args.symbol);
  // Exact-symbol metadata. The SDK's search endpoint filtered to one exchange
  // is the documented exact read; there is no free-text provider search.
  if (operation === "details") {
    const split = ticker.lastIndexOf(".");
    const data = rows(
      await sdk.search(ticker.slice(0, split), {
        exchange: ticker.slice(split + 1),
        limit: 100,
        type: "all",
      }),
      100,
    )
      .map(candidate)
      .filter((row) => row.symbol === ticker);
    return { data, issues: [], complete: false };
  }
  if (operation === "eod") {
    const from = date(args.from),
      to = date(args.to);
    if (to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000)
      throw Error("invalid_window");
    const data = rows(
      await sdk.eod(ticker, { from, to, period: "d", order: "a" }),
      367,
    ).map((row) => ({ ...prices(row), date: text(row.date, 10) }));
    return { data, issues: [], complete: true };
  }
  if (operation === "latest") {
    const raw = record(await sdk.realTime(ticker));
    if (raw.code !== ticker) throw Error("binding_mismatch");
    return {
      data: [
        {
          ...prices(raw),
          timestamp:
            typeof raw.timestamp === "number" &&
            Number.isSafeInteger(raw.timestamp) &&
            raw.timestamp >= 0 &&
            raw.timestamp <= 253402300799
              ? raw.timestamp
              : null,
          gmtoffset: raw.gmtoffset,
          change: raw.change,
          change_p: raw.change_p,
        },
      ],
      issues: [],
      complete: true,
    };
  }
  if (operation === "intraday") {
    const from = epoch(args.from),
      to = epoch(args.to),
      interval = args.interval;
    if (
      to < from ||
      to - from > 7 * 86400 ||
      !["1m", "5m", "1h"].includes(String(interval))
    )
      throw Error("invalid_window");
    const data = rows(
      await sdk.intraday(ticker, {
        from,
        to,
        interval: interval as "1m" | "5m" | "1h",
      }),
      10000,
    ).map((row) => ({
      ...prices(row),
      timestamp:
        typeof row.timestamp === "number" &&
        Number.isSafeInteger(row.timestamp) &&
        row.timestamp >= 0 &&
        row.timestamp <= 253402300799
          ? row.timestamp
          : null,
      gmtoffset: row.gmtoffset,
      datetime: text(row.datetime, 32),
    }));
    return { data, issues: [], complete: true };
  }
  throw Error("invalid_request");
}
