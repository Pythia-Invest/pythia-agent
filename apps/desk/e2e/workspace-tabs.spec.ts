import { expect, test } from "@playwright/test";
import { workspaceFixture, returnToBrowser } from "./workspace-fixture";

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

test("workspace references stay with the selected independent draft through its first send", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 900,
    "Cross-panel targeting qualification; narrow reference behavior is covered above.",
  );
  const f = await workspaceFixture(page);
  await page.goto("/workspace/research/notes.md");
  const dock = page.getByRole("complementary", { name: "Pythia", exact: true });
  const editor = dock.getByRole("textbox", { name: "Message Pythia" });
  const references = dock.locator(
    '[data-slot="composer"] [data-slot="workspace-reference-cards"]',
  );
  await editor.fill("Keep first draft");
  await dock.getByRole("button", { name: "New chat", exact: true }).click();
  await editor.fill("Research second draft");
  await page
    .getByRole("button", { name: "Reference in chat", exact: true })
    .click();
  await expect(references).toContainText("notes.md");
  const drafts = dock.getByRole("tab", { name: "New chat", exact: true });
  await drafts.first().click();
  await expect(editor).toHaveValue("Keep first draft");
  await expect(references).toBeHidden();
  await drafts.last().click();
  await expect(editor).toHaveValue("Research second draft");
  await dock.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => f.chat.submissions.length).toBe(1);
  expect(f.chat.workspaces[0]?.context?.references[0]).toMatchObject({
    path: "research/notes.md",
    revision: "version-1",
  });
  await f.chat.emit([
    { event: "run.completed", run_id: "synthetic-run", output: "Done" },
  ]);
  // The tab keeps its UI identity after sending, but references now target the
  // native session's composer rather than the retired draft key.
  await page
    .getByRole("button", { name: "Reference in chat", exact: true })
    .click();
  await expect(references).toContainText("notes.md");
  await drafts.first().click();
  await expect(editor).toHaveValue("Keep first draft");
  await expect(references).toBeHidden();
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
