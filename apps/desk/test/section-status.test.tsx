import {
  filingsSchema,
  subjectSectionSchema,
} from "@pythia/market-data/subject";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SectionPlaceholder,
  SourcesLine,
} from "@/components/instrument/section-status";
import { FilingsView } from "@/components/instrument/section-views";

const section = (fields: Record<string, unknown>) =>
  subjectSectionSchema.parse({
    section: "quote",
    plugin: "pythia-coinmarketcap",
    label: "CoinMarketCap",
    status: "ready",
    ...fields,
  });

describe("source sign-off (ADR 0042)", () => {
  it("labels a source core marks unaudited, and only that one", () => {
    const serving = renderToStaticMarkup(
      <SourcesLine
        section={section({
          plugin: "pythia-coingecko",
          label: "CoinGecko",
          unaudited: true,
        })}
      />,
    );
    expect(serving).toContain("(not yet audited)");

    const alternative = renderToStaticMarkup(
      <SourcesLine
        section={section({
          alternatives: [
            {
              plugin: "pythia-coingecko",
              label: "CoinGecko",
              status: "ready",
              unaudited: true,
            },
          ],
        })}
        onUse={() => undefined}
      />,
    );
    expect(alternative).toContain("CoinGecko (not yet audited)");
    expect(alternative.match(/not yet audited/gu)).toHaveLength(1);
  });
});

describe("an unresolved section", () => {
  it("says a match held for review awaits review, not that there is no match", () => {
    const held = section({
      status: "unresolved",
      queued: "unaudited",
      label: "EODHD",
      reason:
        "EODHD's answer is queued for review: the source is not yet audited, so its match waits for sign-off",
    });
    const placeholder = renderToStaticMarkup(
      <SectionPlaceholder section={held} level="listing" />,
    );
    expect(placeholder).toContain("EODHD match awaits review");
    expect(placeholder).not.toContain("no match");
    expect(renderToStaticMarkup(<SourcesLine section={held} />)).toContain(
      "awaiting review",
    );

    const missed = section({
      status: "unresolved",
      label: "EODHD",
      reason: "EODHD found no match",
    });
    expect(
      renderToStaticMarkup(
        <SectionPlaceholder section={missed} level="listing" />,
      ),
    ).toContain("EODHD has no match for this listing");
  });
});

describe("an empty filings list", () => {
  const skip = {
    source: "filings.xbrl.org",
    provider: "xbrl-filings",
    plugin: "pythia-xbrl-filings",
    code: "not_covering",
    reason: "filings.xbrl.org: not listed here",
  };
  it("says no source serves the entity when none answered", () => {
    const markup = renderToStaticMarkup(
      <FilingsView filings={filingsSchema.parse({ skipped: [skip] })} />,
    );
    expect(markup).toContain(
      "No filings source serves this entity: filings.xbrl.org: not listed here.",
    );
    expect(markup).not.toContain("lists no filings");
  });
  it("is the sources' honest answer when they answered", () => {
    const markup = renderToStaticMarkup(
      <FilingsView
        filings={filingsSchema.parse({
          sources: [{ source: "SEC EDGAR", plugin: "pythia-sec" }],
          skipped: [skip],
        })}
      />,
    );
    expect(markup).toContain("SEC EDGAR lists no filings for this entity.");
  });
});
