import type { Client, Result } from "./eodhd-market-data-operations.js";
import { record, rows, type Row } from "./eodhd-market-data-values.js";
import { failedChart } from "./provider-errors.js";

const numeric = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) ? n : null;
/** Exact source references, not cross-provider identity matching. */
export async function dashboard(
  sdk: Client,
  args: Row,
  token: string,
  request: typeof fetch = fetch,
): Promise<Result> {
  const symbols = args.symbols;
  if (
    !Array.isArray(symbols) ||
    !symbols.length ||
    symbols.length > 10 ||
    new Set(symbols).size !== symbols.length ||
    symbols.some(
      (s) =>
        typeof s !== "string" ||
        !/^[A-Z][A-Z0-9-]{0,15}\.(US|INDX)$/u.test(s) ||
        (args.kind === "charts" &&
          !s.endsWith(".US") &&
          !["STOXX50E.INDX", "GDAXI.INDX", "FCHI.INDX"].includes(s)),
    ) ||
    !["quotes", "charts"].includes(String(args.kind))
  )
    throw Error("invalid_request");
  const retrieved_at = new Date().toISOString();
  if (args.kind === "quotes") {
    const response: unknown = await sdk.realTime(symbols[0], {
      s: symbols.slice(1).join(","),
    });
    const data = rows(Array.isArray(response) ? response : [response], 10);
    const seen = new Set<string>();
    for (const row of data) {
      if (
        typeof row.code !== "string" ||
        !symbols.includes(row.code) ||
        seen.has(row.code)
      )
        throw Error("binding_mismatch");
      seen.add(row.code);
    }
    return {
      data: {
        retrieved_at,
        quotes: symbols.map((symbol) => {
          const row = data.find((r) => r.code === symbol) ?? {};
          return {
            symbol,
            price: numeric(row.close),
            change: numeric(row.change),
            percent: numeric(row.change_p),
            timestamp: numeric(row.timestamp),
            open: numeric(row.open),
            high: numeric(row.high),
            low: numeric(row.low),
          };
        }),
      },
      issues: [],
      complete: data.length === symbols.length,
    };
  }
  // The pinned SDK has no minute-bar backfill method. Fixed official HTTPS
  // endpoint, bounded response/timeout, no redirects or secret-bearing errors.
  const charts = await Promise.all(
    symbols.map(async (symbol: string) => {
      const source = {
        provider: "eodhd",
        feed: symbol.endsWith(".INDX") ? "intraday" : "cboe_edgx_history",
        interval: symbol.endsWith(".INDX") ? "5m" : "1m",
        completion: symbol.endsWith(".INDX") ? "unknown" : "completed",
        session_timezone: symbol.endsWith(".INDX")
          ? "Europe/Paris"
          : "America/New_York",
        session_basis: "latest_returned_calendar_date",
      };
      try {
        if (symbol.endsWith(".INDX")) {
          const now = Date.now();
          const raw = rows(
            await sdk.intraday(symbol, {
              interval: "5m",
              from: String(Math.floor(now / 1000) - 7 * 86400),
              to: String(Math.floor(now / 1000)),
            }),
            2000,
          );
          let previous = 0;
          const points = raw.flatMap((value) => {
            const row = record(value),
              stamp = numeric(row.timestamp),
              c = numeric(row.close);
            const t = stamp === null ? 0 : stamp * 1000;
            if (!Number.isSafeInteger(t) || t <= previous || t > now)
              throw Error("invalid_response");
            previous = t;
            // Empty source bars are gaps, not zero prices or whole-feed errors.
            if (row.close === null) return [];
            if (c === null || c <= 0) throw Error("invalid_response");
            return [{ t, c }];
          });
          const day = (t: number) =>
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Europe/Paris",
            }).format(t);
          const last = points.at(-1),
            session = last ? day(last.t) : null;
          return {
            symbol,
            source,
            session,
            points: points.filter((p) => day(p.t) === session),
            error: null,
          };
        }
        const native = symbol.slice(0, -3);
        const url = new URL("https://ws.eodhistoricaldata.com/history");
        url.search = new URLSearchParams({
          market: "us",
          symbol: native,
          api_token: token,
        }).toString();
        const response = await request(url, {
          signal: AbortSignal.timeout(8000),
          redirect: "error",
        });
        if (!response.ok)
          throw Object.assign(Error("source_unavailable"), {
            code: response.status,
          });
        const reader = response.body?.getReader();
        if (!reader) throw Error("invalid_response");
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const item = await reader.read();
            if (item.done) break;
            size += item.value.length;
            if (size > 250000) throw Error("response_too_large");
            chunks.push(item.value);
          }
        } finally {
          await reader.cancel();
        }
        const raw = rows(JSON.parse(Buffer.concat(chunks).toString()), 2000);
        let previous = 0;
        const points = raw.map((value) => {
          const row = record(value),
            t = numeric(row.t),
            c = numeric(row.c);
          if (
            row.s !== native ||
            row.i !== "1m" ||
            t === null ||
            !Number.isSafeInteger(t) ||
            t <= previous ||
            t > Date.now() ||
            c === null ||
            c <= 0
          )
            throw Error("invalid_response");
          previous = t;
          return { t, c };
        });
        // Keep only the latest returned New York session; never splice feeds.
        const formatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York",
        });
        const day = (t: number) => formatter.format(t);
        const last = points.at(-1);
        const session = last ? day(last.t) : null;
        return {
          symbol,
          source,
          session,
          points: points.filter((p) => day(p.t) === session),
          error: null,
        };
      } catch (error) {
        return { ...failedChart(symbol, error), source };
      }
    }),
  );
  return { data: { retrieved_at, charts }, issues: [], complete: false };
}
