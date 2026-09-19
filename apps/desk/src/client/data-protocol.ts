/** The channel carries explicit native operations, never credentials or tool names. */
export type DataResource = {
  plugin: string;
  operation: string;
  arguments: Record<string, unknown>;
  /** Optional operation-owned demand parameters; the native owner validates meaning. */
  window?: Record<string, unknown>;
};
export type PluginRequest = Pick<
  DataResource,
  "plugin" | "operation" | "arguments"
>;
export type DataUpdate = {
  schema_version: 1;
  index: number;
  generation: string;
  revision: number;
  type: "snapshot" | "status" | "reset";
  state: "ready" | "stale" | "loading" | "unavailable";
  data?: unknown;
  code?: string;
  refreshAfterSeconds?: number;
};

/** Bounded frames and an idle deadline; heartbeats keep the transport alive. */
export async function* readDataUpdates(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("Missing update stream.");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Update connection timed out.")),
            25_000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 8_000_000) throw Error("Update response too large.");
      while (true) {
        const end = buffer.indexOf("\n\n");
        if (end < 0) break;
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const line = frame.split("\n").find((row) => row.startsWith("data: "));
        if (!line) continue;
        const value = JSON.parse(line.slice(6)) as DataUpdate;
        if (
          value.schema_version !== 1 ||
          !Number.isSafeInteger(value.index) ||
          value.index < 0 ||
          !Number.isSafeInteger(value.revision) ||
          value.revision < 1 ||
          typeof value.generation !== "string" ||
          value.generation.length > 64 ||
          !["snapshot", "status", "reset"].includes(value.type) ||
          !["ready", "stale", "loading", "unavailable"].includes(value.state) ||
          (value.type === "snapshot" && value.data === undefined)
        )
          throw Error("Invalid update response.");
        yield value;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
