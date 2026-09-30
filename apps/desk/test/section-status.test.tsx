import {
  filingsSchema,
  profileSchema,
  subjectPageSchema,
  subjectSectionSchema,
} from "@pythia/market-data/subject";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InstrumentHeader } from "@/components/instrument/instrument-header";
import {
  SectionPlaceholder,
  SourcesLine,
} from "@/components/instrument/section-status";
import { FilingsView } from "@/components/instrument/filings-view";
import { ProfileView } from "@/components/instrument/section-views";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

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

describe("a suspended section", () => {
  it("says the binding is kept but not used, with core's reason", () => {
    const placeholder = renderToStaticMarkup(
      <SectionPlaceholder
        section={section({
          status: "suspended",
          label: "Yahoo Finance",
          reason:
            "This line no longer trades; its ticker may now name another company",
        })}
        level="listing"
      />,
    );
    expect(placeholder).toContain("Yahoo Finance is suspended for this line");
    expect(placeholder).toContain(
      "This line no longer trades; its ticker may now name another company.",
    );
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

describe("a share whose issuer the reference leaves undecided", () => {
  const page = (fields: Record<string, unknown>) =>
    subjectPageSchema.parse({
      subject: {
        id: "security:isin:CH0038863350",
        level: "security",
        name: "Nestle SA",
        kind: "ordinary",
      },
      security: { id: "security:isin:CH0038863350", name: "Nestle SA" },
      ...fields,
    });

  it("says the issuer is unknown in the header, and only then", () => {
    const header = (fields: Record<string, unknown>) =>
      renderToStaticMarkup(
        <InstrumentHeader page={page(fields)} subjectId="security:x" />,
      );
    expect(header({})).toContain(
      "Issuer unknown: the reference data doesn&#x27;t settle which company",
    );
    const issued = header({
      issuer: { id: "issuer:lei:X", name: "Nestlé S.A." },
    });
    expect(issued).toContain("Issued by Nestlé S.A.");
    expect(issued).not.toContain("Issuer unknown");
    const coin = header({ subject: { ...page({}).subject, kind: "coin" } });
    expect(coin).not.toContain("Issuer unknown");
  });

  it("says why a saved instrument opens as a stub", () => {
    const stub = renderToStaticMarkup(
      <InstrumentHeader
        page={subjectPageSchema.parse({
          subject: {
            id: "security:isin:CH0038863350",
            level: "security",
            name: "security:isin:CH0038863350",
            description: "No reference data on this device yet.",
          },
        })}
        subjectId="security:isin:CH0038863350"
      />,
    );
    expect(stub).toContain("No reference data on this device yet.");
  });

  it("has company cards that say they need the issuer", () => {
    const markup = renderToStaticMarkup(
      <SectionPlaceholder
        section={section({
          section: "profile",
          plugin: "pythia",
          label: "Pythia",
          status: "not_addressable",
          reason:
            "Needs the issuer: the reference data doesn't settle which company issued this",
          skipped: [
            {
              source: "GLEIF",
              provider: "gleif",
              plugin: "pythia-gleif",
              code: "not_addressable",
              reason: "GLEIF has no address for this listing",
            },
          ],
        })}
        level="security"
      />,
    );
    expect(markup).toContain("Needs the issuer");
    expect(markup).not.toContain("reference data");
    expect(markup).not.toContain("GLEIF");
  });
});

describe("an identifier whose sources disagree", () => {
  const page = (fields: Record<string, unknown>) =>
    subjectPageSchema.parse({
      subject: {
        id: "security:isin:XS0000000009",
        level: "security",
        name: "Example plc",
      },
      security: { id: "security:isin:XS0000000009", name: "Example plc" },
      issuer: {
        id: "issuer:lei:X",
        name: "Example plc",
        lei: "EXAMPLE0000000000000",
      },
      ...fields,
    });
  const header = (fields: Record<string, unknown>) =>
    renderToStaticMarkup(
      <InstrumentHeader page={page(fields)} subjectId="security:x" />,
    );

  it("shows each value with its sources where the identifier goes, not a blank", () => {
    const markup = header({
      contested: {
        isin: [
          { value: "XS0000000009", sources: ["source-a"] },
          { value: "XS0000000017", sources: ["source-b", "source-c"] },
        ],
      },
    });
    expect(markup).toMatch(
      /<dt[^>]*>ISIN<\/dt><dd data-slot="instrument-identifier-contested"/u,
    );
    expect(markup).toContain("XS0000000009");
    expect(markup).toContain("(source-a)");
    expect(markup).toContain("XS0000000017");
    expect(markup).toContain("(source-b, source-c)");
    expect(markup).toContain("sources disagree");
    expect(markup).toContain("EXAMPLE0000000000000"); // the settled identifiers are shown as before
  });

  it("says nothing of disagreement when the sources agree", () => {
    const markup = header({ identifiers: { isin: "XS0000000009" } });
    expect(markup).toContain("XS0000000009");
    expect(markup).not.toContain("sources disagree");
  });
});

describe("a subject a plugin introduced", () => {
  // What core's `identity-subject` lists for a pool a DeFi plugin introduced.
  const header = (source: Record<string, unknown> | null) =>
    renderToStaticMarkup(
      <InstrumentHeader
        page={subjectPageSchema.parse({
          subject: {
            id: "market:provisional:tidepool:pool:P1",
            level: "market",
            name: "Example Lend USDC",
          },
          contributors: source
            ? [
                {
                  plugin: "tidepool",
                  label: "Tidepool",
                  status: "enabled",
                  stated: [],
                  introduced: true,
                  not_offered_since: null,
                  ...source,
                },
              ]
            : [],
        })}
        subjectId="market:provisional:tidepool:pool:P1"
      />,
    );

  it("names its source, and says when that source is off or no longer offers it", () => {
    expect(header({})).toContain("From Tidepool</p>");
    expect(header({ status: "paused" })).toContain(
      "From Tidepool, which is paused",
    );
    expect(header({ status: "disabled" })).toContain(
      "From Tidepool, which is disabled",
    );
    expect(header({ status: "removed" })).toContain(
      "From Tidepool, which is no longer installed",
    );
    expect(
      header({ status: "disabled", not_offered_since: "2026-09-30T08:00:00Z" }),
    ).toContain(
      "From Tidepool, which is disabled and no longer offers it (since 2026-09-30)",
    );
    expect(header({ status: "later" })).toContain("From Tidepool</p>"); // an unknown status reads as on
  });

  it("says nothing for a subject no plugin introduced", () => {
    expect(header(null)).not.toContain('data-slot="instrument-source"');
    expect(header({ introduced: false })).not.toContain("From Tidepool");
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
    expect(markup).toContain("Parallel report: SEC 20-F (US GAAP)");
    expect(markup).toContain("Parallel report: UK, Netherlands ESEF");
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
              name: "TOYOTA OLD NAME K.K.",
              kind: "other",
              type: "PREVIOUS_LEGAL_NAME",
            },
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
    expect(markup).not.toContain("TOYOTA OLD NAME");
  });
});
