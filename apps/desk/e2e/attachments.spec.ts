import { expect, test } from "@playwright/test";
import { attachmentNote, type Attachment } from "../src/attachments";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGMQCbhAEmIY1TCqYfhqAAACqTQQqXt96AAAAABJRU5ErkJggg==",
  "base64",
);

test("attachments survive new-chat handoff, upload retry and saved history", async ({
  page,
}, testInfo) => {
  const receipts: Attachment[] = [];
  const submissions: { input: string; attachments: string[] }[] = [];
  const unexpected: string[] = [];
  let failUpload = true;
  let saved = false;
  // No request in this test can start a real session or contact a provider.
  await page.route("**/api/**", async (route) => {
    const { pathname: path } = new URL(route.request().url());
    if (path === "/api/browser-session")
      return route.fulfill({ json: { csrf_token: "synthetic" } });
    if (path === "/api/capabilities")
      return route.fulfill({ json: { runSteer: true, modelOptions: true } });
    if (path === "/api/models")
      return route.fulfill({
        json: {
          provider: "synthetic",
          model: "research",
          providers: [
            {
              slug: "synthetic",
              name: "Synthetic",
              aliases: [],
              authenticated: true,
              featuredModels: ["research"],
              models: [{ id: "research" }],
            },
          ],
        },
      });
    if (path === "/api/attachments") {
      const body = route.request().postDataJSON();
      if (failUpload && body.name === "holdings.csv") {
        failUpload = false;
        return route.fulfill({
          status: 503,
          json: { error: { message: "Synthetic upload interrupted" } },
        });
      }
      const file: Attachment = {
        id: String(receipts.length + 1).padStart(32, "0"),
        name: body.name,
        mediaType: body.mediaType,
        size: Buffer.from(body.data, "base64").length,
      };
      receipts.push(file);
      return route.fulfill({ status: 201, json: file });
    }
    if (path.startsWith("/api/attachments/"))
      return route.fulfill({ body: png, contentType: "image/png" });
    if (path === "/api/sessions")
      return route.fulfill({
        json:
          route.request().method() === "POST"
            ? { session: { id: "attachment-chat", title: "Attachments" } }
            : {
                data: saved
                  ? [{ id: "attachment-chat", title: "Attachments" }]
                  : [],
              },
      });
    if (path === "/api/sessions/attachment-chat/messages") {
      const data = saved
        ? [
            {
              id: "u",
              role: "user",
              content: [
                {
                  type: "text",
                  text: attachmentNote(
                    receipts.map((file) => ({
                      ...file,
                      path: `/synthetic/attachments/${file.id}/file`,
                    })),
                  ),
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${png.toString("base64")}`,
                  },
                },
              ],
            },
            {
              id: "a",
              role: "assistant",
              content: "Synthetic attachment review",
            },
          ]
        : [];
      return route.fulfill({
        json: { data, returned: data.length, limit: 100, offset: 0 },
      });
    }
    if (path === "/api/runs" && route.request().method() === "POST") {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({
        status: 202,
        json: { run_id: "attachment-run", status: "running", replayed: false },
      });
    }
    if (path === "/api/runs/attachment-run/events") {
      if (submissions.length === 1)
        return route.fulfill({
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify({ event: "run.failed", run_id: "attachment-run", error: "Synthetic provider rejected image input" })}\n\n`,
        });
      saved = true;
      return route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ event: "run.completed", run_id: "attachment-run", output: "Synthetic attachment review" })}\n\n`,
      });
    }
    unexpected.push(path);
    return route.fulfill({
      status: 500,
      json: { error: { message: "Unexpected synthetic request" } },
    });
  });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Pythia" });
  await expect(input).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Model", exact: true }),
  ).toBeVisible();
  const picker = page.getByLabel("Attach files", { exact: true });
  await picker.setInputFiles([
    {
      name: "holdings.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("ticker,weight\nSYNTHETIC,1"),
    },
    { name: "chart.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByText("Synthetic upload interrupted")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Retry holdings.csv" }).click();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("attachment-draft.png") });
  // Synchronize on the destination's data request; cold dev routes may compile.
  const opened = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
      "/api/sessions/attachment-chat/messages",
  );
  await page.getByRole("button", { name: "Send message" }).click();
  expect((await opened).ok()).toBe(true);
  await expect(page).toHaveURL(/\/c\/attachment-chat$/u);
  await expect(
    page.getByText("Synthetic provider rejected image input", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("Synthetic attachment review", { exact: true }),
  ).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[0]?.input).toBe("");
  expect(submissions[0]?.attachments).toHaveLength(2);
  expect(submissions[1]?.attachments).toEqual(submissions[0]?.attachments);
  await page.reload();
  await page.getByRole("button", { name: "chart.png" }).click();
  const preview = page.getByRole("dialog", { name: "chart.png" });
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview
        .getByRole("img")
        .evaluate(
          (image: HTMLImageElement) =>
            image.complete && image.naturalWidth === 16,
        ),
    )
    .toBe(true);
  const download = page.waitForEvent("download");
  await preview.getByRole("button", { name: "Download chart.png" }).click();
  expect((await download).suggestedFilename()).toBe("chart.png");
  await page.getByRole("button", { name: "Close image preview" }).click();
  await expect(preview).toBeHidden();
  await expect(
    page.getByRole("button", { name: "holdings.csv" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("attachment-history.png"),
  });
  // Clipboard images and file drops share the upload path; removing them never sends a run.
  await input.evaluate((element, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(bytes)], "pasted.png", { type: "image/png" }),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, Array.from(png));
  await expect(
    page.getByRole("button", { name: "Remove pasted.png" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Remove pasted.png" }).click();
  await input.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["synthetic"], "dropped.txt", { type: "text/plain" }),
    );
    element.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(
    page.getByRole("button", { name: "Remove dropped.txt" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove dropped.txt" }).click();
  expect(submissions).toHaveLength(2);
  expect(unexpected).toEqual([]);
});
