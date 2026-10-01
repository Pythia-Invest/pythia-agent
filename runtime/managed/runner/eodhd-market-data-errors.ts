/** Fixed provider diagnostics; response text and credential-bearing URLs never cross the worker. */
import { EODHDError, EODHDRateLimitError } from "eodhd";
import { providerFailure } from "./provider-errors.js";
const fixed = new Set([
  "invalid_request",
  "invalid_response",
  "invalid_window",
  "binding_mismatch",
]);
export function failure(error: unknown) {
  const detail = providerFailure(error);
  if (detail.origin && !(error instanceof EODHDError && error.statusCode > 0))
    return {
      data: null,
      complete: false,
      issues: [detail.code],
      failure: detail,
      retry_after: detail.retry_after_seconds ?? null,
      limit_origin: detail.origin,
    };
  if (error instanceof EODHDError)
    return {
      data: null,
      complete: false,
      issues: [
        error.statusCode === 401
          ? "authentication_failed"
          : error.statusCode === 403
            ? "access_denied"
            : error.statusCode === 429
              ? "rate_limit"
              : error.code === "timeout"
                ? "timeout"
                : error.code === "network_error"
                  ? "network_error"
                  : "provider_error",
      ],
      http_status: error.statusCode,
      retry_after:
        error instanceof EODHDRateLimitError &&
        Number.isFinite(error.retryAfter) &&
        (error.retryAfter ?? -1) >= 0
          ? (error.retryAfter ?? null)
          : null,
    };
  return {
    data: null,
    complete: false,
    failure: detail,
    retry_after: detail.retry_after_seconds ?? null,
    limit_origin: detail.origin,
    issues: [
      error instanceof Error && fixed.has(error.message)
        ? error.message
        : detail.code,
    ],
  };
}

/** The SDK wraps arbitrary fetch exceptions as network errors. Preserve only
 * our typed permit failure using its documented error base class. */
export function sdkFailure(error: unknown) {
  const detail = providerFailure(error);
  return detail.origin
    ? Object.assign(new EODHDError(detail.message, 0), {
        code: detail.code,
        origin: detail.origin,
        retry_after_seconds: detail.retry_after_seconds,
      })
    : error;
}
