/** Plugin configuration contract shared by the settings service, routes and browser types. */
import { z } from "zod";
import {
  DeviceSettingsError,
  type Readiness,
} from "./device-settings-contract";
import { profileFrom } from "./device-settings-native";
import { tokenStatus } from "./device-settings-store";
import { createHermesRequest } from "./hermes";
import { pluginIdPattern, pluginOperationPattern } from "./plugin-transport";

export type FieldKind = "secret" | "identity";
export type ConfigurationCheck = {
  status: "valid" | "invalid" | "error";
  checked_at: string;
  message?: string;
};
/** A secret's stored value never leaves the server; identity text is shown. */
export type ConfigurationField = {
  key: string;
  kind: FieldKind;
  label: string;
  help: string;
  required: boolean;
  status: Readiness;
  value?: string;
};
export type PluginConfiguration = {
  plugin: string;
  name: string;
  description: string;
  status: "ready" | "needs_configuration";
  fields: ConfigurationField[];
  can_check: boolean;
  check: ConfigurationCheck | null;
};
export type PluginConfigurations = { plugins: PluginConfiguration[] };

export const keyPattern = /^[a-z][a-z0-9_]{2,63}$/u;
export const checksField = "configuration_checks";
/** Core custody and this service's own bookkeeping; never plugin-writable. */
export const reserved = new Set([
  "schema_version",
  "hermes_api_key",
  checksField,
]);
export const stores: Record<FieldKind, string> = {
  secret: "secrets.json",
  identity: "settings.json",
};
/** An unreadable or unsafe store; every status derived from it is invalid. */
export const unreadable = Symbol("unreadable store");

export function hasControl(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

const text = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => !hasControl(value));
const fieldSchema = z
  .object({
    key: z
      .string()
      .regex(keyPattern)
      .refine((key) => !reserved.has(key)),
    kind: z.enum(["secret", "identity"]),
    label: text(80).refine((value) => value.trim() !== ""),
    help: text(400),
    required: z.boolean(),
  })
  .strict();
const declarationSchema = z
  .object({
    plugin: z.string().max(129).regex(pluginIdPattern),
    name: text(80),
    description: text(200),
    check: z.string().regex(pluginOperationPattern).optional(),
    fields: z.array(fieldSchema).max(16),
  })
  .strict();
const nativeSchema = z.object({
  schema_version: z.literal(1),
  data: z.object({ plugins: z.array(declarationSchema).max(256) }),
});
export type PluginDeclaration = z.infer<typeof declarationSchema>;
export type Field = PluginDeclaration["fields"][number];
export type DeclarationReader = (
  signal: AbortSignal,
) => Promise<PluginDeclaration[]>;

export const checkResponseSchema = z.object({
  schema_version: z.literal(1),
  data: z.object({
    status: z.enum(["valid", "invalid"]),
    message: z.string().optional(),
  }),
});
export const checkRecordSchema = z
  .object({
    status: z.enum(["valid", "invalid", "error"]),
    checked_at: z.string().max(40),
    message: z.string().max(200).optional(),
  })
  .strict();

/** Mirrors the core reader's readiness rules for each kind. */
export function fieldStatus(kind: FieldKind, value: unknown): Readiness {
  if (kind === "secret") return tokenStatus(value);
  if (value === undefined || value === null || value === "") return "missing";
  return typeof value === "string" &&
    value.length <= 320 &&
    value === value.trim() &&
    !hasControl(value)
    ? "configured"
    : "invalid";
}

export function failure(
  message: string,
  status = 400,
  code = "invalid_configuration",
) {
  return new DeviceSettingsError(message, status, code);
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function boundedText(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw failure("Hermes returned too much data.", 502);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads core's projection of enabled plugins' static declarations. */
export function createNativeDeclarationReader(
  environment: NodeJS.ProcessEnv = process.env,
): DeclarationReader {
  const request = createHermesRequest({
    baseUrl: environment.PYTHIA_HERMES_API_URL ?? "",
    apiKey: environment.API_SERVER_KEY ?? "",
  });
  return async (signal) => {
    const response = await request(
      `/p/${encodeURIComponent(profileFrom(environment))}/v1/pythia/configuration`,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) },
    );
    try {
      const body = JSON.parse(await boundedText(response, 262_144));
      return nativeSchema.parse(body).data.plugins;
    } catch (error) {
      if (error instanceof DeviceSettingsError) throw error;
      throw failure("Hermes returned invalid plugin configuration.", 502);
    }
  };
}

/** Core hides fields whose plugins disagree on the kind; never write one. */
export function consistent(declarations: PluginDeclaration[]) {
  const kinds = new Map<string, Set<FieldKind>>();
  for (const plugin of declarations)
    for (const field of plugin.fields)
      kinds.set(field.key, (kinds.get(field.key) ?? new Set()).add(field.kind));
  return declarations.map((plugin) => ({
    ...plugin,
    fields: plugin.fields.filter((field) => kinds.get(field.key)?.size === 1),
  }));
}
