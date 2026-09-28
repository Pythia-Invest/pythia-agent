import { expect, test } from "@playwright/test";

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
          answered: [
            question("q-agent", {
              state: "resolved",
              agent_answer: {
                by: "agent",
                relation: "same_listing",
                chosen_id: LISTING,
              },
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
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Answered by agent");
  await expect(
    rows.nth(1).getByRole("button", { name: "Override" }),
  ).toBeVisible();

  await rows.first().getByRole("button", { name: "Show context" }).click();
  await expect(table.locator('[data-slot="data-table-context"]')).toContainText(
    "Synthetic Holding · SYN.AS",
  );

  await rows.first().getByRole("button", { name: "Same instrument" }).click();
  const dialog = page.getByRole("dialog", { name: "Same instrument" });
  await dialog.getByRole("textbox").fill("Same synthetic line.");
  await dialog.getByRole("button", { name: "Confirm match" }).click();
  await expect(page.getByRole("status").first()).toContainText("Confirmed");
  expect(verdicts).toEqual([
    {
      item_id: "q-open",
      relation: "same_listing",
      chosen_id: LISTING,
      rationale: "Same synthetic line.",
    },
  ]);
});
