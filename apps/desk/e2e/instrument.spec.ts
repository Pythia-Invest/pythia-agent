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
