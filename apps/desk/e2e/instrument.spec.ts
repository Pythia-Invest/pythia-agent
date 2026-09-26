import { expect, type Page, test } from "@playwright/test";

/**
 * Instrument page smoke. Core identity answers, plugin reads and the price
 * widget declaration are synthetic routes, so no provider is contacted and the
 * profile's data never matters; the rest of Desk is the running stack.
 */
const primary = "listing:isin:XS0000000001:XAMS:EUR";
const secondary = "listing:isin:XS0000000001:XETR:EUR";
const lei = "529900SYNTHETIC00001";

function page_(subject: string) {
  const listing = (id: string, ticker: string, mic: string, venue: string) => ({
    id,
    ticker,
    mic,
    venue,
    currency: "EUR",
    primary: id === primary,
  });
  return {
    subject: {
      id: subject,
      level: "listing",
      name: "Synthetic Holding N.V.",
      kind: "ordinary",
    },
    identifiers: { isin: "XS0000000001", lei, ticker: "SYN", mic: "XAMS" },
    issuer: { id: `issuer:lei:${lei}`, name: "Synthetic Holding N.V.", lei },
    security: {
      id: "security:isin:XS0000000001",
      name: "Synthetic",
      isin: "XS0000000001",
    },
    listings: [
      listing(primary, "SYN", "XAMS", "Euronext Amsterdam"),
      listing(secondary, "SYN1", "XETR", "Xetra"),
    ],
    sections: [
      {
        section: "quote",
        plugin: "pythia-yahoo-discovery",
        label: "Yahoo Finance",
        status: "ready",
        binding: {
          provider: "yahoo",
          native_scope: "symbol",
          native_id: "SYN.AS",
        },
        request: null,
        alternatives: [],
        reason: null,
      },
      {
        section: "profile",
        plugin: "pythia-gleif",
        label: "GLEIF",
        status: "resolving",
        binding: null,
        request: null,
        alternatives: [],
        reason: null,
      },
      {
        section: "filings",
        plugin: "pythia-sec",
        label: "SEC EDGAR",
        status: "needs_configuration",
        binding: null,
        request: null,
        alternatives: [],
        reason:
          "SEC EDGAR needs configuration: add sec_identity to settings.json",
      },
    ],
    queue: [],
  };
}

async function routeIdentity(page: Page) {
  let release = () => {};
  const resolved = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operations: string[] = [];
  await page.route(/\/api\/data\/(read|invoke)$/u, async (route) => {
    const body = route.request().postDataJSON();
    const kind = new URL(route.request().url()).pathname.split("/").at(-1);
    operations.push(`${kind} ${body.plugin}/${body.operation}`);
    if (body.operation === "identity-subject")
      return route.fulfill({
        json: { schema_version: 1, data: page_(body.arguments.subject_id) },
      });
    if (body.operation === "identity-resolve") {
      await resolved;
      return route.fulfill({
        json: {
          schema_version: 1,
          outcome: "ok",
          data: {
            sections: [
              {
                ...page_(primary).sections[1],
                status: "ready",
                binding: {
                  provider: "gleif",
                  native_scope: "lei",
                  native_id: lei,
                },
                request: {
                  plugin: "pythia-gleif",
                  operation: "gleif-profile",
                  arguments: {
                    native_ref: {
                      provider: "gleif",
                      native_scope: "lei",
                      native_id: lei,
                    },
                  },
                },
              },
            ],
          },
        },
      });
    }
    if (body.operation === "gleif-profile")
      return route.fulfill({
        json: {
          schema_version: 1,
          data: {
            legal_name: "Synthetic Holding N.V.",
            identifiers: { lei },
            jurisdiction: "NL",
            status: "Active",
          },
        },
      });
    return route.fallback();
  });
  // No price widget is declared, so the price card fails on its own.
  await page.route("**/api/plugins/pythia-market-data/widgets", (route) =>
    route.fulfill({ json: { version: 1, widgets: [], assets: [] } }),
  );
  return { release, operations };
}

test("a chosen subject opens its page; cards load and fail independently", async ({
  page,
}) => {
  const { release, operations } = await routeIdentity(page);
  await page.goto("/workspace");
  await page.evaluate((subject_id) => {
    window.dispatchEvent(
      new CustomEvent("pythia:open-subject", { detail: { subject_id } }),
    );
  }, primary);
  await expect(page).toHaveURL(
    new RegExp(`/instrument/${encodeURIComponent(primary)}$`),
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Synthetic Holding N.V." }),
  ).toBeVisible();
  const profile = page.getByRole("region", { name: "Profile" });
  await expect(profile.getByRole("status")).toContainText(
    "Finding this instrument in GLEIF",
  );
  // Waiting on one plugin never holds up the others.
  await expect(
    page.getByRole("region", { name: "Filings" }).getByRole("note"),
  ).toContainText("Add sec_identity to settings.json.");
  await expect(
    page.getByRole("region", { name: "Quote" }).getByRole("alert"),
  ).toContainText("price widget is unavailable");
  release();
  await expect(profile.getByText("Legal name")).toBeVisible();
  // Resolution stores a binding, so it is an invoke; page reads stay reads.
  expect(operations).toContain("invoke pythia/identity-resolve");
  expect(operations).toContain("read pythia/identity-subject");

  const listings = page.getByRole("navigation", { name: "Listings" });
  await expect(listings.locator('[aria-current="page"]')).toContainText(
    "Euronext Amsterdam",
  );
  await listings.getByRole("link", { name: /SYN1/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/instrument/${encodeURIComponent(secondary)}$`),
  );
});

test("an instrument that cannot be opened says so and offers a retry", async ({
  page,
}) => {
  await page.route("**/api/data/read", (route) =>
    route.fulfill({
      json: {
        schema_version: 1,
        outcome: "empty",
        data: null,
        issues: [{ code: "unavailable", message: "Unknown subject." }],
      },
    }),
  );
  await page.goto(
    `/instrument/${encodeURIComponent("listing:synthetic:none")}`,
  );
  const failure = page
    .getByRole("alert")
    .filter({ hasText: "This instrument could not be opened." });
  await expect(failure).toContainText("Unknown subject.");
  await expect(failure.getByRole("button", { name: "Retry" })).toBeVisible();
});
