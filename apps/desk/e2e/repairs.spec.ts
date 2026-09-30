import { expect, test } from "@playwright/test";
import { page_, primary } from "./instrument-fixture";
import { useSyntheticDesk } from "./synthetic-desk";

useSyntheticDesk();

const LISTING = "listing:isin:XS0000000001:XAMS:EUR";

function question(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "residual",
    reason: "no_key",
    state: "open",
    label: "Synthetic Provider",
    question: "Synthetic Provider's record SYN.AS has no identifier.",
    opened_at: "2026-09-26T10:00:00Z",
    plugins: ["synthetic"],
    record: {
      native_ref: { native_id: "SYN.AS" },
      name: "Synthetic Holding",
      mic: "XAMS",
      currency: "EUR",
    },
    candidates: [{ id: LISTING, name: "Synthetic Holding N.V." }],
    answers: [
      { relation: "same_listing", chosen_id: LISTING },
      { relation: "unrelated", chosen_id: LISTING },
    ],
    ...extra,
  };
}

test("repairs list issues in the back-office table and record the user's fix with a note", async ({
  page,
}) => {
  const verdicts: unknown[] = [];
  await page.route("**/api/data/read", (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== "identity-queue") return route.fallback();
    return route.fulfill({
      json: {
        schema_version: 1,
        outcome: "ok",
        data: {
          items: [question("q-open")],
          total: 1,
          // Settled by the user: a Dismissed badge and no actions, hidden by default.
          settled: [
            question("q-user", {
              state: "dismissed",
              settled_by: "user",
              updated_at: "2026-09-26T11:00:00Z",
            }),
          ],
        },
      },
    });
  });
  await page.route("**/api/data/invoke", (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== "identity-verdict") return route.fallback();
    verdicts.push(body.arguments);
    return route.fulfill({
      json: {
        schema_version: 1,
        outcome: "ok",
        data: {
          outcome: "confirmed",
          state: "resolved",
          message: "Confirmed: the record is bound to the chosen instrument.",
        },
      },
    });
  });
  await page.goto("/settings/repairs");
  await expect(
    page.getByRole("heading", { level: 2, name: "Repairs" }),
  ).toBeVisible();
  const table = page.getByRole("table", { name: "Repairs" });
  const rows = table.locator('[data-slot="data-table-row"]');
  await expect(rows).toHaveCount(1);

  await page.getByRole("button", { name: /^Status/u }).click();
  await page.getByRole("menuitemcheckbox", { name: "Dismissed" }).click();
  await page.keyboard.press("Escape");
  await expect(rows).toHaveCount(2);
  const settled = rows.filter({ hasText: "Dismissed" });
  await expect(settled).toHaveCount(1);
  await expect(
    settled.getByRole("button", {
      name: /^(Match|Not a match|Confirm)$/u,
    }),
  ).toHaveCount(0);

  await rows.first().getByRole("button", { name: "Show context" }).click();
  await expect(table.locator('[data-slot="data-table-context"]')).toContainText(
    "Synthetic Holding · SYN.AS",
  );

  await rows
    .first()
    .getByRole("button", { name: "Match", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Same instrument" });
  // The dialog sits inside the viewport at every width (a phone included).
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(
    box && viewport && box.x >= 0 && box.x + box.width <= viewport.width,
  ).toBe(true);
  await dialog.getByRole("textbox").fill("Same synthetic line.");
  await dialog.getByRole("button", { name: "Confirm match" }).click();
  await expect(
    page.locator('[data-slot="repairs"]').getByRole("status"),
  ).toContainText("Confirmed");
  expect(verdicts).toEqual([
    {
      item_id: "q-open",
      relation: "same_listing",
      chosen_id: LISTING,
      rationale: "Same synthetic line.",
    },
  ]);
});

const OTHER = "listing:isin:XS0000000002:XNAS:USD";
const SECURITY = "security:isin:XS0000000001";

/** Serves one queue read and records every answer; each answer takes effect. */
async function serveQueue(
  page: import("@playwright/test").Page,
  queue: unknown,
) {
  const verdicts: unknown[] = [];
  await page.route("**/api/data/read", (route) =>
    route.request().postDataJSON().operation === "identity-queue"
      ? route.fulfill({ json: { schema_version: 1, ...(queue as object) } })
      : route.fallback(),
  );
  await page.route("**/api/data/invoke", (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== "identity-verdict") return route.fallback();
    verdicts.push(body.arguments);
    return route.fulfill({
      json: {
        schema_version: 1,
        outcome: "ok",
        data: { outcome: "confirmed", message: "Confirmed." },
      },
    });
  });
  return verdicts;
}

test("repairs offer every candidate, the agent's suggestion and a way out of a question without candidates", async ({
  page,
}) => {
  const verdicts = await serveQueue(page, {
    outcome: "ok",
    data: {
      items: [
        question("q-two", {
          candidates: [
            { id: LISTING, name: "Synthetic Holding N.V." },
            { id: OTHER, name: "Synthetic Holding ADR" },
          ],
          answers: [
            { relation: "same_listing", chosen_id: LISTING },
            { relation: "unrelated", chosen_id: LISTING },
            { relation: "same_listing", chosen_id: OTHER },
            { relation: "unrelated", chosen_id: OTHER },
            { relation: "none", chosen_id: null },
            { relation: "ambiguous", chosen_id: null },
          ],
        }),
        question("q-none", {
          candidates: [],
          answers: [
            { relation: "none", chosen_id: null },
            { relation: "ambiguous", chosen_id: null },
          ],
        }),
        // The agent's answer is a suggestion; it waits for the user.
        question("q-suggested", {
          agent_answer: {
            by: "agent",
            relation: "same_listing",
            chosen_id: OTHER,
          },
          candidates: [{ id: OTHER, name: "Synthetic Holding ADR" }],
          answers: [
            { relation: "same_listing", chosen_id: OTHER },
            { relation: "unrelated", chosen_id: OTHER },
            { relation: "none", chosen_id: null },
          ],
          subjects: [
            { id: LISTING, known: true, name: "Synthetic Holding N.V." },
            { id: OTHER, known: true, name: "Synthetic Holding ADR" },
          ],
        }),
        // A receipt suggestion reads as one, never as the same instrument.
        question("q-receipt", {
          agent_answer: {
            by: "agent",
            relation: "depositary_receipt_of",
            chosen_id: SECURITY,
          },
          candidates: [{ id: SECURITY, name: "Synthetic Holding shares" }],
          answers: [
            { relation: "same_security", chosen_id: SECURITY },
            { relation: "depositary_receipt_of", chosen_id: SECURITY },
            { relation: "none", chosen_id: null },
          ],
        }),
      ],
    },
  });
  await page.goto("/settings/repairs");
  const table = page.getByRole("table", { name: "Repairs" });
  const rows = table.locator('[data-slot="data-table-row"]');
  await expect(rows).toHaveCount(4);

  // Several candidates: each has its own Match, and the second one binds it.
  await rows.nth(0).getByRole("button", { name: "Match 2" }).click();
  const dialog = page.getByRole("dialog", { name: "Same instrument" });
  await expect(dialog).toContainText("Synthetic Holding ADR");
  await dialog.getByRole("button", { name: "Confirm match" }).click();
  await expect(dialog).toBeHidden();

  // No candidate: the question can still be answered "none of these".
  await expect(
    rows.nth(1).getByRole("button", { name: /^Match/u }),
  ).toHaveCount(0);
  await rows.nth(1).getByRole("button", { name: "Not a match" }).click();
  await page
    .getByRole("dialog", { name: "Not this instrument" })
    .getByRole("button", { name: "Not a match" })
    .click();

  // The agent's suggestion shows on the open question and one click confirms it.
  await expect(rows.nth(2)).toContainText("Agent suggests: match");
  await rows.nth(2).getByRole("button", { name: "Show context" }).click();
  const context = table.locator('[data-slot="data-table-context"]');
  await expect(context).toContainText(
    "Same instrument as Synthetic Holding ADR",
  );
  await expect(context).toContainText("Synthetic Holding N.V."); // the other subject
  await rows.nth(2).getByRole("button", { name: "Confirm" }).click();
  await page
    .getByRole("dialog", { name: "Same instrument" })
    .getByRole("button", { name: "Confirm match" })
    .click();

  await expect
    .poll(() => verdicts)
    .toEqual([
      { item_id: "q-two", relation: "same_listing", chosen_id: OTHER },
      { item_id: "q-none", relation: "none" },
      { item_id: "q-suggested", relation: "same_listing", chosen_id: OTHER },
    ]);

  await expect(rows.nth(3)).toContainText("Agent suggests: depositary receipt");
  await rows.nth(3).getByRole("button", { name: "Confirm" }).click();
  await expect(
    page.getByRole("dialog", { name: "Depositary receipt" }),
  ).toContainText("as a depositary receipt of Synthetic Holding shares");
});

test("repairs never read an unreadable queue as nothing to do", async ({
  page,
}) => {
  await serveQueue(page, {
    outcome: "empty",
    data: null,
    issues: [{ message: "The identity store could not be read." }],
  });
  await page.goto("/settings/repairs");
  await expect(
    page.locator('[data-slot="repairs"]').getByRole("alert"),
  ).toContainText("The identity store could not be read.");
  await expect(page.getByText("Nothing needs attention.")).toHaveCount(0);
});

test("an instrument page shows an open data conflict in place of the company and links to its repair", async ({
  page,
}) => {
  await serveQueue(page, {
    outcome: "ok",
    data: {
      items: [
        question("q-other"),
        question("q-issuer", { reason: "identifier" }),
      ],
      total: 2,
      settled: [],
    },
  });
  const held = { fact: "issuer", question: "q-issuer", options: 2 };
  await page.route("**/api/data/read", (route) => {
    if (route.request().postDataJSON().operation !== "identity-subject")
      return route.fallback();
    const view = page_(primary);
    return route.fulfill({
      json: {
        schema_version: 1,
        data: {
          ...view,
          issuer: null,
          withheld: [held],
          sections: [
            {
              section: "profile",
              plugin: "pythia",
              label: "Pythia",
              status: "not_addressable",
              reason: "Needs the issuer: the data doesn't settle who issued it",
              question: held.question,
              alternatives: [],
            },
          ],
        },
      },
    });
  });
  await page.route("**/api/plugins/pythia-market-data/widgets", (route) =>
    route.fulfill({ json: { version: 1, widgets: [], assets: [] } }),
  );
  await page.goto(`/instrument/${encodeURIComponent(primary)}`);
  const header = page.locator('[data-slot="instrument-header"]');
  await expect(header.locator('[data-fact="issuer"]')).toHaveText(
    "Company: open data conflict (2 options) · Review",
  );
  // The profile card says the same, rather than vanishing.
  const card = page.getByRole("region", { name: "Profile" });
  await expect(card.getByText("Needs the issuer")).toBeVisible();
  await expect(card.getByRole("link", { name: "Review" })).toHaveAttribute(
    "href",
    "/settings/repairs?question=q-issuer",
  );

  await header.getByRole("link", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/settings\/repairs\?question=q-issuer$/u);
  // Only that row opens, scrolled into view.
  const rows = page.locator('[data-slot="data-table-row"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toHaveAttribute("data-expanded", "true");
  await expect(rows.nth(0)).not.toHaveAttribute("data-expanded", "true");
  await expect(rows.nth(1)).toBeInViewport();
});

test("repairs list the agent's correction proposals to confirm or decline, and the investor's own to undo", async ({
  page,
}) => {
  const item = (id: string, fields: Record<string, unknown>) => ({
    id,
    kind: "identifier",
    subject_id: SECURITY,
    scheme: "isin",
    value: "XS0000000017",
    state: "proposed",
    proposed_by: "agent",
    note: "The filing gives this ISIN.",
    created_at: "2026-09-30T10:00:00Z",
    name: "Synthetic Holding N.V.",
    ...fields,
  });
  const writes: unknown[] = [];
  await page.route("**/api/data/read", (route) =>
    route.request().postDataJSON().operation === "identity-corrections"
      ? route.fulfill({
          json: {
            schema_version: 1,
            outcome: "ok",
            data: {
              items: [
                item("c-proposal", {}),
                item("c-pin", {
                  kind: "price_source",
                  scheme: null,
                  value: "yahoo",
                  label: "Yahoo Finance",
                  proposed_by: null,
                  note: null,
                  state: "active",
                  decided_at: "2026-09-30T11:00:00Z",
                }),
                item("c-declined", {
                  value: null,
                  state: "undone",
                  ended_at: "2026-09-30T12:00:00Z",
                }),
              ],
            },
          },
        })
      : route.fallback(),
  );
  await page.route("**/api/data/invoke", (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== "identity-correction") return route.fallback();
    writes.push(body.arguments);
    return route.fulfill({
      json: {
        schema_version: 1,
        outcome: "ok",
        data: { outcome: "confirmed", message: "Confirmed: applied." },
      },
    });
  });
  await page.goto("/settings/repairs");
  const table = page.getByRole("table", { name: "Repairs" });
  const rows = table.locator('[data-slot="data-table-row"]');
  await expect(rows).toHaveCount(1); // the open proposal; the rest are settled
  await expect(rows.first()).toContainText("Agent suggests: set ISIN");
  await rows.first().getByRole("button", { name: "Show context" }).click();
  await expect(table.locator('[data-slot="data-table-context"]')).toContainText(
    "The agent, as a proposal",
  );
  await rows.first().getByRole("button", { name: "Confirm" }).click();
  const dialog = page.getByRole("dialog", { name: "Apply correction" });
  await expect(dialog).toContainText(
    "Set the ISIN of Synthetic Holding N.V. to XS0000000017.",
  );
  await dialog.getByRole("textbox").fill("Checked the filing.");
  await dialog.getByRole("button", { name: "Apply correction" }).click();
  await expect(
    page.locator('[data-slot="repairs"]').getByRole("status"),
  ).toContainText("Confirmed: applied.");

  await page.getByRole("button", { name: /^Status/u }).click();
  await page.getByRole("menuitemcheckbox", { name: "Resolved" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Dismissed" }).click();
  await page.keyboard.press("Escape");
  await expect(rows).toHaveCount(3);
  const settled = rows.filter({ hasText: "Price source" });
  await expect(settled).toContainText("Yahoo Finance");
  await settled.getByRole("button", { name: "Undo" }).click();
  await page
    .getByRole("dialog", { name: "Undo correction" })
    .getByRole("button", { name: "Undo" })
    .click();
  // A correction already undone has no action left.
  await expect(
    rows
      .filter({ hasText: "Dismissed" })
      .getByRole("button", { name: /^(Confirm|Undo|Decline)$/u }),
  ).toHaveCount(0);
  await expect
    .poll(() => writes)
    .toEqual([
      { action: "confirm", id: "c-proposal", note: "Checked the filing." },
      { action: "undo", id: "c-pin" },
    ]);
});
