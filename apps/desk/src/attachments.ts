import type { FileUIPart } from "ai";

/** Public attachment receipts contain no host paths or credentials. */
export type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
};

export const MAX_ATTACHMENTS = 10;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_TURN_BYTES = 50 * 1024 * 1024;
export const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
export const ATTACHMENT_ID = /^[a-f0-9]{32}$/u;
export const ATTACHMENT_MARKER = "\n\n<pythia-attachments>\n";
const MARKER_END = "\n</pythia-attachments>";

export function attachmentUrl(id: string) {
  return `/api/attachments/${id}`;
}

export function attachmentPart(file: Attachment): FileUIPart {
  return {
    type: "file",
    url: attachmentUrl(file.id),
    filename: file.name,
    mediaType: file.mediaType,
  };
}

export function attachmentId(url: string) {
  const match = /^\/api\/attachments\/([a-f0-9]{32})$/u.exec(url);
  return match?.[1];
}

export function attachmentLimit(
  files: Pick<Attachment, "size" | "mediaType">[],
) {
  if (files.length > MAX_ATTACHMENTS)
    return "Attach up to 10 files per message.";
  if (files.some((file) => file.size <= 0))
    return "Empty files cannot be attached.";
  if (files.some((file) => file.size > MAX_FILE_BYTES))
    return "Each file must be 20 MB or smaller.";
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TURN_BYTES)
    return "Attachments must total 50 MB or less per message.";
  // Base64 plus the prompt must fit Hermes's native 10,000,000-byte request cap.
  if (
    files
      .filter((file) => IMAGE_TYPES.has(file.mediaType))
      .reduce((sum, file) => sum + file.size, 0) > MAX_IMAGE_BYTES
  )
    return "Images must total 6 MB or less per message.";
  return null;
}

export function attachmentNote(files: (Attachment & { path: string })[]) {
  return `${ATTACHMENT_MARKER}${JSON.stringify(files)}${MARKER_END}\nRead the attached files at the listed paths with your tools when their contents are needed. Extract text or data from binary documents before answering. Images are also supplied as image content.`;
}

/** Recover attachment cards from the user turn persisted by Hermes. */
export function splitAttachmentNote(text: string): {
  text: string;
  files: FileUIPart[];
} {
  const start = text.lastIndexOf(ATTACHMENT_MARKER);
  if (start < 0) return { text, files: [] };
  const end = text.indexOf(MARKER_END, start);
  if (end < 0) return { text, files: [] };
  try {
    const records: unknown = JSON.parse(
      text.slice(start + ATTACHMENT_MARKER.length, end),
    );
    if (
      !Array.isArray(records) ||
      !records.length ||
      records.length > MAX_ATTACHMENTS
    )
      return { text, files: [] };
    const files = records.map((record) => {
      if (
        !record ||
        typeof record !== "object" ||
        typeof record.id !== "string" ||
        !ATTACHMENT_ID.test(record.id) ||
        typeof record.name !== "string" ||
        typeof record.mediaType !== "string"
      )
        throw new Error();
      return attachmentPart(record);
    });
    return { text: text.slice(0, start), files };
  } catch {
    return { text, files: [] };
  }
}
