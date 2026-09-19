import { z } from "zod";
import { HermesApiError } from "./hermes-records";
import { pluginIdPattern, pluginOperationPattern } from "./plugin-transport";

export const pluginRequestSchema = z
  .object({
    plugin: z.string().regex(pluginIdPattern),
    operation: z.string().regex(pluginOperationPattern),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();

/** Bound actual streamed request bytes even when Content-Length is absent. */
export async function readPluginRequestBody(
  request: Request,
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new HermesApiError("Missing plugin request.", 400);
  let size = 0;
  let expired = false;
  const chunks: Uint8Array[] = [];
  const deadline = setTimeout(() => {
    expired = true;
    void reader.cancel();
  }, 5_000);
  try {
    while (true) {
      const part = await reader.read();
      if (expired) throw new HermesApiError("Plugin request timed out.", 408);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65_536)
        throw new HermesApiError("Plugin request is too large.", 413);
      chunks.push(part.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HermesApiError("Invalid plugin request.", 400);
    }
  } finally {
    clearTimeout(deadline);
    await reader.cancel();
    reader.releaseLock();
  }
}
