import { describe, expect, it } from "vitest";
import {
  filingDocumentSchema,
  filingsSchema,
  parseFilings,
  profileSchema,
  readSubject,
} from "../src/subject";

describe("subject page client", () => {
  it("reads a page whose later section types and statuses it does not know", async () => {
    const page = await readSubject(
      {
        read: async (request) => {
          expect(request).toMatchObject({
            plugin: "pythia",
            operation: "identity-subject",
            arguments: { subject_id: "security:isin:XS0000000001" },
          });
          return {
            schema_version: 1,
            data: {
              subject: {
                id: "security:isin:XS0000000001",
                level: "security",
                name: "Synthetic",
                kind: "future_kind",
              },
              // Empty text means "not known", never a failed page.
              identifiers: { ticker: "", isin: "XS0000000001" },
              listings: [{ id: "listing:synthetic", ticker: "", currency: "" }],
              // A kind or relation this client does not know yet is passed through.
              related: [
                {
                  id: "venue:pythia:synthetic",
                  type: "future_relation",
                  direction: "sideways",
                  kind: "venue",
                },
              ],
              sections: [
                {
                  section: "news",
                  plugin: "pythia-synthetic-news",
                  label: "Synthetic news",
                  status: "throttled",
                },
              ],
            },
          };
        },
      },
      "security:isin:XS0000000001",
    );
    expect(page.subject.kind).toBeNull();
    expect(page.identifiers).toEqual({ ticker: null, isin: "XS0000000001" });
    expect(page.listings[0]).toMatchObject({ ticker: null, currency: null });
    expect(page.related).toEqual([
      {
        id: "venue:pythia:synthetic",
        type: "future_relation",
        direction: null,
        kind: "venue",
        name: null,
      },
    ]);
    expect(page.sections[0]).toMatchObject({
      section: "news",
      status: "throttled",
      alternatives: [],
    });
  });
});

describe("filings answers", () => {
  it("fail when every source failed, though core lists what it tried (D1)", () => {
    const tried = { filings: [], sources: [], skipped: [], partial: false };
    expect(() =>
      parseFilings({
        schema_version: 1,
        outcome: "error",
        data: tried,
        issues: [
          {
            code: "unavailable",
            message: "No filings source could be read: SEC EDGAR: rate limited",
          },
        ],
      }),
    ).toThrow("No filings source could be read: SEC EDGAR: rate limited");
    expect(
      parseFilings({ schema_version: 1, outcome: "empty", data: tried }),
    ).toMatchObject({ filings: [] });
  });
});

describe("the links a source supplies", () => {
  // Every field a source fills with an address for the page to link to.
  const links = (url: string) => {
    const source = { label: "Synthetic", url };
    const filings = filingsSchema.parse({
      filings: [{ url }],
      source,
      sources: [{ source: "Synthetic", plugin: "synthetic", url }],
    });
    const document = filingDocumentSchema.parse({
      document: { id: "d1", url },
      citation: { section: "s1", url },
    });
    return [
      filings.filings[0]?.url,
      filings.source?.url,
      filings.sources[0]?.url,
      profileSchema.parse({ source }).source?.url,
      document.document.url,
      document.citation?.url,
    ];
  };

  it("keep a web address", () => {
    for (const url of [
      "https://example.test/filing#part",
      "http://example.test/filing",
    ])
      expect(links(url)).toEqual(Array(6).fill(url));
  });

  it("drop any other scheme, and an address that is not absolute", () => {
    for (const url of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "data:text/html,synthetic",
      "file:///synthetic",
      "/filings/synthetic",
      "synthetic",
    ])
      expect(links(url)).toEqual(Array(6).fill(null));
  });
});
