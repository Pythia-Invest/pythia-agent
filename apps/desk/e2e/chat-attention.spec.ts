import { expect, type Page, test } from "@playwright/test";
import { fixture, send } from "./stream-fixture";

/** The chat list: beside the conversation on desktop, opened over it on a
 * phone from the chat header. */
async function showChats(page: Page) {
  const chats = page.getByRole("navigation", { name: "Chats", exact: true });
  if ((page.viewportSize()?.width ?? 0) < 900 && !(await chats.isVisible()))
    await page.getByRole("button", { name: "Show chats" }).click();
  return chats;
}

test("shows work in the list and keeps an unseen reply until its chat is opened", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  const chats = await showChats(page);
  const row = chats.getByRole("link", {
    name: "Synthetic chat review",
    exact: true,
  });
  await expect(row.getByRole("img", { name: "Working" })).toBeVisible();
  await chats.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  f.setHistory([
    { id: "question", role: "user", content: "Check the synthetic example." },
    { id: "reply", role: "assistant", content: "Reply received while away." },
  ]);
  await f.emit([
    { event: "run.completed", output: "Reply received while away." },
  ]);
  const returning = await showChats(page);
  const unread = returning.getByRole("link", {
    name: "Synthetic chat review",
    exact: true,
  });
  await expect(unread.getByRole("img", { name: "Working" })).toHaveCount(0);
  await expect(unread.getByRole("img", { name: "Unread reply" })).toBeVisible();
  await unread.click();
  await expect(
    page.getByText("Reply received while away.", { exact: true }),
  ).toBeVisible();
  const read = await showChats(page);
  await expect(read.getByRole("img", { name: "Unread reply" })).toHaveCount(0);
  expect(f.streamRequests()).toBe(1);
  expect(f.unexpected).toEqual([]);
});

test("reading earlier messages leaves a new reply unread until Jump to latest", async ({
  page,
}) => {
  const history = Array.from({ length: 35 }, (_, index) => ({
    id: `past-${index}`,
    role: "user",
    content: `Earlier question ${index}`,
  }));
  const f = await fixture(page, history);
  await send(page);
  const viewport = page.locator('[data-slot="conversation"]');
  await viewport.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll"));
  });
  await expect(
    page.getByRole("button", { name: "Jump to latest" }),
  ).toBeVisible();
  f.setHistory([
    ...history,
    { id: "question", role: "user", content: "Check the synthetic example." },
    { id: "reply", role: "assistant", content: "A new answer below." },
  ]);
  await f.emit([{ event: "run.completed", output: "A new answer below." }]);
  const chats = await showChats(page);
  await expect(chats.getByRole("img", { name: "Unread reply" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) < 900)
    await chats.getByRole("button", { name: "Hide chats" }).click();
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect(
    page.getByText("A new answer below.", { exact: true }),
  ).toBeInViewport();
  const read = await showChats(page);
  await expect(read.getByRole("img", { name: "Unread reply" })).toHaveCount(0);
  expect(f.unexpected).toEqual([]);
});

test("a hidden browser document does not acknowledge a completed reply", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await f.emit([
    { event: "run.completed", output: "Reply while browser was hidden." },
  ]);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("pythia-desk:unread-chats") ?? "[]"),
      ),
    )
    .toContain("synthetic-chat");
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("pythia-desk:unread-chats") ?? "[]"),
      ),
    )
    .not.toContain("synthetic-chat");
  expect(f.unexpected).toEqual([]);
});

test("the dock tab shows working and then an unread reply after switching to a draft", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 900,
    "Desktop tab indicator; narrow chat-list indicators covered above.",
  );
  const f = await fixture(page);
  await send(page);
  await page.getByRole("link", { name: "Markets", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "Pythia", exact: true });
  const tab = dock.getByRole("tab", {
    name: "Synthetic chat review",
    exact: true,
  });
  await expect(tab.getByRole("img", { name: "Working" })).toBeVisible();
  await dock.getByRole("button", { name: "New chat", exact: true }).click();
  await f.emit([{ event: "run.completed", output: "Ready in the other tab." }]);
  await expect(tab.getByRole("img", { name: "Unread reply" })).toBeVisible();
  await tab.click();
  await expect(
    dock.getByText("Ready in the other tab.", { exact: true }),
  ).toBeVisible();
  await expect(tab.getByRole("img", { name: "Unread reply" })).toHaveCount(0);
  expect(f.streamRequests()).toBe(1);
  expect(f.unexpected).toEqual([]);
});

test("a recovered terminal run and a rejected submission do not leave a working spinner", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  await f.emit([{ event: "message.delta", delta: "Working before reload" }]);
  f.setHistory([
    { id: "question", role: "user", content: "Check the synthetic example." },
    { id: "reply", role: "assistant", content: "Recovered reply." },
  ]);
  f.setStatus({
    run_id: "synthetic-run",
    status: "completed",
    output: "Recovered reply.",
  });
  await page.reload();
  await expect(page.getByText("Recovered reply.", { exact: true })).toHaveCount(
    1,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("pythia-desk:active-run:synthetic-chat"),
      ),
    )
    .toBeNull();
  const chats = await showChats(page);
  await expect(chats.getByRole("img", { name: "Working" })).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) < 900)
    await chats.getByRole("button", { name: "Hide chats" }).click();
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Synthetic submit unavailable" } },
    }),
  );
  await send(page);
  await expect(
    page.getByText("Synthetic submit unavailable", { exact: true }),
  ).toBeVisible();
  const rejected = await showChats(page);
  await expect(rejected.getByRole("img", { name: "Working" })).toHaveCount(0);
  expect(f.streamRequests()).toBe(1);
  expect(f.unexpected).toEqual([]);
});
