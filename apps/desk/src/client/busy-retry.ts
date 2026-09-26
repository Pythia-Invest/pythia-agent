import { DeskApiError } from "./browser-request";

/**
 * Native admission answers 429 while a cancelled copy of an identical read is
 * still finishing (runtime/managed/core/platform/admission.py), with
 * Retry-After: 1. Desk does not forward that header, so reads that open with a
 * page retry that transient refusal up to three times, waiting 1, 2 and 3 s;
 * every other failure stays visible at once.
 */
export const busyRetry = {
  retry: (failures: number, error: Error) =>
    error instanceof DeskApiError && error.status === 429 && failures < 3,
  retryDelay: (attempt: number) => 1_000 * (attempt + 1),
};
