import { expect, test } from "@playwright/test";
import type { Attachment } from "../src/attachments";
import { fixture } from "./stream-fixture";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGMQCbhAEmIY1TCqYfhqAAACqTQQqXt96AAAAABJRU5ErkJggg==",
  "base64",
);
/** The user turn as Hermes saved it: the attachment note Desk sent. */
const savedTurn = `\n\n<pythia-attachments>\n[{"id":"00000000000000000000000000000001","name":"holdings.csv","mediaType":"text/csv","size":25,"path":"/synthetic/attachments/1/file"},{"id":"00000000000000000000000000000002","name":"chart.png","mediaType":"image/png","size":${png.length},"path":"/synthetic/attachments/2/file"}]\n</pythia-attachments>\nRead the attached files at the listed paths with your tools when their contents are needed.`;

test("attachments survive new-chat handoff, upload retry and saved history", async ({
  page,
}) => {
  const f = await fixture(page);
  const runs: { input: string; attachments: string[] }[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/runs" &&
      request.method() === "POST"
    )
      runs.push(request.postDataJSON());
  });
  let uploads = 0;
  let failUpload = true;
  await page.route("**/api/attachments**", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ body: png, contentType: "image/png" });
    const body = route.request().postDataJSON();
    if (failUpload && body.name === "holdings.csv") {
      failUpload = false;
      return route.fulfill({
        status: 503,
        json: { error: { message: "Synthetic upload interrupted" } },
      });
    }
    uploads += 1;
    const file: Attachment = {
      id: String(uploads).padStart(32, "0"),
      name: body.name,
      mediaType: body.mediaType,
      size: Buffer.from(body.data, "base64").length,
    };
    return route.fulfill({ status: 201, json: file });
  });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Pythia" });
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
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page).toHaveURL(/\/c\/synthetic-created$/u);
  await f.emit([
    { event: "run.failed", error: "Synthetic provider rejected image input" },
  ]);
  await expect(
    page.getByText("Synthetic provider rejected image input", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  f.setHistory([
    {
      id: "u",
      role: "user",
      content: [
        { type: "text", text: savedTurn },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
        },
      ],
    },
    { id: "a", role: "assistant", content: "Synthetic attachment review" },
  ]);
  await f.emit([
    { event: "run.completed", output: "Synthetic attachment review" },
  ]);
  await expect(
    page.getByText("Synthetic attachment review", { exact: true }),
  ).toBeVisible();
  expect(runs).toHaveLength(2);
  expect(runs[0]?.input).toBe("");
  expect(runs[0]?.attachments).toHaveLength(2);
  expect(runs[1]?.attachments).toEqual(runs[0]?.attachments);
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
  expect(runs).toHaveLength(2);
  expect(f.unexpected).toEqual([]);
});
