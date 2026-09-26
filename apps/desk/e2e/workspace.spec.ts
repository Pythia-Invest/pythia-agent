import { expect, test } from "@playwright/test";
import { workspaceFixture, returnToBrowser } from "./workspace-fixture";
import { fixture } from "./stream-fixture";

test("opens host file URLs through Workspace and reports unavailable paths", async ({
  page,
}) => {
  await workspaceFixture(
    page,
    "[Open host research](file:///synthetic/research/notes.md#evidence)\n\n[Outside file](file:///outside/private.md)",
  );
  await page
    .getByRole("button", { name: "Open host research", exact: true })
    .click();
  await expect(page.locator('[data-slot="workspace-markdown"] h1')).toHaveText(
    "Synthetic research version 1",
  );
  await expect(page).toHaveURL(/\/c\/synthetic-chat$/);
  // Close the companion drawer/pane before activating another transcript item.
  await returnToBrowser(page);
  await page.getByRole("button", { name: "Outside file", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "File unavailable in Workspace." }),
  ).toBeVisible();
});

test("renames the header title with cancellation and retry after failure", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "phone",
    "The conversation header is desktop-only; phone retains sidebar rename.",
  );
  await fixture(page);
  let title = "Synthetic chat review";
  const patches: string[] = [];
  let fail = true;
  await page.route(/\/api\/sessions(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { data: [{ id: "synthetic-chat", title }] } }),
  );
  await page.route("**/api/sessions/synthetic-chat", (route) => {
    patches.push(route.request().postDataJSON().title);
    if (fail)
      return route.fulfill({
        status: 500,
        json: { error: { message: "Synthetic rename failure" } },
      });
    title = route.request().postDataJSON().title;
    return route.fulfill({
      json: { session: { id: "synthetic-chat", title } },
    });
  });
  const heading = page.locator('[data-slot="chat-header"]');
  await heading
    .getByRole("button", {
      name: "Rename chat: Synthetic chat review",
      exact: true,
    })
    .click();
  const input = heading.getByRole("textbox", {
    name: "Chat title",
    exact: true,
  });
  await expect(input).toBeFocused();
  await input.fill("Discard this");
  await input.press("Escape");
  await expect(
    heading.getByRole("button", {
      name: "Rename chat: Synthetic chat review",
      exact: true,
    }),
  ).toBeFocused();
  expect(patches).toEqual([]);
  await heading
    .getByRole("button", {
      name: "Rename chat: Synthetic chat review",
      exact: true,
    })
    .click();
  await input.fill("   ");
  await input.press("Enter");
  await expect(heading.getByRole("alert")).toHaveText("Enter a chat title.");
  expect(patches).toEqual([]);
  await input.fill("Fictional research comparison");
  await input.press("Enter");
  await expect(heading.getByRole("alert")).toContainText("Could not rename");
  await expect(input).toHaveValue("Fictional research comparison");
  fail = false;
  await input.press("Enter");
  await expect(
    heading.getByRole("button", {
      name: "Rename chat: Fictional research comparison",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    heading.getByRole("button", {
      name: "Rename chat: Fictional research comparison",
      exact: true,
    }),
  ).toBeVisible();
  expect(patches).toEqual([
    "Fictional research comparison",
    "Fictional research comparison",
  ]);
  await heading
    .getByRole("button", {
      name: "Rename chat: Fictional research comparison",
      exact: true,
    })
    .click();
  await input.fill("Comparison notes");
  await input.press("Tab");
  await expect(
    heading.getByRole("button", {
      name: "Rename chat: Comparison notes",
      exact: true,
    }),
  ).toBeVisible();
  expect(patches.at(-1)).toBe("Comparison notes");
});

test("opens an artifact beside its originating chat and returns keyboard focus", async ({
  page,
}) => {
  const f = await workspaceFixture(page);
  const link = page.getByRole("link", {
    name: "Open synthetic research",
    exact: true,
  });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-slot="workspace-companion"]')).toBeVisible();
  await expect(page.locator('[data-slot="workspace-markdown"] h1')).toHaveText(
    "Synthetic research version 1",
  );
  await expect(page).toHaveURL(/\/c\/synthetic-chat$/);
  await returnToBrowser(page);
  await expect(page.locator('[data-slot="workspace-companion"]')).toHaveCount(
    0,
  );
  await expect(link).toBeFocused();
  expect(f.chat.streamRequests()).toBe(0);
});

test("folder menus open on click and preserve the current document", async ({
  page,
}, testInfo) => {
  await workspaceFixture(page);
  await page.route("**/api/workspace/list?**", (route) => {
    const folder = new URL(route.request().url()).searchParams.get("path");
    if (folder === "research/unavailable")
      return route.fulfill({
        status: 404,
        json: { error: { message: "Folder unavailable" } },
      });
    const paths =
      folder === ""
        ? ["research"]
        : folder === "research"
          ? ["research/empty", "research/unavailable", "research/comparison.md"]
          : [];
    return route.fulfill({
      json: {
        entries: paths.map((path) => ({
          path,
          name: path.split("/").at(-1),
          kind: path.endsWith(".md") ? "markdown" : "directory",
          size: 0,
          modified: "2026-01-01T00:00:00.000Z",
          revision: "version-1",
          mediaType: "text/plain",
          previewable: path.endsWith(".md"),
        })),
        partial: false,
        scanned: paths.length,
      },
    });
  });
  await page
    .getByRole("link", { name: "Open synthetic research", exact: true })
    .click();
  const toolbar = page.locator('[data-slot="workspace-toolbar"]');
  const heading = page.locator('[data-slot="workspace-markdown"] h1');
  await expect(heading).toHaveText("Synthetic research version 1");
  await expect(
    toolbar.getByRole("button", { name: "Reference in chat", exact: true }),
  ).toBeVisible();
  await expect(
    toolbar.getByRole("link", { name: "Download", exact: true }),
  ).toHaveAttribute("href", /download/);
  const folders = toolbar.getByRole("navigation", {
    name: "Workspace folders",
  });
  const root = folders.getByRole("button", { name: "Workspace", exact: true });
  if (testInfo.project.name === "desktop") {
    await root.hover();
    await expect(root).toHaveAttribute("aria-expanded", "false");
  }
  await root.click();
  const research = page.getByRole("menuitem", {
    name: "research",
    exact: true,
  });
  await research.click();
  const researchMenu = page.getByRole("menu", {
    name: "Files in research",
    exact: true,
  });
  await expect(researchMenu).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await researchMenu
      .getByRole("menuitem", { name: "empty", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "This folder is empty." }),
    ).toBeVisible();
    await expect(heading).toHaveText("Synthetic research version 1");
    await page.keyboard.press("Escape");
    await researchMenu
      .getByRole("menuitem", { name: "unavailable", exact: true })
      .click();
    await expect(
      page
        .getByRole("menu", {
          name: "Files in research/unavailable",
          exact: true,
        })
        .getByRole("alert"),
    ).toHaveText("Could not load this folder.");
    await page.keyboard.press("Escape");
  }
  await researchMenu
    .getByRole("menuitem", { name: "comparison.md", exact: true })
    .click();
  await expect(heading).toHaveText("Synthetic risk comparison");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page).toHaveURL(/\/c\/synthetic-chat$/);
  await folders.getByRole("button", { name: "research", exact: true }).click();
  await expect(researchMenu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(researchMenu).toHaveCount(0);
});

test("folder navigation stays independent of the open file", async ({
  page,
}, testInfo) => {
  await workspaceFixture(page);
  await page.goto("/workspace");
  const directory = page.locator('[data-slot="workspace-directory"]');
  await directory.getByRole("link", { name: "research", exact: true }).click();
  await directory.getByRole("link", { name: "notes.md", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/research$/);
  const content = page.locator('[data-slot="workspace-markdown"] h1');
  await expect(content).toHaveText("Synthetic research version 1");
  if (testInfo.project.name === "phone") await returnToBrowser(page);
  await page
    .getByRole("button", { name: "Workspace home", exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspace$/);
  if (testInfo.project.name === "desktop")
    await expect(content).toHaveText("Synthetic research version 1");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/research$/);
  await page.getByRole("button", { name: "Forward", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  if (testInfo.project.name === "desktop")
    await expect(content).toHaveText("Synthetic research version 1");
  await expect(page.locator('[data-slot="workspace-sidebar"]')).toHaveCount(0);
});

test("Workspace keeps the folder browser while files open in the shared companion", async ({
  page,
}, testInfo) => {
  await workspaceFixture(page);
  await page.goto("/workspace/research");
  const directory = page.locator('[data-slot="workspace-directory"]');
  await directory.getByRole("link", { name: "notes.md", exact: true }).click();
  await expect(page.locator('[data-slot="workspace-companion"]')).toBeVisible();
  await expect(page.locator('[data-slot="workspace-sidebar"]')).toHaveCount(0);
  if (testInfo.project.name === "desktop")
    await expect(directory).toBeVisible();
  await page
    .getByRole("button", { name: "Close notes.md", exact: true })
    .click();
  await expect(directory).toBeVisible();
  await expect(page.locator('[data-slot="workspace-companion"]')).toHaveCount(
    0,
  );
  await directory.getByRole("link", { name: "notes.md", exact: true }).click();
  await expect(page.locator('[data-slot="workspace-companion"]')).toBeVisible();
});

test("standalone research supports filename search and does not fetch remote document images", async ({
  page,
}) => {
  await workspaceFixture(page);
  const externalImages: string[] = [];
  await page.route("https://images.invalid/**", (route) => {
    externalImages.push(route.request().url());
    return route.abort();
  });
  await page.goto("/workspace/research/notes.md#evidence");
  await expect(
    page.locator('[data-slot="workspace-markdown"] h2'),
  ).toHaveAttribute("id", "evidence");
  await expect(
    page.getByRole("link", { name: "Open external image: External" }),
  ).toHaveAttribute("href", "https://images.invalid/chart.png");
  expect(externalImages).toEqual([]);
  await returnToBrowser(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("searchbox", { name: /^Search( investments)?$/ }),
  ).toBeFocused();
  await page
    .getByRole("searchbox", { name: "Search files and folders" })
    .fill("compar");
  await expect(
    page.getByRole("link", { name: "comparison.md", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Some files weren’t searched or shown"),
  ).toBeVisible();
  await page.getByRole("link", { name: "comparison.md", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/research\/notes\.md#evidence$/);
  await expect(page.locator('[data-slot="workspace-markdown"] h1')).toHaveText(
    "Synthetic risk comparison",
  );
  await returnToBrowser(page);
  await expect(
    page.getByRole("searchbox", {
      name: "Search files and folders",
    }),
  ).toHaveValue("compar");
});
