import { expect, type Page, test } from "@playwright/test";

/**
 * Instrument page smoke. Core identity answers, plugin reads and the price
 * widget declaration are synthetic routes, so no provider is contacted and the
 * profile's data never matters; the rest of Desk is the running stack.
 */
const primary = "listing:isin:XS0000000001:XAMS:EUR";
const secondary = "listing:isin:XS0000000001:XETR:EUR";
/** Registry shares that fold into the instrument: a line of its own security. */
const receipt = "listing:figi:BBG0SYNTHADR";
/** The instrument itself: the security the receipt folds into. */
const security = "security:isin:XS0000000001";
const lei = "529900SYNTHETIC00001";

function page_(subject: string) {
  const listing = (id: string, ticker: string, mic: string, venue: string) => ({
    id,
    ticker,
    mic,
    venue,
    currency: id === receipt ? "USD" : "EUR",
    primary: id === primary,
    kind: id === receipt ? "depositary_receipt" : "ordinary",
    folded: id === receipt,
  });
  const ofReceipt = subject === receipt;
  return {
    subject: {
      id: subject,
      level: subject === security ? "security" : "listing",
      name: "Synthetic Holding N.V.",
      kind: ofReceipt ? "depositary_receipt" : "ordinary",
      listing: subject === security ? primary : subject,
    },
    identifiers: ofReceipt
      ? { isin: "US0000000002", lei, ticker: "SYNY", mic: "XNAS" }
      : { isin: "XS0000000001", lei, ticker: "SYN", mic: "XAMS" },
    issuer: { id: `issuer:lei:${lei}`, name: "Synthetic Holding N.V.", lei },
    security: {
      id: "security:isin:XS0000000001",
      name: "Synthetic",
      isin: "XS0000000001",
    },
    listings: [
      listing(primary, "SYN", "XAMS", "Euronext Amsterdam"),
      listing(secondary, "SYN1", "XETR", "Xetra"),
      listing(receipt, "SYNY", "XNAS", "Nasdaq"),
    ],
    sections: [
      {
        section: "quote",
        plugin: ofReceipt ? "pythia-eodhd" : "pythia-yahoo-discovery",
        label: ofReceipt ? "EODHD" : "Yahoo Finance",
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
  const profile = {
    ...page_(primary).sections[1],
    status: "ready",
    binding: { provider: "gleif", native_scope: "lei", native_id: lei },
    request: {
      plugin: "pythia-gleif",
      operation: "profile",
      arguments: {
        native_ref: { provider: "gleif", native_scope: "lei", native_id: lei },
      },
    },
  };
  // Once resolved, core stores the binding: later compositions are ready.
  let bound = false;
  await page.route(/\/api\/data\/(read|invoke)$/u, async (route) => {
    const body = route.request().postDataJSON();
    const kind = new URL(route.request().url()).pathname.split("/").at(-1);
    operations.push(`${kind} ${body.plugin}/${body.operation}`);
    if (body.operation === "identity-subject") {
      const view = page_(body.arguments.subject_id);
      const sections = view.sections.map((section) =>
        bound && section.section === "profile" ? profile : section,
      );
      return route.fulfill({
        json: { schema_version: 1, data: { ...view, sections } },
      });
    }
    if (body.operation === "identity-search") {
      const row = (id: string, ticker: string, kind: string, extra = {}) => ({
        id,
        instrument: security,
        ticker,
        name: "Synthetic Holding N.V.",
        kind,
        mic: null,
        venue: null,
        country: null,
        currency: null,
        ...extra,
      });
      return route.fulfill({
        json: {
          schema_version: 1,
          outcome: "ok",
          data: {
            groups: [
              {
                id: `issuer:lei:${lei}`,
                name: "Synthetic Holding N.V.",
                kind: "ordinary",
                listings: 3,
                rows: [
                  row(primary, "SYN", "ordinary", {
                    mic: "XAMS",
                    venue: "Euronext Amsterdam",
                    country: "NL",
                    currency: "EUR",
                  }),
                  row(receipt, "SYNY", "depositary_receipt", {
                    mic: "XNAS",
                    venue: "Nasdaq",
                    country: "US",
                    currency: "USD",
                  }),
                ],
              },
            ],
            lookup: [],
          },
        },
      });
    }
    if (body.operation === "identity-resolve") {
      await resolved;
      bound = true;
      return route.fulfill({
        json: {
          schema_version: 1,
          outcome: "ok",
          data: { sections: [profile] },
        },
      });
    }
    if (body.plugin === "pythia-gleif" && body.operation === "profile")
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

  // The listing is a selector on the instrument's page: switching changes the
  // price source and the URL, while the issuer's profile keeps its read.
  const selector = page.getByRole("button", {
    name: /^Listing: SYN · Euronext Amsterdam · EUR/,
  });
  await selector.click();
  const other = page.getByRole("menuitemradio", { name: /SYN1/ });
  await expect(
    page.getByRole("menuitemradio", { checked: true }),
  ).toContainText("SYN");
  await other.click();
  // A pick closes the menu and names the new listing at once.
  await expect(page.getByRole("menuitemradio")).toHaveCount(0);
  await expect(page).toHaveURL(
    new RegExp(
      `/instrument/${encodeURIComponent(primary)}\\?listing=${encodeURIComponent(secondary)}$`,
    ),
  );
  await expect(
    page.getByRole("button", { name: /^Listing: SYN1 · Xetra · EUR/ }),
  ).toBeVisible();
  await expect(profile.getByText("Legal name")).toBeVisible();
  expect(
    operations.filter((operation) => operation === "read pythia-gleif/profile"),
  ).toHaveLength(1);
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

test("subject ids with '/' and '%' reach core exactly once decoded", async ({
  page,
}) => {
  // A CAIP-19 asset id contains "/"; core's grammar also allows "%".
  const subject =
    "security:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0%41";
  const asked: string[] = [];
  await page.route("**/api/data/read", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== "identity-subject") return route.fallback();
    asked.push(body.arguments.subject_id);
    return route.fulfill({
      json: {
        schema_version: 1,
        outcome: "ok",
        data: {
          subject: {
            id: subject,
            level: "security",
            name: "Bitcoin",
            kind: "coin",
          },
          identifiers: { ticker: "BTC", currency: "" },
          sections: [],
        },
      },
    });
  });
  await page.goto(`/instrument/${encodeURIComponent(subject)}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Bitcoin" }),
  ).toBeVisible();
  expect(new Set(asked)).toEqual(new Set([subject]));
});

test("busy native admission (429) is retried instead of shown", async ({
  page,
}) => {
  // Admission refuses an identical read while a cancelled copy still runs.
  const busy = new Set(["identity-subject", "profile", "widgets"]);
  const refuse = (key: string) => busy.delete(key);
  const tooBusy = {
    status: 429,
    json: {
      error: { code: "busy", message: "Requests are busy; try again shortly." },
    },
  };
  await page.route("**/api/plugins/pythia-market-data/widgets", (route) =>
    refuse("widgets")
      ? route.fulfill(tooBusy)
      : route.fulfill({ json: { version: 1, widgets: [], assets: [] } }),
  );
  await page.route("**/api/data/read", async (route) => {
    const body = route.request().postDataJSON();
    if (refuse(body.operation)) return route.fulfill(tooBusy);
    if (body.operation === "identity-subject") {
      const view = page_(primary);
      const sections = view.sections.map((section) =>
        section.section === "profile"
          ? {
              ...section,
              status: "ready",
              binding: {
                provider: "gleif",
                native_scope: "lei",
                native_id: lei,
              },
              request: {
                plugin: "pythia-gleif",
                operation: "profile",
                arguments: {},
              },
            }
          : section,
      );
      return route.fulfill({
        json: { schema_version: 1, data: { ...view, sections } },
      });
    }
    if (body.operation === "profile")
      return route.fulfill({
        json: {
          schema_version: 1,
          data: { legal_name: "Synthetic Holding N.V." },
        },
      });
    return route.fallback();
  });
  await page.goto(`/instrument/${encodeURIComponent(primary)}`);
  await expect(page.getByRole("region", { name: "Profile" })).toContainText(
    "Legal name",
  );
  // The descriptor answered after the retry: the card reports the missing
  // presentation, not the busy refusal.
  await expect(page.getByRole("region", { name: "Quote" })).toContainText(
    "price widget is unavailable",
  );
  await expect(page.getByText("Requests are busy")).toHaveCount(0);
  expect(busy.size).toBe(0);
});

test("a listing that is not this instrument's falls back to the page's subject", async ({
  page,
}) => {
  await routeIdentity(page);
  const asked: string[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/data/read")) return;
    const body = request.postDataJSON();
    if (body?.operation === "identity-subject")
      asked.push(body.arguments.subject_id);
  });
  await page.goto(
    `/instrument/${encodeURIComponent(primary)}?listing=${encodeURIComponent("listing:other:instrument")}`,
  );
  await expect(
    page.getByRole("button", { name: /^Listing: SYN · Euronext Amsterdam/ }),
  ).toBeVisible();
  expect(asked).not.toContain("listing:other:instrument");
});

test("the header stays the instrument's while a receipt's price is shown", async ({
  page,
}) => {
  await routeIdentity(page);
  await page.goto(`/instrument/${encodeURIComponent(primary)}`);
  await page
    .getByRole("button", { name: /^Listing: SYN · Euronext Amsterdam/ })
    .click();
  // Core's fold: the security's own listings, then its receipts.
  await expect(page.getByRole("group", { name: "Listings" })).toBeVisible();
  await page
    .getByRole("group", { name: "Receipts and registry shares" })
    .getByRole("menuitemradio", { name: /SYNY/ })
    .click();
  await expect(
    page.getByRole("button", { name: /^Listing: SYNY · Nasdaq · USD/ }),
  ).toBeVisible();
  // The receipt's own composition drives the price card...
  await expect(
    page
      .getByRole("region", { name: "Quote" })
      .locator('[data-slot="instrument-sources"]'),
  ).toContainText("EODHD");
  // ...while the kind badge and identifiers remain the instrument's.
  const header = page.locator('[data-slot="instrument-header"]');
  await expect(header.getByText("Depositary receipt")).toHaveCount(0);
  await expect(
    header.locator('[data-slot="instrument-identifiers"]'),
  ).toContainText("XS0000000001");
});

test("a receipt's search row opens the instrument's page on that listing", async ({
  page,
}) => {
  await routeIdentity(page);
  await page.goto("/workspace");
  const field = page.getByRole("combobox", { name: "Search investments" });
  await field.click();
  await field.fill("synthetic");
  await page.getByRole("option", { name: /^SYNY,/ }).click();
  // The page is the instrument (the security the receipt folds into); the
  // receipt is only the listing whose price it shows.
  await expect(page).toHaveURL(
    new RegExp(
      `/instrument/${encodeURIComponent(security)}\\?listing=${encodeURIComponent(receipt)}$`,
    ),
  );
  await expect(
    page.getByRole("button", { name: /^Listing: SYNY · Nasdaq · USD/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Quote" })
      .locator('[data-slot="instrument-sources"]'),
  ).toContainText("EODHD");
  const header = page.locator('[data-slot="instrument-header"]');
  await expect(header.getByText("Stock", { exact: true })).toBeVisible();
  await expect(header.getByText("Depositary receipt")).toHaveCount(0);
  await expect(
    header.locator('[data-slot="instrument-identifiers"]'),
  ).toContainText("XS0000000001");
});

test("a chosen listing that cannot be read fails in its price card only", async ({
  page,
}) => {
  await routeIdentity(page);
  await page.route(/\/api\/data\/read$/u, async (route) => {
    const body = route.request().postDataJSON();
    if (
      body.operation === "identity-subject" &&
      body.arguments.subject_id === secondary
    )
      return route.fulfill({
        json: {
          schema_version: 1,
          outcome: "empty",
          data: null,
          issues: [{ code: "unavailable", message: "Unknown subject." }],
        },
      });
    return route.fallback();
  });
  await page.goto(
    `/instrument/${encodeURIComponent(primary)}?listing=${encodeURIComponent(secondary)}`,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Synthetic Holding N.V." }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Quote" }).getByRole("alert"),
  ).toContainText("This listing's price could not be read.");
  await expect(
    page.getByText("This instrument could not be opened."),
  ).toHaveCount(0);
});

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
