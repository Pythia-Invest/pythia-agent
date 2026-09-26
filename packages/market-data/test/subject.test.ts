import { describe, expect, it } from "vitest";
import { readSubject } from "../src/subject";

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
    expect(page.sections[0]).toMatchObject({
      section: "news",
      status: "throttled",
      alternatives: [],
    });
  });
});
