/**
 * What core answers a page that reads a device with nothing saved. The
 * synthetic Desk (stream-fixture) gives these to every spec; the instrument
 * and repairs specs route the reads they care about over them.
 */
const EMPTY: Record<string, Record<string, unknown>> = {
  "market-overview": {
    outcome: "ok",
    data: { cards: [], watchlist: [], names: {} },
  },
  "market-movers": { outcome: "empty", data: null },
  "identity-queue": { outcome: "empty", data: { items: [] } },
  "reference-status": {
    outcome: "empty",
    data: { installed: null, refused: null },
    issues: [
      { code: "empty", message: "No reference data on this device yet." },
    ],
  },
};

export function emptyCoreRead(operation: unknown) {
  const answer = typeof operation === "string" ? EMPTY[operation] : undefined;
  return answer && { schema_version: 1, issues: [], ...answer };
}
