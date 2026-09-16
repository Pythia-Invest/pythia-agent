import { expect, test } from "@playwright/test";
import { workspaceFixture, returnToBrowser } from "./workspace-fixture";

test("filename search highlights corrected words and opens files without losing the query", async ({
  page,
}) => {
  await workspaceFixture(page);
  await page.route("**/api/workspace/search?**", (route) =>
    route.fulfill({
      json: {
        matches: [
          "research/scale-plan.md",
          "strategies/balanced/scale-plan.md",
        ].map((path) => ({
          entry: {
            path,
            name: "scale-plan.md",
            kind: "markdown",
            revision: "version-1",
          },
          match: "name",
        })),
        partial: false,
        scanned: 3,
      },
    }),
  );
  await page.goto("/workspace");
  await expect(
    page
      .getByRole("region", { name: "Folder contents" })
      .getByRole("link", { name: "research", exact: true }),
  ).toBeVisible();
  const input = page.getByRole("searchbox", {
    name: "Search files and folders",
  });
  await input.fill("scael plan");
  const results = page.locator('[data-slot="workspace-search-results"]');
  await expect(results.getByRole("listitem")).toHaveCount(2);
  await expect(
    results.getByRole("group", { name: "Search match type" }),
  ).toHaveCount(0);
  await expect(
    results.getByText("strategies/balanced", { exact: true }),
  ).toBeVisible();
  expect(
    await results
      .getByRole("link", { name: "scale-plan.md", exact: true })
      .first()
      .locator("mark")
      .allTextContents(),
  ).toEqual(["scale", "plan"]);
  await results
    .getByRole("link", { name: "scale-plan.md", exact: true })
    .first()
    .click();
  await expect(
    page.locator('[data-slot="workspace-reader-scroll"] h1'),
  ).toHaveText("Synthetic research version 1");
  await expect(page).toHaveURL(/\/workspace$/);
  await returnToBrowser(page);
  await expect(input).toHaveValue("scael plan");
  await page.screenshot({
    path: test.info().outputPath("filename-search.png"),
  });
});

test("folder scope is available while the initial global search is pending", async ({
  page,
}) => {
  await workspaceFixture(page);
  let releaseGlobal!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseGlobal = resolve;
  });
  const scopes: string[] = [];
  await page.route("**/api/workspace/search?**", async (route) => {
    const scope = new URL(route.request().url()).searchParams.get("path") ?? "";
    scopes.push(scope);
    if (!scope) await held;
    await route.fulfill({ json: { matches: [], scanned: 1, partial: false } });
  });
  try {
    await page.goto("/workspace/research");
    await expect(
      page
        .getByRole("region", { name: "Folder contents" })
        .getByRole("link", { name: "notes.md", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("searchbox", { name: "Search files and folders" })
      .fill("risk");
    await expect.poll(() => scopes.includes("")).toBe(true);
    const results = page.locator('[data-slot="workspace-search-results"]');
    await expect(results).toHaveAttribute("aria-busy", "true");
    await results
      .getByRole("button", { name: "Search in research", exact: true })
      .click();
    await expect.poll(() => scopes.includes("research")).toBe(true);
    await expect(results).toHaveAttribute("aria-busy", "false");
    await expect(
      results.getByRole("button", { name: "Search in research", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    releaseGlobal();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("search defaults to the whole workspace and can narrow to the current folder", async ({
  page,
}) => {
  await workspaceFixture(page);
  const scopes: string[] = [];
  await page.route("**/api/workspace/search?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const path = params.get("path") ?? "";
    scopes.push(path);
    const paths = path
      ? ["research/notes.md"]
      : ["research/notes.md", "elsewhere/notes.md"];
    return route.fulfill({
      json: {
        matches: paths.map((path) => ({
          entry: {
            path,
            name: "notes.md",
            kind: "markdown",
            revision: "version-1",
          },
          match: "name",
        })),
        partial: false,
        scanned: 3,
        // Older cached responses may carry this field; it must not add routine notices.
        unsupported: 800,
      },
    });
  });
  await page.goto("/workspace/research");
  await expect(
    page
      .getByRole("region", { name: "Folder contents" })
      .getByRole("link", { name: "notes.md", exact: true }),
  ).toBeVisible();
  const input = page.getByRole("searchbox", {
    name: "Search files and folders",
  });
  await input.fill("notes");
  const results = page.locator('[data-slot="workspace-search-results"]');
  await expect(results.getByRole("listitem")).toHaveCount(2);
  expect(scopes[0]).toBe("");
  const locations = results.getByRole("group", { name: "Search location" });
  await expect(
    locations.getByRole("button", { name: "Workspace", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(results.locator("details")).toHaveCount(0);
  await results
    .getByRole("listitem")
    .filter({
      has: page.getByText("elsewhere", { exact: true }),
    })
    .getByRole("link", { name: "notes.md", exact: true })
    .click();
  await expect(
    page.locator('[data-slot="workspace-reader-scroll"] h1'),
  ).toHaveText("Synthetic research version 1");
  await expect(page).toHaveURL(/\/workspace\/research$/);
  await returnToBrowser(page);
  await locations
    .getByRole("button", { name: "Search in research", exact: true })
    .click();
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect.poll(() => scopes.includes("research")).toBe(true);
  await expect(input).toHaveValue("notes");
  await expect(page).toHaveURL(/\/workspace\/research$/);
  await page.screenshot({ path: test.info().outputPath("search-scope.png") });
  // Keyboard activation returns to the global scope without replacing the query.
  const global = locations.getByRole("button", {
    name: "Workspace",
    exact: true,
  });
  await global.focus();
  await page.keyboard.press("Enter");
  await expect(results.getByRole("listitem")).toHaveCount(2);
  await expect(input).toHaveValue("notes");
});
