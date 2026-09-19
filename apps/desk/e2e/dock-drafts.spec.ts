import { expect, test } from "@playwright/test";
import { fixture } from "./stream-fixture";

test("new dock chats have independent drafts and can all be closed", async ({
  page,
}) => {
  await fixture(page);
  // Client navigation retains the shell's local tabs. All API traffic is mocked.
  if ((page.viewportSize()?.width ?? 0) < 900)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Watchlist", exact: true }).click();
  if ((page.viewportSize()?.width ?? 0) < 900)
    await page
      .getByRole("button", { name: "Open Pythia", exact: true })
      .click();
  const dock = page.getByRole("complementary", { name: "Pythia", exact: true });
  // fixture begins in an existing session. Close that tab, then use the initial draft.
  await dock
    .getByRole("button", { name: "Close Synthetic chat review" })
    .click();
  const editor = dock.getByRole("textbox", { name: "Message Pythia" });
  await editor.fill("First independent draft");
  await dock.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(editor).toHaveValue("");
  await editor.fill("Second independent draft");
  const drafts = dock.getByRole("tab", { name: "New chat", exact: true });
  await expect(drafts).toHaveCount(2);
  await drafts.first().click();
  await expect(editor).toHaveValue("First independent draft");
  await drafts.last().click();
  await expect(editor).toHaveValue("Second independent draft");
  await dock.getByRole("button", { name: "Hide Pythia", exact: true }).click();
  await page.getByRole("button", { name: "Open Pythia", exact: true }).click();
  await expect(editor).toHaveValue("Second independent draft");
  // Close the background tab without changing the selected draft.
  await dock.locator('[data-slot="chat-tab"]').first().hover();
  await dock
    .getByRole("button", { name: "Close New chat", exact: true })
    .first()
    .click();
  await expect(editor).toHaveValue("Second independent draft");
  await dock
    .getByRole("button", { name: "Close New chat", exact: true })
    .click();
  await expect(drafts).toHaveCount(0);
  await expect(editor).toHaveCount(0);
  await dock.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(drafts).toHaveCount(1);
  await expect(editor).toHaveValue("");
});

test("first send replaces its own draft without stealing another tab's focus", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 900,
    "Desktop race qualification; phone tab lifecycle is covered above.",
  );
  const f = await fixture(page);
  await page.getByRole("link", { name: "Watchlist", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "Pythia", exact: true });
  await dock
    .getByRole("button", { name: "Close Synthetic chat review" })
    .click();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await pending;
    return route.fulfill({
      status: 201,
      json: { session: { id: "synthetic-created", title: "Created chat" } },
    });
  });
  await dock
    .getByRole("textbox", { name: "Message Pythia" })
    .fill("Start this draft");
  await dock.getByRole("button", { name: "Send message" }).click();
  await dock.getByRole("button", { name: "New chat", exact: true }).click();
  await dock
    .getByRole("textbox", { name: "Message Pythia" })
    .fill("Keep this one selected");
  release();
  await expect(
    dock.getByRole("tab", { name: "New chat", exact: true }),
  ).toHaveCount(1);
  await expect(
    dock.getByRole("textbox", { name: "Message Pythia" }),
  ).toHaveValue("Keep this one selected");
  await expect.poll(() => f.submissions.length).toBe(1);
  expect(f.submissions[0]).toBe("Start this draft");
});

test("attachments and model choices stay with their draft through hiding and first send", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 900,
    "Desktop editor-state qualification; phone tab lifecycle is covered above.",
  );
  const f = await fixture(page);
  const attachmentId = "00000000000000000000000000000001";
  await page.route("**/api/attachments", async (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      json: {
        id: attachmentId,
        name: body.name,
        mediaType: body.mediaType,
        size: Buffer.from(body.data, "base64").length,
      },
    });
  });
  await page.getByRole("link", { name: "Watchlist", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "Pythia", exact: true });
  await dock
    .getByRole("button", { name: "Close Synthetic chat review" })
    .click();
  const model = dock.getByRole("combobox", { name: "Model", exact: true });
  await model.click();
  await page.getByRole("option", { name: /alternate-model/ }).click();
  await dock.locator('input[type="file"]').setInputFiles({
    name: "research.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic draft attachment"),
  });
  await expect(
    dock.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  await dock.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(dock.locator('[data-slot="draft-attachment"]')).toBeHidden();
  await model.click();
  await page.getByRole("option", { name: /research-model Synthetic/ }).click();
  const drafts = dock.getByRole("tab", { name: "New chat", exact: true });
  await drafts.first().click();
  await expect(model).toHaveText("alternate-model");
  await expect(dock.locator('[data-slot="draft-attachment"]')).toContainText(
    "research.txt",
  );
  await dock.getByRole("button", { name: "Hide Pythia", exact: true }).click();
  await page.getByRole("button", { name: "Open Pythia", exact: true }).click();
  await expect(model).toHaveText("alternate-model");
  await expect(dock.locator('[data-slot="draft-attachment"]')).toContainText(
    "research.txt",
  );
  await drafts.last().click();
  await expect(model).toHaveText("research-model");
  await expect(dock.locator('[data-slot="draft-attachment"]')).toBeHidden();
  await drafts.first().click();
  const sent = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/runs" &&
      request.method() === "POST",
  );
  await dock.getByRole("button", { name: "Send message" }).click();
  expect((await sent).postDataJSON().attachments).toEqual([attachmentId]);
  await expect.poll(() => f.selections.length).toBe(1);
  expect(f.selections[0]).toMatchObject({
    provider: "alternate",
    model: "alternate-model",
  });
  expect(f.unexpected).toEqual([]);
});

test("pending first send survives hiding and reopening, with retry after failure", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 900,
    "Desktop remount race; ordinary phone tab lifecycle is covered above.",
  );
  const f = await fixture(page);
  const creations: ((success: boolean) => void)[] = [];
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const success = await new Promise<boolean>((resolve) => {
      creations.push(resolve);
    });
    return route.fulfill(
      success
        ? {
            status: 201,
            json: {
              session: { id: "synthetic-created", title: "Created chat" },
            },
          }
        : {
            status: 503,
            json: { error: { message: "Synthetic session creation failed" } },
          },
    );
  });
  await page.getByRole("link", { name: "Watchlist", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "Pythia", exact: true });
  await dock
    .getByRole("button", { name: "Close Synthetic chat review" })
    .click();
  const editor = dock.getByRole("textbox", { name: "Message Pythia" });
  const send = dock.getByRole("button", { name: "Send message" });
  await editor.fill("Keep my pending prompt");
  await send.click();
  await expect.poll(() => creations.length).toBe(1);
  await dock.getByRole("button", { name: "Hide Pythia", exact: true }).click();
  await page.getByRole("button", { name: "Open Pythia", exact: true }).click();
  await expect(editor).toHaveValue("Keep my pending prompt");
  await expect(editor).toBeDisabled();
  await expect(send).toBeDisabled();
  expect(creations).toHaveLength(1);
  creations[0]?.(false);
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => creations.length).toBe(2);
  await dock.getByRole("button", { name: "Hide Pythia", exact: true }).click();
  creations[1]?.(true);
  await page.getByRole("button", { name: "Open Pythia", exact: true }).click();
  await expect(dock.getByRole("tab")).toHaveCount(1);
  await expect.poll(() => f.submissions.length).toBe(1);
  expect(f.submissions).toEqual(["Keep my pending prompt"]);
  expect(creations).toHaveLength(2);
  expect(f.unexpected).toEqual([]);
});
