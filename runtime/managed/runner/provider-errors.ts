/** Safe, reusable provider failure details. Never expose exception bodies/URLs. */
export type ProviderFailure = {
  code: string;
  message: string;
  origin?: "connector" | "provider";
  retry_after_seconds?: number;
  diagnostic_id?: string;
};
const messages: Record<string, string> = {
  busy: "Data requests are busy. Retrying shortly.",
  rate_limit:
    "The data connection is rate limited. Retrying after its cooldown.",
  timeout: "The data request timed out.",
  authentication_failed: "The data connection needs authentication.",
  access_denied: "This data is not available with the current connection.",
  invalid_request: "The data request is not supported.",
  invalid_window: "This history window is not supported.",
  network_error: "The data connection could not be reached.",
  invalid_response: "The provider returned data that could not be read.",
  output_limit: "The data response exceeded the supported size.",
  binding_mismatch: "The provider returned a different instrument.",
  source_unavailable: "The provider could not supply the requested data.",
};
export function providerFailure(error: unknown): ProviderFailure {
  const row =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const status =
    Number(row.statusCode) > 0 ? row.statusCode : (row.status ?? row.code);
  const code =
    typeof status === "string" && messages[status]
      ? status
      : status === 429
        ? "rate_limit"
        : status === 401
          ? "authentication_failed"
          : status === 403
            ? "access_denied"
            : typeof row.message === "string" && messages[row.message]
              ? row.message
              : row.name === "InvalidOptionsError"
                ? "invalid_request"
                : /Timeout|Abort/u.test(String(row.name))
                  ? "timeout"
                  : "source_unavailable";
  const retry = row.retry_after_seconds;
  return {
    code,
    message:
      messages[code] ?? messages.source_unavailable ?? "Data unavailable.",
    ...(row.origin === "connector" || row.origin === "provider"
      ? { origin: row.origin }
      : status === 429
        ? { origin: "provider" }
        : {}),
    ...(typeof retry === "number" &&
    Number.isFinite(retry) &&
    retry >= 0 &&
    retry <= 86400
      ? { retry_after_seconds: retry }
      : {}),
    ...(process.env.PYTHIA_REQUEST_ID
      ? { diagnostic_id: process.env.PYTHIA_REQUEST_ID }
      : {}),
  };
}
export function failedChart(symbol: string, error: unknown) {
  const failure = providerFailure(error);
  return { symbol, session: null, points: [], error: failure.message, failure };
}
