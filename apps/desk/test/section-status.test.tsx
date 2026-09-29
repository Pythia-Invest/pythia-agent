import {
  filingsSchema,
  profileSchema,
  subjectSectionSchema,
} from "@pythia/market-data/subject";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SectionPlaceholder,
  SourcesLine,
} from "@/components/instrument/section-status";
import { FilingsView } from "@/components/instrument/filings-view";
import { ProfileView } from "@/components/instrument/section-views";

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
    expect(markup).toContain("No filings source serves this entity.");
    expect(markup).toContain("<li>filings.xbrl.org: not listed here.</li>");
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

describe("a listing no price source covers", () => {
  it("says so and lists each source's reason", () => {
    const markup = renderToStaticMarkup(
      <SectionPlaceholder
        section={section({
          plugin: "pythia",
          label: "Pythia",
          status: "not_covering",
          reason: "No price source covers this listing",
          skipped: [
            {
              source: "Yahoo Finance",
              provider: "yahoo",
              plugin: "pythia-yahoo",
              code: "not_addressable",
              reason: "Yahoo Finance has no address for this listing",
            },
          ],
        })}
        level="listing"
      />,
    );
    expect(markup).toContain("No price source covers this listing");
    expect(markup).toContain(
      "<li>Yahoo Finance has no address for this listing.</li>",
    );
  });
});

describe("reports of one period", () => {
  it("name a parallel report and one report filed in two places", () => {
    const period = "issuer|annual|2025-12-31";
    const esef = (authority: string) => ({
      id: `esef-${authority}`,
      kind: "annual",
      form: "ESEF",
      period_end: "2025-12-31",
      report_period: period,
      report_key: `${period}|${authority}`,
      authority,
      source: "filings.xbrl.org",
      url: `https://example.test/${authority}`,
    });
    const markup = renderToStaticMarkup(
      <FilingsView
        filings={filingsSchema.parse({
          filings: [
            esef("fca"),
            {
              id: "20-F",
              kind: "annual",
              form: "20-F",
              period_end: "2025-12-31",
              report_period: period,
              report_key: `${period}|sec`,
              authority: "sec",
              basis: "us_gaap",
              source: "SEC EDGAR",
            },
            esef("oam-nl"),
          ],
          sources: [
            { source: "SEC EDGAR", plugin: "pythia-sec" },
            { source: "filings.xbrl.org", plugin: "pythia-xbrl-filings" },
          ],
        })}
      />,
    );
    expect(markup).toContain("filed in UK, Netherlands · filings.xbrl.org");
    expect(markup).toContain("Also filed with the SEC (20-F, US GAAP)");
    expect(markup).toContain("Also filed in UK, Netherlands (ESEF)");
  });
});

describe("a GLEIF profile", () => {
  it("shows a parent GLEIF names only by LEI, codes in words and a Latin name", () => {
    const markup = renderToStaticMarkup(
      <ProfileView
        profile={profileSchema.parse({
          legal_name: "トヨタ自動車株式会社",
          status: "ACTIVE",
          category: "GENERAL",
          parent: { name: null, lei: "KY37LUS27QQX7BB93L28" },
          names: [
            { name: "トヨタ自動車株式会社", kind: "legal" },
            {
              name: "TOYOTA JIDOSHA KABUSHIKI KAISHA",
              kind: "transliterated",
              type: "AUTO_ASCII_TRANSLITERATED_LEGAL_NAME",
            },
            {
              name: "TOYOTA MOTOR CORPORATION",
              kind: "other",
              type: "ALTERNATIVE_LANGUAGE_LEGAL_NAME",
            },
          ],
        })}
      />,
    );
    expect(markup).toContain("LEI KY37LUS27QQX7BB93L28");
    expect(markup).toContain(">Active<");
    expect(markup).toContain(">General<");
    expect(markup).toMatch(
      /Legal name<\/dt><dd[^>]*>TOYOTA MOTOR CORPORATION/u,
    );
    expect(markup).toContain("トヨタ自動車株式会社");
  });
});
