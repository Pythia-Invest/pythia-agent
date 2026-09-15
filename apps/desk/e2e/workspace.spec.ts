import { expect, test, type Page } from "@playwright/test";
import type { WorkspaceEntry } from "../src/workspace/types";
import { fixture } from "./stream-fixture";

async function returnToBrowser(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 900)
    await page.keyboard.press("Escape");
}

/** Synthetic browser fixtures only; the running Desk is supplied externally.
 * All research/API data is intercepted, so no native file or provider is used. */
async function workspaceFixture(
  page: Page,
  content = "[Open synthetic research](research/notes.md#evidence)",
) {
  const chat = await fixture(page, [
    {
      id: "artifact-answer",
      role: "assistant",
      content,
    },
  ]);
  let version = 1;
  const reads: string[] = [];
  const entry = (path: string): WorkspaceEntry => ({
    path,
    name: path.split("/").at(-1) || "Workspace",
    kind: path.endsWith(".md") ? "markdown" : "directory",
    size: 10000,
    modified: "2026-01-01T00:00:00.000Z",
    revision: `version-${version}`,
    mediaType: "text/plain; charset=utf-8",
    previewable: path.endsWith(".md"),
  });
  await page.route("**/api/workspace/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path") ?? "";
    if (url.pathname.endsWith("/resolve")) {
      if (url.searchParams.get("hostPath") === "/synthetic/research/notes.md")
        return route.fulfill({ json: { path: "research/notes.md" } });
      return route.fulfill({
        status: 404,
        json: { error: { message: "File unavailable in Workspace." } },
      });
    }
    if (url.pathname.endsWith("/entry"))
      return route.fulfill({ json: entry(path) });
    if (url.pathname.endsWith("/list"))
      return route.fulfill({
        json: {
          entries:
            path === "" ? [entry("research")] : [entry("research/notes.md")],
          partial: false,
          scanned: 1,
        },
      });
    if (url.pathname.endsWith("/search"))
      return route.fulfill({
        json: {
          matches: [
            {
              entry: entry("research/comparison.md"),
              match: "name",
            },
          ],
          partial: true,
          scanned: 100,
        },
      });
    if (url.pathname.endsWith("/content")) {
      reads.push(`version-${version}`);
      const body =
        `# ${path === "research/comparison.md" ? "Synthetic risk comparison" : `Synthetic research version ${version}`}\n\n[Jump to evidence](#evidence)\n\n## Evidence\n\n![External](https://images.invalid/chart.png)\n\n` +
        Array.from(
          { length: 80 },
          (_, index) =>
            `Paragraph ${index}: synthetic observations for a scrolling fixture.\n\n`,
        ).join("");
      return route.fulfill({
        body,
        contentType: "text/plain; charset=utf-8",
        headers: {
          "x-workspace-revision": `version-${version}`,
          "content-length": String(new TextEncoder().encode(body).length),
          "content-disposition": "inline",
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: { error: { message: "Unknown synthetic workspace request" } },
    });
  });
  return {
    chat,
    reads,
    nextVersion: () => {
      version += 1;
    },
  };
}

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
    page.getByRole("searchbox", { name: "Search", exact: true }),
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

test("file tabs reuse chat switching, keyboard selection and adjacent close behavior", async ({
  page,
}) => {
  await workspaceFixture(page);
  await page.goto("/workspace/research");
  await page
    .locator('[data-slot="workspace-directory"]')
    .getByRole("link", { name: "notes.md", exact: true })
    .click();
  const viewport = page.locator('[data-slot="workspace-reader-scroll"]');
  await page.locator('[data-slot="workspace-markdown"]').waitFor();
  // Deliver the native scroll event before immediately dismissing the phone
  // drawer. Setting scrollTop alone does not wait for scroll observers.
  await viewport.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        element.addEventListener(
          "scroll",
          () => requestAnimationFrame(() => resolve()),
          { once: true },
        );
        element.scrollTop = 450;
      }),
  );
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBe(450);
  await returnToBrowser(page);
  await page
    .getByRole("searchbox", { name: "Search files and folders" })
    .fill("risk");
  await page.getByRole("link", { name: "comparison.md", exact: true }).click();
  const tabs = page.getByRole("tablist", { name: "Open files", exact: true });
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await tabs.getByRole("tab", { name: "notes.md", exact: true }).click();
  await expect(page.locator('[data-slot="workspace-markdown"] h1')).toHaveText(
    "Synthetic research version 1",
  );
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBe(450);
  await expect(page).toHaveURL(/\/workspace\/research$/);
  await tabs.getByRole("tab", { name: "notes.md", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    tabs.getByRole("tab", { name: "comparison.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-slot="workspace-markdown"] h1')).toHaveText(
    "Synthetic risk comparison",
  );
  await tabs
    .getByRole("button", { name: "Close comparison.md", exact: true })
    .click();
  await expect(
    tabs.getByRole("tab", { name: "notes.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await tabs
    .getByRole("button", { name: "Close notes.md", exact: true })
    .click();
  await expect(page.locator('[data-slot="workspace-companion"]')).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("searchbox", {
      name: "Search files and folders",
    }),
  ).toHaveValue("risk");
});

for (const initialHeading of ["", "#evidence"]) {
  test(`an explicit heading wins over pending tab scroll restoration (${initialHeading || "new heading"})`, async ({
    page,
  }) => {
    await workspaceFixture(page);
    await page.goto(`/workspace/research/notes.md${initialHeading}`);
    const viewport = page.locator('[data-slot="workspace-reader-scroll"]');
    await page.locator('[data-slot="workspace-markdown"]').waitFor();
    await viewport.evaluate((element) => {
      element.scrollTop = 450;
    });
    await returnToBrowser(page);
    await page
      .getByRole("searchbox", { name: "Search files and folders" })
      .fill("risk");
    await page
      .getByRole("link", { name: "comparison.md", exact: true })
      .click();
    let release!: () => void;
    let requested!: () => void;
    const pending = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/workspace/content?**", async (route) => {
      if (
        new URL(route.request().url()).searchParams.get("path") ===
        "research/notes.md"
      ) {
        requested();
        await gate;
      }
      await route.fallback();
    });
    await page.clock.setFixedTime(new Date(Date.now() + 20_000));
    await page.getByRole("tab", { name: "notes.md", exact: true }).click();
    await pending;
    await page
      .getByRole("link", { name: "Jump to evidence", exact: true })
      .click();
    const position = () => viewport.evaluate((element) => element.scrollTop);
    await expect.poll(position).not.toBe(450);
    const completed = page.waitForResponse(
      (response) =>
        response.url().includes("/api/workspace/content?") &&
        new URL(response.url()).searchParams.get("path") ===
          "research/notes.md",
    );
    release();
    await completed;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect.poll(position).not.toBe(450);
    await expect
      .poll(() =>
        page
          .locator('[data-slot="workspace-markdown"] #evidence')
          .evaluate((element) => {
            const viewport = element.closest(
              '[data-slot="workspace-reader-scroll"]',
            );
            if (!viewport) throw new Error("Missing reader viewport");
            return Math.abs(
              element.getBoundingClientRect().top -
                viewport.getBoundingClientRect().top,
            );
          }),
      )
      .toBeLessThan(2);
  });
}

test("explorer breadcrumbs navigate folders without opening menus or changing files", async ({
  page,
}) => {
  await workspaceFixture(page);
  await page.goto("/workspace/research/nested/notes.md");
  await page.locator('[data-slot="workspace-markdown"]').waitFor();
  await returnToBrowser(page);
  const nav = page.locator('[data-slot="workspace-navigation"]');
  await nav.getByRole("button", { name: "research", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/research$/);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await nav.getByRole("button", { name: "Workspace", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await nav.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/research$/);
  if ((page.viewportSize()?.width ?? 1440) >= 900) {
    await expect(
      page.getByRole("tab", { name: "notes.md", exact: true }),
    ).toHaveAttribute("title", "research/nested/notes.md");
    await expect(
      page.locator('[data-slot="workspace-markdown"]'),
    ).toBeVisible();
  }
});

test("Up follows the displayed folder on direct file links", async ({
  page,
}) => {
  await workspaceFixture(page);
  await page.goto("/workspace/research/notes.md");
  await page.locator('[data-slot="workspace-markdown"]').waitFor();
  await returnToBrowser(page);
  await page
    .getByRole("button", { name: "Up one folder", exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(
    page.getByRole("button", { name: "Up one folder", exact: true }),
  ).toBeDisabled();
  await page.goto("/workspace/notes.md");
  await page.locator('[data-slot="workspace-markdown"]').waitFor();
  await returnToBrowser(page);
  await expect(
    page.getByRole("button", { name: "Up one folder", exact: true }),
  ).toBeDisabled();
});

test("automatically shows new bytes and preserves the reading position", async ({
  page,
}) => {
  const f = await workspaceFixture(page);
  await page.goto("/workspace/research/notes.md#evidence");
  const content = page.locator('[data-slot="workspace-markdown"] h1');
  await expect(content).toHaveText("Synthetic research version 1");
  const viewport = page.locator('[data-slot="workspace-reader-scroll"]');
  await viewport.evaluate((element) => {
    element.scrollTop = 600;
  });
  await page
    .locator('[data-slot="workspace-markdown"] p')
    .last()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  await expect
    .poll(() =>
      page.evaluate(() => window.getSelection()?.toString().length ?? 0),
    )
    .toBeGreaterThan(0);
  f.nextVersion();
  await expect(
    page.locator('[data-slot="workspace-file-updated"]'),
  ).toBeVisible({ timeout: 12000 });
  await expect(content).toHaveText("Synthetic research version 2");
  await expect(
    page.locator('[data-slot="workspace-file-updated"]'),
  ).toContainText("File updated.");
  await expect(page.getByRole("button", { name: "Load latest" })).toHaveCount(
    0,
  );
  expect(f.reads).toContain("version-2");
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(500);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("");
});

test("references a file without sending or losing the draft, then includes observed revision and view on submit", async ({
  page,
}) => {
  const f = await workspaceFixture(page);
  const composer = page.getByRole("textbox", { name: "Message Pythia" });
  await composer.fill("Keep this draft");
  await page
    .getByRole("link", { name: "Open synthetic research", exact: true })
    .click();
  const action = page.getByRole("button", {
    name: "Reference in chat",
    exact: true,
  });
  await action.click();
  await expect(composer).toHaveValue("Keep this draft");
  await expect(
    page.locator(
      '[data-slot="composer"] [data-slot="workspace-reference-cards"]',
    ),
  ).toContainText("notes.md");
  expect(f.chat.submissions).toEqual([]);
  await page
    .getByRole("button", { name: "Remove reference research/notes.md" })
    .click();
  if (!(await action.isVisible()))
    await page
      .getByRole("link", { name: "Open synthetic research", exact: true })
      .click();
  await action.focus();
  await page.keyboard.press("Control+Shift+Enter");
  await expect(
    page.locator(
      '[data-slot="composer"] [data-slot="workspace-reference-cards"]',
    ),
  ).toContainText("notes.md");
  expect(f.chat.submissions).toEqual([]);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => f.chat.submissions.length).toBe(1);
  expect(f.chat.workspaces[0]?.context?.references[0]).toMatchObject({
    path: "research/notes.md",
    revision: "version-1",
  });
  if (await action.isVisible())
    expect(f.chat.workspaces[0]?.view?.view.file?.path).toBe(
      "research/notes.md",
    );
  else {
    expect(f.chat.workspaces[0]?.view?.view.route).toMatch(/^\/(?:c\/[^/]+)?$/);
    expect(f.chat.workspaces[0]?.view?.view.file).toBeUndefined();
  }
  await f.chat.emit([
    { event: "run.completed", run_id: "synthetic-run", output: "Done" },
  ]);
  await expect.poll(() => f.chat.viewTerminations.length).toBe(1);
  expect(f.chat.unexpected).toEqual([]);
});

test("opening a docked chat artifact navigates the standalone reader and keeps its live stream", async ({
  page,
}) => {
  const f = await workspaceFixture(page);
  await page
    .getByRole("textbox", { name: "Message Pythia" })
    .fill("Continue researching");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => f.chat.streamRequests()).toBe(1);
  const navigation = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  if (await navigation.isVisible()) await navigation.click();
  await page
    .getByRole("link", { name: "Markets", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/markets$/);
  await expect
    .poll(() =>
      f.chat.viewPublications.some(
        (value) => value.view.route === "/markets" && !value.view.file,
      ),
    )
    .toBe(true);
  const openChat = page.getByRole("button", {
    name: "Open Pythia",
    exact: true,
  });
  if (await openChat.isVisible()) await openChat.click();
  await page
    .getByRole("link", { name: "Open synthetic research", exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspace\/research\/notes.md#evidence$/);
  await expect(
    page.getByRole("heading", {
      name: "Synthetic research version 1",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Pythia chat", exact: true }),
  ).toBeHidden();
  if (await openChat.isVisible()) {
    await openChat.click();
    await expect(
      page.getByRole("dialog", { name: "Pythia chat", exact: true }),
    ).toBeVisible();
    // Reopening the same artifact is still navigation intent even without a URL change.
    await page
      .getByRole("link", { name: "Open synthetic research", exact: true })
      .click();
    await expect(page).toHaveURL(/\/workspace\/research\/notes.md#evidence$/);
    await expect(
      page.getByRole("dialog", { name: "Pythia chat", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole("heading", {
        name: "Synthetic research version 1",
        exact: true,
      }),
    ).toBeVisible();
  }
  expect(f.chat.streamRequests()).toBe(1);
  await f.chat.emit([
    { event: "run.completed", run_id: "synthetic-run", output: "Finished" },
  ]);
  expect(f.chat.unexpected).toEqual([]);
});

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
