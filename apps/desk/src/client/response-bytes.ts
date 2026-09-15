/** Enforce the budget while reading, including absent or inaccurate length headers. */
export async function readLimitedBytes(response: Response, limit: number) {
  if (
    Number(response.headers.get("content-length")) > limit ||
    !response.body
  ) {
    await response.body?.cancel();
    throw new Error("This file is too large to preview.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error("This file is too large to preview.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}
