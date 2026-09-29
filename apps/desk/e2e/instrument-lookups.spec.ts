import { expect, test } from "@playwright/test";
import { lei, page_, primary } from "./instrument-fixture";

/**
 * What a page-open lookup changes: core's answers are synthetic routes that
 * follow core's rules (a miss hands the section to the next source; a source
 * found joins the combined filings), against the running Desk.
 */
test("a lookup's outcome reshapes the page: a miss hands over, a found source joins the filings", async ({
  page,
}) => {
  const gleifRef = { provider: "gleif", native_scope: "lei", native_id: lei };
  const source = (plugin: string, label: string) => ({
    source: label,
    provider: plugin.replace("pythia-", ""),
    plugin,
  });
  // Core's state: GLEIF finds no match, so the mirror leads the profile; SEC
  // is still to be looked up while filings.xbrl.org already serves filings.
  const looked = new Set<string>();
  const profile = () =>
    !looked.has("pythia-gleif")
      ? { plugin: "pythia-gleif", label: "GLEIF", status: "resolving" }
      : {
          plugin: "pythia-leimirror",
          label: "LEI mirror",
          status: looked.has("pythia-leimirror") ? "ready" : "resolving",
          skipped: [
            {
              ...source("pythia-gleif", "GLEIF"),
              code: "unresolved",
              reason: "GLEIF found no match",
            },
          ],
          binding: looked.has("pythia-leimirror") ? gleifRef : null,
          request: looked.has("pythia-leimirror")
            ? {
                plugin: "pythia-leimirror",
                operation: "profile",
                arguments: { native_ref: gleifRef },
              }
            : null,
        };
  const filingsRequest = {
    plugin: "pythia",
    operation: "filings",
    arguments: { subject_id: `issuer:lei:${lei}` },
  };
  const sections = () => [
    { section: "profile", via: "issuer", alternatives: [], ...profile() },
    {
      section: "filings",
      via: "issuer",
      plugin: "pythia-xbrl-filings",
      label: "filings.xbrl.org",
      status: "ready",
      request: filingsRequest,
      alternatives: [],
      skipped: looked.has("pythia-sec")
        ? []
        : [
            {
              ...source("pythia-sec", "SEC EDGAR"),
              code: "resolving",
              reason: "Looking up in SEC EDGAR",
            },
          ],
    },
  ];
  const resolved: string[] = [];
  await page.route(/\/api\/data\/(read|invoke)$/u, async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "identity-subject")
      return route.fulfill({
        json: {
          schema_version: 1,
          outcome: "ok",
          data: { ...page_(body.arguments.subject_id), sections: sections() },
        },
      });
    if (body.operation === "identity-resolve") {
      resolved.push(body.arguments.plugin);
      looked.add(body.arguments.plugin);
      const served =
        body.arguments.plugin === "pythia-sec" ? "filings" : "profile";
      return route.fulfill({
        json: {
          schema_version: 1,
          outcome: "ok",
          data: {
            sections: sections().filter((item) => item.section === served),
          },
        },
      });
    }
    if (body.operation === "profile")
      return route.fulfill({
        json: {
          schema_version: 1,
          outcome: "ok",
          data: { legal_name: "Synthetic Holding N.V." },
        },
      });
    if (body.operation === "filings") {
      const sec = looked.has("pythia-sec");
      const filing = (form: string, authority: string, plugin: string) => ({
        id: `${form}-1`,
        kind: "annual",
        form,
        period_end: "2025-12-31",
        filed_at: "2026-02-10",
        authority,
        source: plugin,
      });
      return route.fulfill({
        json: {
          schema_version: 1,
          outcome: sec ? "ok" : "partial",
          data: {
            filings: [
              filing("ESEF", "oam-nl", "filings.xbrl.org"),
              ...(sec ? [filing("20-F", "sec", "SEC EDGAR")] : []),
            ],
            sources: [
              { source: "filings.xbrl.org", plugin: "pythia-xbrl-filings" },
              ...(sec ? [{ source: "SEC EDGAR", plugin: "pythia-sec" }] : []),
            ],
            skipped: sec
              ? []
              : [
                  {
                    ...source("pythia-sec", "SEC EDGAR"),
                    code: "resolving",
                    reason:
                      "SEC EDGAR has not been looked up for this company yet",
                  },
                ],
            partial: !sec,
          },
        },
      });
    }
    return route.fallback();
  });
  await page.route("**/api/plugins/pythia-market-data/widgets", (route) =>
    route.fulfill({ json: { version: 1, widgets: [], assets: [] } }),
  );
  await page.goto(`/instrument/${encodeURIComponent(primary)}`);
  const profileCard = page.getByRole("region", { name: "Profile" });
  await expect(profileCard.getByText("Legal name")).toBeVisible();
  await expect(
    profileCard.locator('[data-slot="instrument-sources"]'),
  ).toContainText("LEI mirror");
  const filings = page.getByRole("region", { name: "Filings" });
  await expect(filings.getByText("20-F")).toBeVisible();
  await expect(filings.getByText("Partial list")).toHaveCount(0);
  expect(resolved.sort()).toEqual([
    "pythia-gleif",
    "pythia-leimirror",
    "pythia-sec",
  ]);
});
