import {
  EODHDClient,
  EODHDAuthError,
  EODHDError,
  EODHDRateLimitError,
  EODHDTimeoutError,
} from "eodhd";

const MAX_ROWS = 500;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const TICKER = /^[A-Za-z0-9][A-Za-z0-9.-]{0,31}$/u;

type EodRequest = {
  api_token?: unknown;
  ticker?: unknown;
  from?: unknown;
  to?: unknown;
  limit?: unknown;
};

type EodClient = Pick<EODHDClient, "eod">;
type ClientFactory = (token: string) => EodClient;

const failure = (
  status: string,
  code: string,
  message: string,
  data: unknown = null,
) => ({
  status,
  data,
  error: { code, message },
});

function validDate(value: unknown): value is string | undefined | null {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && DATE.test(value))
  );
}

export async function runEod(
  request: EodRequest,
  createClient: ClientFactory = (token) =>
    new EODHDClient({ apiToken: token, timeout: 10_000, maxRetries: 2 }),
) {
  const token =
    typeof request.api_token === "string" ? request.api_token.trim() : "";
  if (!token) {
    return failure(
      "missing_configuration",
      "eodhd_token_missing",
      "Configure an EODHD token first.",
    );
  }
  if (
    typeof request.ticker !== "string" ||
    !TICKER.test(request.ticker.trim())
  ) {
    return failure(
      "invalid",
      "invalid_ticker",
      "Ticker must be exchange-qualified.",
    );
  }
  if (!validDate(request.from) || !validDate(request.to)) {
    return failure("invalid", "invalid_date", "Dates must use YYYY-MM-DD.");
  }
  const numericLimit = Number(request.limit ?? 200);
  if (!Number.isInteger(numericLimit) || numericLimit < 1) {
    return failure(
      "invalid",
      "invalid_limit",
      "limit must be a positive integer.",
    );
  }
  const limit = Math.min(MAX_ROWS, numericLimit);
  const params: { from?: string; to?: string; period: "d"; order: "a" } = {
    period: "d",
    order: "a",
  };
  if (request.from) params.from = request.from;
  if (request.to) params.to = request.to;
  delete process.env.EODHD_API_TOKEN;
  try {
    const rows = await createClient(token).eod(request.ticker.trim(), params);
    return {
      status: "ok",
      data: rows.slice(-limit).map((row) => ({
        date: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        adjusted_close: row.adjusted_close,
        volume: row.volume,
      })),
      error: null,
    };
  } catch (error) {
    if (error instanceof EODHDAuthError) {
      return failure(
        "invalid_configuration",
        "auth_error",
        "EODHD rejected the configured token.",
      );
    }
    if (error instanceof EODHDRateLimitError) {
      return failure("rate_limit", "rate_limit", "EODHD rate limit reached.", {
        retry_after: error.retryAfter ?? null,
      });
    }
    if (error instanceof EODHDTimeoutError) {
      return failure("timeout", "timeout", "EODHD request timed out.");
    }
    if (error instanceof EODHDError) {
      return failure("error", error.code, "EODHD request failed.", {
        status_code: error.statusCode,
      });
    }
    return failure("error", "unknown", "EODHD request failed.");
  }
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  try {
    const request = JSON.parse(input) as EodRequest;
    process.stdout.write(JSON.stringify(await runEod(request)));
  } catch {
    process.stdout.write(
      JSON.stringify(
        failure("invalid", "invalid_request", "Request must be valid JSON."),
      ),
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  await main();
}
