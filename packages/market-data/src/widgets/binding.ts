import type {
  InstrumentRead,
  InstrumentWidgetOptions,
} from "@pythia/widget-sdk";
import {
  financialInput,
  financialQueryKey,
  readResultSchema,
  type FinancialRead,
  type FinancialSource,
} from "./contract";
import { financialInstrument } from "./display";
import type { WidgetBinding, WidgetQuery } from "./types";

export type FinancialWidgetInput = {
  source: FinancialSource;
  widget: string;
  options?: InstrumentWidgetOptions | undefined;
};

/** The feature defines what its presentations display; the host only coordinates reads. */
export function widgetShowsHistory(
  block: Pick<FinancialWidgetInput, "widget" | "options">,
) {
  return (
    block.options?.path !== false &&
    block.widget !== "instrument-compact-tile" &&
    !(block.widget === "instrument-tile" && block.options?.compact)
  );
}

export function financialQueries(
  source: FinancialSource,
  operation: "latest" | "history",
  enabled = true,
): WidgetQuery<FinancialRead>[] {
  return source.subjects.map((row) => {
    const input = financialInput(row, operation, 0);
    // Native demand expands this declared window at read time. Descriptors and
    // query keys stay stable while rolling endpoints move together.
    if (input && operation === "history")
      input.request.window = { start: null, end: null };
    return {
      key: financialQueryKey(row, operation),
      resource: {
        plugin: "pythia-market-data",
        operation: "query",
        arguments: input
          ? { action: "read_many", reads: [input] }
          : { action: "get_preferences" },
        ...(operation === "history" && row.history
          ? { window: row.history.window }
          : {}),
      },
      enabled: enabled && input !== undefined,
      readResource: () => {
        const request = financialInput(row, operation, Date.now());
        if (!request) throw Error("No financial request is configured.");
        return {
          plugin: "pythia-market-data",
          operation: "query",
          arguments: { action: "read_many", reads: [request] },
        };
      },
      decode(value) {
        const raw = value as {
          outcome?: string;
          data?: unknown[];
          delivery?: { max_age_seconds?: number[] };
        };
        if (raw.outcome !== "ok" || raw.data?.length !== 1)
          throw Error("Invalid financial response.");
        return {
          result: readResultSchema.parse(raw.data[0]),
          refreshAfterSeconds: Math.max(
            15,
            raw.delivery?.max_age_seconds?.[0] ?? 60,
          ),
        };
      },
    };
  });
}

export const financialBinding: WidgetBinding<
  FinancialWidgetInput,
  FinancialRead,
  InstrumentRead
> = {
  queries: (input) => financialQueries(input.source, "latest"),
  deferred: (input, quotes) =>
    widgetShowsHistory(input)
      ? financialQueries(
          input.source,
          "history",
          quotes.some((quote) => Boolean(quote.data)),
        )
      : [],
  render(input, quotes, histories, { formatTimestamp }) {
    const rows = input.source.subjects.map((row, index) =>
      financialInstrument(
        row,
        quotes[index]?.data?.result,
        histories[index]?.data?.result,
        histories[index]?.isPending ?? false,
        formatTimestamp,
      ),
    );
    rows.forEach((row, index) => {
      if (
        (quotes[index]?.error && quotes[index]?.data) ||
        (histories[index]?.error && histories[index]?.data)
      ) {
        row.activity = {
          ...row.activity,
          session: row.activity?.session ?? "unknown",
          data: "stale",
        };
        row.statusLabel = "Updates unavailable · last received value";
        if (histories[index]?.error && row.path)
          row.path = {
            ...row.path,
            label: `${row.path.label} · Chart updates unavailable`,
          };
      }
    });
    const loading = rows.length > 0 && quotes.every((query) => query.isPending);
    const failedPrices = quotes.some(
      (query) => query.error || query.data?.result.outcome === "error",
    );
    const failedHistories = histories.some(
      (query) => query.error || query.data?.result.outcome === "error",
    );
    const state = !rows.length ? "empty" : loading ? "loading" : "ready";
    const message =
      failedPrices || failedHistories
        ? `${failedPrices ? "Some prices could not be loaded. " : ""}${failedHistories ? "Some charts could not be loaded. " : ""}Any retained values are marked as stale.`
        : undefined;
    return {
      state,
      ...(message ? { message } : {}),
      data: {
        rows: loading
          ? rows.map((row) => ({
              ...row,
              price: null,
              status: "unknown",
              statusLabel: "Loading quote",
              pathState: "loading",
            }))
          : rows,
        state,
        ...(message ? { message } : {}),
      },
    };
  },
};
