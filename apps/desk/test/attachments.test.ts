import {
  mkdtemp,
  realpath,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { attachmentPart, MAX_IMAGE_BYTES } from "@/attachments";
import { historyToMessages, userText } from "@/client/chat-message";
import { createAttachmentStore, readUploadBody } from "@/server/attachments";
import { createDeskRoutes } from "@/server/routes";
import type { HermesClient } from "@/server/types";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), "pythia-attachments-")),
  );
  folders.push(folder);
  return { folder, store: createAttachmentStore(() => folder) };
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGMQCbhAEmIY1TCqYfhqAAACqTQQqXt96AAAAABJRU5ErkJggg==",
  "base64",
);
const upload = (
  name: string,
  bytes: Buffer,
  mediaType = "application/octet-stream",
) => ({ name, data: bytes.toString("base64"), mediaType });
function request(path: string, body?: unknown) {
  const token = "T".repeat(43);
  return new Request(`http://localhost:43121${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      host: "localhost:43121",
      origin: "http://localhost:43121",
      "content-type": "application/json",
      cookie: `pythia_desk_session=${token}`,
      "x-pythia-csrf": token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

it("round-trips file bytes and images through admitted upload, native run content, history and download", async () => {
  const { folder, store } = await fixture();
  const startRun = vi.fn(async () => ({
    run_id: "r",
    status: "running",
    replayed: false,
  }));
  const routes = createDeskRoutes(
    { startRun } as unknown as HermesClient,
    undefined,
    undefined,
    store,
  );
  const csv = Buffer.from("ticker,weight\nSYNTHETIC,1\n");
  const response = await routes.uploadAttachment(
    request("/api/attachments", upload("holdings.csv", csv)),
  );
  expect(response.status).toBe(201);
  const file = await response.json();
  expect(file).not.toHaveProperty("path");
  const image = await store.upload(upload("chart.png", png, "image/png"));
  expect(
    await routes.startRun(
      request("/api/runs", {
        session_id: "s",
        input: "",
        attachments: [file.id, image.id],
      }),
    ),
  ).toHaveProperty("status", 202);
  const input = startRun.mock.calls[0] as unknown as [
    string,
    { content: unknown[] }[],
  ];
  expect(input[0]).toBe("s");
  expect(input[1][0]?.content[1]).toEqual({
    type: "image_url",
    image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
  });
  const nativeFile = await store.get(file.id);
  expect(nativeFile.path.startsWith(join(folder, "attachments"))).toBe(true);
  expect(await readFile(nativeFile.path)).toEqual(csv);
  // A new store instance and Hermes transcript are sufficient after restart.
  expect(
    (await createAttachmentStore(() => folder).get(image.id)).bytes,
  ).toEqual(png);
  const saved = historyToMessages([
    { id: "u", role: "user", content: input[1][0]?.content },
  ]);
  const savedUser = saved[0];
  if (!savedUser) throw new Error("Native user turn was lost");
  expect(userText(savedUser)).toBe("");
  expect(saved[0]?.parts).toEqual([
    attachmentPart(file),
    attachmentPart(image),
  ]);
  const downloaded = await routes.downloadAttachment(
    request(`/api/attachments/${file.id}`),
    { params: Promise.resolve({ attachmentId: file.id }) },
  );
  expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(csv);
  expect(downloaded.headers.get("content-disposition")).toContain(
    "attachment;",
  );
  expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
});

it("rejects unadmitted writes, forged references and symlinks before a run starts", async () => {
  const { folder, store } = await fixture();
  const startRun = vi.fn();
  const routes = createDeskRoutes(
    { startRun } as unknown as HermesClient,
    undefined,
    undefined,
    store,
  );
  const hostile = request(
    "/api/attachments",
    upload("x.txt", Buffer.from("x")),
  );
  hostile.headers.set("origin", "https://foreign.example");
  expect((await routes.uploadAttachment(hostile)).status).toBe(403);
  expect(await readdir(folder)).toEqual([]);
  for (const id of [
    "../../outside",
    "f".repeat(32),
    "https://foreign.example/file",
  ]) {
    expect(
      (
        await routes.startRun(
          request("/api/runs", {
            session_id: "s",
            input: "Read",
            attachments: [id],
          }),
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
  }
  const file = await store.upload(
    upload("AGENTS.md", Buffer.from("Untrusted file content")),
  );
  const local = await store.get(file.id);
  expect(local.path.endsWith("/file.md")).toBe(true);
  await unlink(local.path);
  await symlink(join(folder, "outside"), local.path);
  await expect(store.get(file.id)).rejects.toThrow(
    "missing or no longer readable",
  );
  expect(startRun).not.toHaveBeenCalled();
});

it("enforces image byte budgets and bounded streaming uploads without trusting MIME or Content-Length", async () => {
  const { store } = await fixture();
  await expect(
    store.upload(upload("fake.png", Buffer.from("<script>"), "image/png")),
  ).rejects.toMatchObject({ status: 415 });
  const imageBytes = Buffer.alloc(MAX_IMAGE_BYTES / 2 + 1);
  png.copy(imageBytes);
  const image = await store.upload(upload("chart.png", imageBytes));
  await expect(store.input("Read", [image.id, image.id])).rejects.toMatchObject(
    { status: 413 },
  );
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  const oversized = new Request("http://localhost/upload", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  await expect(readUploadBody(oversized)).rejects.toMatchObject({
    status: 413,
  });
});
