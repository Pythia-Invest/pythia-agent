import { HermesApiError } from "./hermes-records";
import {
  hermesPages,
  isEditableHermesKey,
  pageFields,
  SECRET_KEY,
} from "@/settings/hermes-pages";
import type {
  AgentPlugin,
  ConfigFieldSchema,
  CustomEndpoint,
  HermesConfigView,
  McpServer,
  ProviderAccount,
  ProviderKey,
} from "./hermes-settings-contract";

/*
 * Narrow Hermes settings-server responses to what the browser may see, and
 * check what it may change. Pure, so the credential boundary is testable
 * without a running Hermes.
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const https = (value: unknown) => {
  const url = text(value);
  return url && /^https:\/\//iu.test(url) ? url : undefined;
};

function valueAt(config: Json, key: string): unknown {
  let current: unknown = config;
  for (const part of key.split(".")) {
    if (!isObject(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

const TYPES = new Set([
  "boolean",
  "number",
  "select",
  "string",
  "list",
  "text",
]);

function field(raw: unknown): ConfigFieldSchema | null {
  if (!isObject(raw) || typeof raw.type !== "string" || !TYPES.has(raw.type))
    return null;
  const description = text(raw.description);
  return {
    type: raw.type as ConfigFieldSchema["type"],
    ...(description ? { description } : {}),
    ...(Array.isArray(raw.options)
      ? { options: raw.options.map((option) => String(option)) }
      : {}),
    ...(raw.searchable === true ? { searchable: true } : {}),
    ...(raw.clearable === true ? { clearable: true } : {}),
  };
}

/**
 * Secrets never reach the browser at any depth: Hermes keeps some inline, for
 * example an `api_key` inside a fallback provider entry.
 */
export function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEY.test(key))
      .map(([key, item]) => [key, withoutSecrets(item)]),
  );
}

/** Key-order independent, for matching a returned entry to its original. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

/**
 * Hermes replaces a list on save rather than merging it, so an entry the
 * browser returns unchanged gets back the secrets the browser never saw.
 * New and edited entries carry none.
 */
function restoreSecrets(sent: unknown[], current: unknown): unknown[] {
  if (!Array.isArray(current)) return sent;
  const originals = new Map(
    current
      .filter(isObject)
      .map((item) => [canonical(withoutSecrets(item)), item] as const),
  );
  return sent.map((item) => {
    if (!isObject(item)) return item;
    const original = originals.get(canonical(item));
    return original ? { ...item, ...secretFields(original) } : item;
  });
}

function secretFields(item: Json): Json {
  return Object.fromEntries(
    Object.entries(item).filter(([key]) => SECRET_KEY.test(key)),
  );
}

/** A value matches its field's declared type and, for a choice, its options. */
function fitsSchema(schema: unknown, value: unknown): boolean {
  const declared = field(schema);
  if (!declared || value === null) return true;
  switch (declared.type) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number";
    case "select":
      return (
        (typeof value === "string" || typeof value === "number") &&
        (!declared.options?.length || declared.options.includes(String(value)))
      );
    case "string":
    case "text":
      return typeof value === "string";
    case "list":
      return Array.isArray(value);
  }
}

/** The fields Settings shows, from Hermes's schema and config. */
export function configView(schema: unknown, config: unknown): HermesConfigView {
  const fields =
    isObject(schema) && isObject(schema.fields) ? schema.fields : {};
  const record = isObject(config) ? config : {};
  const keys = Object.keys(fields);
  const shown = new Set(hermesPages.flatMap((page) => pageFields(page, keys)));
  const view: HermesConfigView = {
    schema: {},
    values: {},
    model: { provider: "", model: "" },
  };
  for (const key of shown) {
    const described = field(fields[key]);
    if (!described) continue;
    view.schema[key] = described;
    const value = valueAt(record, key);
    if (value !== undefined) view.values[key] = withoutSecrets(value);
  }
  const model = record.model;
  view.model = isObject(model)
    ? {
        provider: text(model.provider) ?? "",
        model: text(model.default) ?? text(model.name) ?? "",
      }
    : { provider: "", model: text(model) ?? "" };
  return view;
}

function jsonSafe(value: unknown, depth = 0): boolean {
  if (value === null || ["boolean", "string"].includes(typeof value))
    return typeof value !== "string" || value.length <= 8_192;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth > 3) return false;
  if (Array.isArray(value))
    return (
      value.length <= 200 && value.every((item) => jsonSafe(item, depth + 1))
    );
  if (isObject(value))
    return Object.entries(value).every(
      ([key, item]) => !SECRET_KEY.test(key) && jsonSafe(item, depth + 1),
    );
  return false;
}

/**
 * A browser change, flat by key, as the nested partial config Hermes merges
 * into config.yaml. Only fields Settings shows can change, each only to a
 * value of its declared type; `schema` and `current` are Hermes's own.
 */
export function configPatch(body: Json, schema?: unknown, current?: unknown) {
  const fields =
    isObject(schema) && isObject(schema.fields) ? schema.fields : {};
  const record = isObject(current) ? current : {};
  const changes = body.values;
  if (!isObject(changes) || !Object.keys(changes).length)
    throw new HermesApiError("Send at least one setting to change.", 400);
  const nested: Json = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!isEditableHermesKey(key))
      throw new HermesApiError(`Settings can't change ${key}.`, 400);
    if (!jsonSafe(value) || !fitsSchema(fields[key], value))
      throw new HermesApiError(`The value for ${key} isn't valid.`, 400);
    const parts = key.split(".");
    let target = nested;
    for (const part of parts.slice(0, -1)) {
      if (!isObject(target[part])) target[part] = {};
      target = target[part] as Json;
    }
    target[parts.at(-1) as string] = Array.isArray(value)
      ? restoreSecrets(value, valueAt(record, key))
      : value;
  }
  return nested;
}

/** Local paths and file names are not a sign-in's source worth showing. */
const source = (value: unknown) => {
  const label = text(value);
  return label && !/[\\/~]/u.test(label) ? label : undefined;
};

export function accounts(raw: unknown): ProviderAccount[] {
  const list =
    isObject(raw) && Array.isArray(raw.providers) ? raw.providers : [];
  return list.flatMap((item): ProviderAccount[] => {
    if (!isObject(item) || !text(item.id) || !text(item.name)) return [];
    const status = isObject(item.status) ? item.status : {};
    const flow = item.flow === "device_code" ? "device_code" : "external";
    const docsUrl = https(item.docs_url);
    const command = text(item.cli_command);
    const from = source(status.source_label);
    return [
      {
        id: text(item.id) as string,
        name: text(item.name) as string,
        flow,
        ...(docsUrl ? { docsUrl } : {}),
        ...(flow === "external" && command ? { command } : {}),
        connected: status.logged_in === true,
        ...(from ? { source: from } : {}),
        disconnectable: item.disconnectable === true,
      },
    ];
  });
}

/** Provider credentials Hermes keeps in `.env`: set or not, never the value. */
export function providerKeys(raw: unknown): ProviderKey[] {
  if (!isObject(raw)) return [];
  return Object.entries(raw).flatMap(([key, info]): ProviderKey[] => {
    if (!isObject(info) || info.category !== "provider") return [];
    if (!/^[A-Z][A-Z0-9_]{1,127}$/u.test(key)) return [];
    const set = info.is_set === true;
    const secret = info.is_password === true;
    const tail =
      set && secret && typeof info.redacted_value === "string"
        ? /\.\.\.([^.\s]{4})$/u.exec(info.redacted_value)?.[1]
        : undefined;
    const docsUrl = https(info.url);
    return [
      {
        key,
        label: text(info.description) ?? key,
        provider: text(info.provider_label) ?? "Other",
        ...(docsUrl ? { docsUrl } : {}),
        advanced: info.advanced === true,
        set,
        secret,
        ...(tail ? { hint: tail } : {}),
      },
    ];
  });
}

/** A key Settings may set or clear: one Hermes lists as a provider key. */
export function providerKeyChange(body: Json, known: readonly ProviderKey[]) {
  const key = text(body.key);
  if (!key || !known.some((item) => item.key === key))
    throw new HermesApiError(
      "That isn't a provider setting Hermes knows.",
      400,
    );
  if (body.value === null) return { key, value: null };
  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!value || value.length > 4_096 || /[\r\n\0]/u.test(value))
    throw new HermesApiError("Enter a single-line value.", 400);
  return { key, value };
}

export function customEndpoints(raw: unknown): CustomEndpoint[] {
  const list =
    isObject(raw) && Array.isArray(raw.endpoints) ? raw.endpoints : [];
  return list.flatMap((item): CustomEndpoint[] => {
    if (!isObject(item) || !text(item.id) || !text(item.base_url)) return [];
    return [
      {
        id: text(item.id) as string,
        name: text(item.name) ?? (text(item.id) as string),
        baseUrl: text(item.base_url) as string,
        model: text(item.model) ?? "",
        models: Array.isArray(item.models)
          ? item.models.flatMap((model) => text(model) ?? [])
          : [],
        hasKey: item.has_api_key === true,
        current: item.is_current === true,
      },
    ];
  });
}

export function mcpServers(raw: unknown): McpServer[] {
  const list = Array.isArray(raw)
    ? raw
    : isObject(raw) && Array.isArray(raw.servers)
      ? raw.servers
      : [];
  return list.flatMap((item): McpServer[] => {
    if (!isObject(item) || !text(item.name)) return [];
    return [
      {
        name: text(item.name) as string,
        transport: text(item.transport) ?? "unknown",
        enabled: item.enabled !== false,
        tools: Array.isArray(item.tools)
          ? item.tools.flatMap((tool) => text(tool) ?? [])
          : null,
      },
    ];
  });
}

/** Pythia's own plugin carries its research tools; Settings can't remove it. */
export const PYTHIA_PLUGIN = "pythia";

export function agentPlugins(raw: unknown): AgentPlugin[] {
  const list = isObject(raw) && Array.isArray(raw.plugins) ? raw.plugins : [];
  return list.flatMap((item): AgentPlugin[] => {
    if (!isObject(item) || !text(item.name)) return [];
    const name = text(item.name) as string;
    const version = text(item.version);
    const description = text(item.description);
    const authCommand =
      item.auth_required === true ? text(item.auth_command) : undefined;
    return [
      {
        name,
        ...(version ? { version } : {}),
        ...(description ? { description } : {}),
        source: text(item.source) ?? "unknown",
        active: ["active", "enabled", "loaded"].includes(
          String(item.runtime_status),
        ),
        ...(name === PYTHIA_PLUGIN
          ? { locked: "Pythia's research tools live in this plugin." }
          : {}),
        ...(authCommand ? { authCommand } : {}),
      },
    ];
  });
}
