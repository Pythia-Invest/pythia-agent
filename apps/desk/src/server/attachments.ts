import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, lstat, rm } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import {
  type Attachment,
  ATTACHMENT_ID,
  MAX_FILE_BYTES,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  IMAGE_TYPES,
  attachmentLimit,
  attachmentNote,
} from "@/attachments";
import { HermesApiError } from "./hermes-records";
import type { HermesInput } from "./types";

const MAX_UPLOAD_BODY = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4096;
const mimeByExtension: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function imageType(bytes: Buffer) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString()))
    return "image/gif";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return null;
}

/** Enforce the byte cap even when Content-Length is absent or untrusted. */
export async function readUploadBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BODY)
    throw new HermesApiError("Each file must be 20 MB or smaller.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new HermesApiError("Choose a file to upload.", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_UPLOAD_BODY)
        throw new HermesApiError("Each file must be 20 MB or smaller.", 413);
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HermesApiError("The upload must contain a JSON object.", 400);
  }
}

export function createAttachmentStore(
  workspace: () => string | undefined = () => process.env.PYTHIA_WORKSPACE,
) {
  async function root() {
    const configured = workspace();
    if (!configured || !isAbsolute(configured))
      throw new HermesApiError(
        "The local attachment folder is not configured.",
        503,
      );
    const base = await realpath(configured);
    const path = join(base, "attachments");
    await mkdir(path, { recursive: true, mode: 0o700 });
    if ((await lstat(path)).isSymbolicLink() || (await realpath(path)) !== path)
      throw new HermesApiError(
        "The attachment folder must be a local directory.",
        503,
      );
    return path;
  }

  async function readLocal(path: string, maximum: number) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maximum)
        throw new HermesApiError("The attachment is not a readable file.", 400);
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  async function get(id: string) {
    if (!ATTACHMENT_ID.test(id))
      throw new HermesApiError("Attachment not found.", 404);
    const directory = join(await root(), id);
    try {
      if ((await lstat(directory)).isSymbolicLink()) throw new Error();
      const stored = JSON.parse(
        (await readLocal(join(directory, "metadata.json"), 4096)).toString(),
      );
      if (
        stored.id !== id ||
        typeof stored.name !== "string" ||
        typeof stored.mediaType !== "string" ||
        !/^file(?:\.[a-z0-9]{1,16})?$/u.test(stored.file)
      )
        throw new Error();
      const path = join(directory, stored.file);
      const bytes = await readLocal(path, MAX_FILE_BYTES);
      if (bytes.length !== stored.size) throw new Error();
      // Do not trust editable metadata to turn arbitrary bytes into inline content.
      const mediaType =
        imageType(bytes) ??
        mimeByExtension[extname(stored.file)] ??
        "application/octet-stream";
      const attachment: Attachment = {
        id,
        name: stored.name,
        mediaType,
        size: bytes.length,
      };
      return { attachment, path, bytes };
    } catch {
      throw new HermesApiError(
        "This attachment is missing or no longer readable. Attach it again.",
        404,
      );
    }
  }

  return {
    get,
    async upload(value: unknown): Promise<Attachment> {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new HermesApiError("Choose a file to upload.", 400);
      const row = value as Record<string, unknown>;
      if (
        typeof row.name !== "string" ||
        !row.name.trim() ||
        row.name.length > 240 ||
        typeof row.data !== "string" ||
        row.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
        row.data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/u.test(row.data)
      )
        throw new HermesApiError("The attachment is invalid.", 400);
      const bytes = Buffer.from(row.data, "base64");
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip untrusted filename control characters.
      const name = row.name.replace(/[\x00-\x1f\x7f/\\]/gu, "_");
      const extension = extname(name).toLowerCase();
      const mediaType =
        imageType(bytes) ??
        mimeByExtension[extension] ??
        "application/octet-stream";
      if (
        typeof row.mediaType === "string" &&
        IMAGE_TYPES.has(row.mediaType) &&
        !imageType(bytes)
      )
        throw new HermesApiError(
          "The file is not a valid PNG, JPEG, GIF or WebP image.",
          415,
        );
      if (!bytes.length || bytes.length > MAX_FILE_BYTES)
        throw new HermesApiError(
          "Choose a nonempty file no larger than 20 MB.",
          413,
        );
      if (IMAGE_TYPES.has(mediaType) && bytes.length > MAX_IMAGE_BYTES)
        throw new HermesApiError(
          "Images must total 6 MB or less per message.",
          413,
        );
      const id = randomBytes(16).toString("hex");
      const directory = join(await root(), id);
      const file = `file${/^\.[a-z0-9]{1,16}$/u.test(extension) ? extension : ""}`;
      const attachment = { id, name, mediaType, size: bytes.length };
      await mkdir(directory, { mode: 0o700 });
      try {
        for (const [filename, content] of [
          [file, bytes],
          ["metadata.json", JSON.stringify({ ...attachment, file })],
        ] as const) {
          const handle = await open(join(directory, filename), "wx", 0o600);
          try {
            await handle.writeFile(content);
            await handle.sync();
          } finally {
            await handle.close();
          }
        }
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
      return attachment;
    },
    async input(text: string, ids: string[]): Promise<HermesInput> {
      const files = [];
      for (const id of ids) files.push(await get(id));
      const limit = attachmentLimit(files.map((file) => file.attachment));
      if (limit) throw new HermesApiError(limit, 413);
      const note = attachmentNote(
        files.map(({ attachment, path }) => ({ ...attachment, path })),
      );
      return [
        {
          role: "user",
          content: [
            { type: "text", text: text + note },
            ...files
              .filter(({ attachment }) => IMAGE_TYPES.has(attachment.mediaType))
              .map(({ attachment, bytes }) => ({
                type: "image_url" as const,
                image_url: {
                  url: `data:${attachment.mediaType};base64,${bytes.toString("base64")}`,
                },
              })),
          ],
        },
      ];
    },
  };
}

export type AttachmentStore = ReturnType<typeof createAttachmentStore>;
export const attachmentStore = createAttachmentStore();

/** Only uploaded, opaque IDs may cross the browser-to-run boundary. */
export function parseAttachmentIds(value: unknown): string[] {
  const ids = value ?? [];
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_ATTACHMENTS ||
    ids.some((id) => typeof id !== "string" || !ATTACHMENT_ID.test(id)) ||
    new Set(ids).size !== ids.length
  )
    throw new HermesApiError("Choose valid attachments for this message.", 400);
  return ids;
}

/** Inline only recognized images; documents must not become same-origin pages. */
export function attachmentResponse(
  { attachment, bytes }: { attachment: Attachment; bytes: Buffer },
  download: boolean,
) {
  const inline = IMAGE_TYPES.has(attachment.mediaType) && !download;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.mediaType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.name).replaceAll("'", "%27")}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
