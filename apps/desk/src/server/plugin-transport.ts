import { createHermesRequest } from "./hermes";
import { profileFrom } from "./device-settings-native";

export type PluginCall = {
  plugin: string;
  operation: string;
  arguments: unknown;
  reuseScope?: string;
  readOnly?: boolean;
};
export const pluginIdPattern = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/u;
export const pluginOperationPattern = /^[a-z][a-z0-9_-]{0,63}$/u;
export type PluginTransport = (
  call: PluginCall,
  signal: AbortSignal,
) => Promise<string>;

/** Uses the same authenticated loopback transport as chat. No browser bearer,
 * provider credential, CLI command or arbitrary native tool name is accepted. */
export function createPluginTransport(
  environment = process.env,
): PluginTransport {
  const request = createHermesRequest({
    baseUrl: environment.PYTHIA_HERMES_API_URL ?? "",
    apiKey: environment.API_SERVER_KEY ?? "",
  });
  return async (call, signal) => {
    if (typeof call.plugin !== "string" || !pluginIdPattern.test(call.plugin))
      throw Error("invalid_plugin");
    if (
      typeof call.operation !== "string" ||
      !pluginOperationPattern.test(call.operation)
    )
      throw Error("invalid_operation");
    const response = await request(
      `/p/${encodeURIComponent(profileFrom(environment))}/v1/pythia/plugins/${encodeURIComponent(call.plugin)}/${call.operation}`,
      {
        method: "POST",
        body: JSON.stringify({
          arguments: call.arguments,
          ...(call.reuseScope ? { reuse_scope: call.reuseScope } : {}),
          ...(call.readOnly ? { read_only: true } : {}),
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
      },
    );
    // Bound untrusted upstream bytes before parsing or retaining results.
    const reader = response.body?.getReader();
    if (!reader) throw Error("empty_plugin_response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16_000_000) throw Error("plugin_response_limit");
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  };
}
