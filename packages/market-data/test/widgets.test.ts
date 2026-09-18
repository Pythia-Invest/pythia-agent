import { describe, expect, it } from "vitest";
import {
  financialBinding,
  financialInput,
  financialQueryKey,
  type FinancialWidgetInput,
} from "../src/widgets/index.js";

const input: FinancialWidgetInput = {
  widget: "instrument-tile",
  source: {
    feed: "prices",
    subjects: [
      {
        subject: { kind: "listing", id: "listing:fixture" },
        symbol: "FIX",
        name: "Fixture",
        price: { mode: "preferred", criteria: { currency: "USD" } },
        history: {
          selection: { mode: "preferred", criteria: { currency: "USD" } },
          window: { kind: "sessions", days: 5 },
          completion: "completed",
        },
      },
    ],
  },
};

describe("feature-owned widget binding", () => {
  it("shares quote identity across renderers and delays bounded history until a quote exists", () => {
    const [quote] = financialBinding.queries(input);
    const row = input.source.subjects[0];
    if (!row) throw Error("Missing synthetic subject.");
    expect(quote?.key).toEqual(financialQueryKey(row, "latest"));
    expect(
      financialBinding.queries({ ...input, widget: "instrument-table" })[0]
        ?.key,
    ).toEqual(quote?.key);
    expect(
      financialBinding.deferred?.(input, [{ error: null, isPending: true }])[0]
        ?.enabled,
    ).toBe(false);
    const histories = financialBinding.deferred?.(input, [
      {
        data: { result: {} as never, refreshAfterSeconds: 60 },
        error: null,
        isPending: false,
      },
    ]);
    expect(histories?.[0]?.enabled).toBe(true);
    expect(histories?.[0]?.resource.window).toEqual({
      kind: "sessions",
      days: 5,
    });
    const request = histories?.[0]?.resource.arguments.reads as {
      request: { window: unknown; requirements: unknown };
    }[];
    expect(request[0]?.request.window).toEqual({ start: null, end: null });
    expect(request[0]?.request.requirements).toMatchObject({
      completion: "completed",
    });
    expect(
      financialBinding.deferred?.(
        { ...input, widget: "instrument-compact-tile" },
        [],
      ),
    ).toEqual([]);
    expect(
      financialBinding.deferred?.({ ...input, options: { path: false } }, []),
    ).toEqual([]);
  });
  it("retains canonical request meaning and aligns explicit history retry windows", () => {
    const row = input.source.subjects[0];
    if (!row) throw Error("Missing synthetic subject.");
    const first = financialInput(
      row,
      "history",
      Date.parse("2026-09-18T15:01:20Z"),
    );
    const second = financialInput(
      row,
      "history",
      Date.parse("2026-09-18T15:01:59Z"),
    );
    expect(first).toEqual(second);
    expect(first?.request.view).toEqual({
      kind: "pythia",
      subject: row.subject,
    });
    expect(first?.request.window).toEqual({
      start: { kind: "session_date", value: "2026-09-13" },
      end: { kind: "session_date", value: "2026-09-18" },
    });
    expect(first?.criteria).toEqual(
      row.price.mode === "preferred" ? row.price.criteria : undefined,
    );
    expect(financialBinding.queries(input)[0]?.readResource?.()).toMatchObject({
      plugin: "pythia-market-data",
      operation: "query",
      arguments: { action: "read_many" },
    });
  });
  it("renders known identity without fake prices while loading and rejects invalid read envelopes", () => {
    const result = financialBinding.render(
      input,
      [{ error: null, isPending: true }],
      [],
      { formatTimestamp: () => "fixture" },
    );
    expect(result.state).toBe("loading");
    expect(result.data.rows[0]).toMatchObject({
      id: "listing:fixture",
      name: "Fixture",
      price: null,
      status: "unknown",
      pathState: "loading",
    });
    expect(() =>
      financialBinding.queries(input)[0]?.decode({ outcome: "ok", data: [] }),
    ).toThrow("Invalid financial response");
  });
});
