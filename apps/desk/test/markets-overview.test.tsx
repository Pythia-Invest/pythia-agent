import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SubjectDay } from "@/components/markets/market-card";
import { loadingItem } from "@/components/markets/market-subjects";
import { WatchlistTable } from "@/components/markets/market-tables";

function day(subject: string, fields: Partial<SubjectDay>): SubjectDay {
  return {
    subject,
    item: loadingItem(subject, "", undefined),
    label: undefined,
    source: undefined,
    loading: true,
    failed: false,
    known: false,
    ...fields,
  };
}

describe("the markets watchlist", () => {
  it("waits as placeholders while any row's page or quote is still loading", () => {
    const html = renderToStaticMarkup(
      <WatchlistTable
        days={[
          // Its page answered; its quote has not.
          day("listing:figi:A", {
            item: loadingItem("listing:figi:A", "AAPL", "Apple"),
            label: { symbol: "AAPL", name: "Apple" },
            known: true,
          }),
          // Its page is still being read.
          day("listing:figi:B", {}),
        ]}
      />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("AAPL");
    expect(html).not.toContain("Data unavailable");
  });

  it("links each known row to its instrument page once the quotes answer", () => {
    const html = renderToStaticMarkup(
      <WatchlistTable
        days={[
          day("listing:figi:A", {
            item: {
              ...loadingItem("listing:figi:A", "AAPL", "Apple"),
              price: 227.5,
              activity: { session: "open", data: "current" },
              pathState: "unavailable",
            },
            label: { symbol: "AAPL", name: "Apple" },
            loading: false,
            known: true,
          }),
        ]}
      />,
    );
    expect(html).not.toContain("aria-busy");
    expect(html).toContain('aria-label="Open Apple"');
  });
});
