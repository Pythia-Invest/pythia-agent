import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketCard, type SubjectDay } from "@/components/markets/market-card";
import {
  dayItem,
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
    const installed = {
      build_id: "reference-20260926",
      as_of: "2026-09-26",
      built_at: "2026-09-26T20:38:00Z",
      format_version: 2,
      installed_at: null,
      sources: [],
      notices: [],
    };
    expect(
      referenceNote({ installed: { ...installed, compatible: true } }),
    ).toBeUndefined();
    const incompatible = referenceNote({
      installed: { ...installed, compatible: false },
    });
    expect(incompatible).toMatch(/reference-20260926 is not compatible/);
    expect(incompatible).toContain("just reference-install");
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

describe("a card's quote as read", () => {
  const row = {
    id: "0",
    ticker: "EUR/USD",
    price: 1.1312,
    status: "delayed" as const,
    activity: {
      session: "open" as const,
      data: "delayed" as const,
      delayMinutes: 15,
    },
    statusLabel: "Market open",
    description: "yahoo · EURUSD=X · aggregate price · unknown · 1 tick",
    path: {
      points: [
        { time: 0, value: 1.13 },
        { time: 60_000, value: 1.1312 },
      ],
      label:
        "yahoo · EURUSD=X · ohlc · unknown · 2 minute · Session 2026-09-28",
      baseline: {
        value: 1.13,
        label: "Previous close · Yahoo:quote:regularMarketPreviousClose",
      },
    },
  };

  it("hovers the source and its delay in words, and shows a pair's pips", () => {
    const item = dayItem(row, "fx:pythia:EURUSD", "Yahoo Finance");
    expect(item.id).toBe("fx:pythia:EURUSD");
    expect(item.precision).toBe(4);
    expect(item.path?.label).toBe("Yahoo Finance · 15 min delayed");
    expect(item.path?.baseline?.label).toBe("Previous close");
    const html = renderToStaticMarkup(
      <MarketCard day={day("fx:pythia:EURUSD", { item, loading: false })} />,
    );
    expect(html).toContain("1.1312");
    expect(html).not.toContain("Yahoo:quote");
  });

  it("keeps two decimals outside currency pairs and for yen-style quotes", () => {
    expect(dayItem(row, "index:pythia:sp500", "Yahoo Finance").precision).toBe(
      undefined,
    );
    expect(
      dayItem({ ...row, price: 147.23 }, "fx:pythia:USDJPY", undefined)
        .precision,
    ).toBe(2);
  });
});
