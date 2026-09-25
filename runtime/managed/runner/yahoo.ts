/** Owned, bounded public Yahoo SDK execution. No browser/account cookies or MCP.
 * There is no free-text search: the only Yahoo lookup is `resolve_isin`. */
import YahooFinance from "yahoo-finance2";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { yahooPrices } from "./yahoo-prices.js";
import { budgetedFetch } from "./provider-budget.js";
import { providerFailure } from "./provider-errors.js";
import { serveWorker, workerSignal } from "./provider-worker.js";
import { dated, statements, screen } from "./yahoo-options.js";
export type Client = InstanceType<typeof YahooFinance>;
export const methods = [
  "quote",
  "chart",
  "historical",
  "quoteSummary",
  "fundamentalsTimeSeries",
  "options",
  "insights",
  "recommendationsBySymbol",
  "screener",
  "trendingSymbols",
] as const;
const noop = () => {};
export function client(): Client {
  return new YahooFinance({
    versionCheck: false,
    logger: { info: noop, warn: noop, error: noop, debug: noop, dir: noop },
    queue: { concurrency: 2, interval: 100 },
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (
        url.protocol !== "https:" ||
        !["yahoo.com", "yahoo.net"].some(
          (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
        )
      )
        throw Error("unsupported_host");
      const response = await budgetedFetch(input, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.any([
          AbortSignal.timeout(12000),
          ...(workerSignal() ? [workerSignal() as AbortSignal] : []),
        ]),
      });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader)
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.length;
            if (length > 2_000_000) throw Error("output_limit");
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel();
        }
      return new Response(
        [204, 205, 304].includes(response.status)
          ? null
          : Buffer.concat(chunks),
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      );
    },
  });
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("invalid_request");
  return value as Record<string, unknown>;
}
export function symbol(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9^][A-Za-z0-9.^=-]{0,63}$/u.test(value)
  )
    throw Error("invalid_request");
  return value;
}
export function symbols(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 20 ||
    new Set(value).size !== value.length
  )
    throw Error("invalid_request");
  return value.map(symbol);
}
function bounds(operation: string, options: Record<string, unknown>) {
  if (Object.keys(options).length > 32) throw Error("invalid_request");
  for (const key of ["count"]) {
    if (
      options[key] !== undefined &&
      (!Number.isInteger(options[key]) ||
        Number(options[key]) < 0 ||
        Number(options[key]) > 100)
    )
      throw Error("invalid_request");
  }
  if (["chart", "historical", "fundamentalsTimeSeries"].includes(operation)) {
    const instant = (v: unknown) =>
      typeof v === "number"
        ? v * 1000
        : typeof v === "string"
          ? Date.parse(v)
          : NaN;
    const start = instant(options.period1),
      end =
        options.period2 === undefined ? Date.now() : instant(options.period2);
    const daily =
      operation !== "chart" ||
      ["1d", "5d", "1wk", "1mo", "3mo"].includes(
        String(options.interval ?? "1d"),
      );
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end < start ||
      end - start > (daily ? 3660 : 7) * 86400000
    )
      throw Error("invalid_window");
  }
}
/** ISO 6166 shape and check digit; anything else never reaches Yahoo. */
export function isin(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/u.test(value))
    throw Error("invalid_request");
  const digits = [...value].map((c) => Number.parseInt(c, 36)).join("");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  if (sum % 10 !== 0) throw Error("invalid_request");
  return value;
}
/** Internal resolve step: the Yahoo listings its search index keys to an ISIN.
 * Only listing rows are returned; names, news and navigation are dropped. */
async function resolveIsin(sdk: Client, code: string) {
  const found = await sdk.search(code, {
    quotesCount: 10,
    newsCount: 0,
    enableFuzzyQuery: false,
    enableCb: false,
    enableNavLinks: false,
  });
  return {
    isin: code,
    quotes: found.quotes.flatMap((q) =>
      q.isYahooFinance && typeof q.symbol === "string"
        ? [
            {
              symbol: symbol(q.symbol),
              exchange: typeof q.exchange === "string" ? q.exchange : null,
              quoteType: typeof q.quoteType === "string" ? q.quoteType : null,
            },
          ]
        : [],
    ),
  };
}
export async function execute(input: unknown, sdk: Client = client()) {
  const fetched = new Date().toISOString();
  try {
    const request = record(input),
      args = record(request.arguments);
    const operation = String(request.operation);
    if (
      [
        "dashboard",
        "metadata",
        "price_read",
        "price_batch",
        "quote_bundle",
      ].includes(operation)
    )
      return { data: await yahooPrices(sdk, operation, args), issues: [] };
    if (operation === "resolve_isin")
      return {
        data: {
          source: "yahoo.resolve_isin",
          retrieved_at: fetched,
          result: await resolveIsin(sdk, isin(args.isin)),
        },
        issues: [],
      };
    if (!methods.includes(operation as (typeof methods)[number]))
      throw Error("invalid_request");
    const options = args.options === undefined ? {} : record(args.options);
    bounds(operation, options);
    let data: unknown;
    // Deliberate explicit dispatch; caller cannot invoke SDK internals or fetch controls.
    switch (operation) {
      case "quote":
        data = await sdk.quote(symbols(args.symbols), options);
        break;
      case "screener":
        data = await sdk.screener(screen(options));
        break;
      case "trendingSymbols": {
        if (typeof args.region !== "string" || !/^[A-Z]{2}$/u.test(args.region))
          throw Error("invalid_request");
        data = await sdk.trendingSymbols(args.region, options);
        break;
      }
      case "recommendationsBySymbol":
        if (Object.keys(options).length) throw Error("invalid_request");
        data = await sdk.recommendationsBySymbol(symbols(args.symbols));
        break;
      case "chart":
        data = await sdk.chart(symbol(args.symbol), dated(options));
        break;
      case "historical":
        data = await sdk.historical(symbol(args.symbol), dated(options));
        break;
      case "fundamentalsTimeSeries":
        data = await sdk.fundamentalsTimeSeries(
          symbol(args.symbol),
          statements(options),
        );
        break;
      case "quoteSummary":
        data = await sdk.quoteSummary(symbol(args.symbol), options);
        break;
      case "options":
        data = await sdk.options(symbol(args.symbol), options);
        break;
      case "insights":
        data = await sdk.insights(symbol(args.symbol), options);
        break;
    }
    const result = {
      data: {
        source: `yahoo.${operation}`,
        retrieved_at: fetched,
        result: data,
      },
      issues: [],
    };
    if (JSON.stringify(result).length > 1_800_000) throw Error("output_limit");
    return result;
  } catch (error) {
    const failure = providerFailure(error);
    return {
      data: null,
      issues: [failure.code],
      failure,
      retry_after: failure.retry_after_seconds,
      limit_origin: failure.origin,
    };
  }
}
async function main() {
  if (process.env.PYTHIA_WORKER_MODE === "resident") {
    const sdk = client();
    await serveWorker((input) => execute(input, sdk));
    return;
  }
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 65536) throw Error();
  }
  const output = JSON.stringify(await execute(JSON.parse(input)));
  process.stdout.write(
    output.length > 1_900_000
      ? JSON.stringify({ data: null, issues: ["output_limit"] })
      : output,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  main().catch(() =>
    process.stdout.write(
      JSON.stringify({ data: null, issues: ["invalid_request"] }),
    ),
  );
