import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketCard, type SubjectDay } from "@/components/markets/market-card";
import {
  loadingItem,
  subjectName,
  unavailableItem,
} from "@/components/markets/market-subjects";
import { WatchlistTable } from "@/components/markets/market-tables";
import {
  ReadFailure,
  referenceNote,
} from "@/components/markets/markets-overview";

function day(subject: string, fields: Partial<SubjectDay>): SubjectDay {
  return {
    subject,
    name: subject,
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

describe("a subject that cannot be read", () => {
  const bitcoin =
    "security:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0";

  it("shows core's curated name or its kind, never its subject ID", () => {
    expect(subjectName(bitcoin, { [bitcoin]: "Bitcoin" })).toBe("Bitcoin");
    expect(subjectName(bitcoin, {})).toBe("Crypto asset");
    expect(subjectName("listing:figi:BBG000B9Y5X2", {})).toBe("Listing");
    const reason = "No reference data on this device yet.";
    const html = renderToStaticMarkup(
      <MarketCard
        day={day(bitcoin, {
          name: "Bitcoin",
          item: unavailableItem(bitcoin, "Bitcoin", undefined, reason),
          loading: false,
          failed: true,
        })}
      />,
    );
    expect(html).toContain("Bitcoin");
    expect(html).not.toContain("caip19");
  });

  it("says reference data is missing and how to install it", () => {
    const note = referenceNote({ installed: null, refused: null });
    expect(note).toMatch(/^Reference data is not installed on this device yet/);
    expect(note).toContain("just reference-install");
    expect(referenceNote(undefined)).toBeUndefined();
    const html = renderToStaticMarkup(
      <ReadFailure
        days={[day(bitcoin, { loading: false, failed: true })]}
        message={undefined}
        reference={note}
        retry={() => undefined}
      />,
    );
    expect(html).toContain("Reference data is not installed");
    expect(html).not.toContain("Some subjects could not be read");
  });
});
