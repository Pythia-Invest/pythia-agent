import { isDeepStrictEqual } from "node:util";

// Pinned Hermes config.py and providers.py own these native fields/aliases.
// Free-form request bodies, headers, commands and inline secrets are deliberately
// not transported through config-set argv. Configure those in the target profile.
const stringFields = new Set([
  "name",
  "provider",
  "api",
  "url",
  "base_url",
  "baseUrl",
  "api_mode",
  "apiMode",
  "transport",
  "model",
  "default_model",
  "defaultModel",
  "key_env",
  "api_key_env",
  "keyEnv",
  "apiKeyEnv",
  "ssl_ca_cert",
]);
const numberFields = new Set([
  "context_length",
  "contextLength",
  "rate_limit_delay",
  "rateLimitDelay",
  "request_timeout_seconds",
  "stale_timeout_seconds",
]);
const booleanFields = new Set([
  "enabled",
  "discover_models",
  "models_discovered",
  "ssl_verify",
]);
const endpointFields = new Set(["api", "url", "base_url", "baseUrl"]);
const keyReferenceFields = new Set([
  "key_env",
  "api_key_env",
  "keyEnv",
  "apiKeyEnv",
]);

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateSharedEndpoint(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Shared model endpoint must not contain credentials, query parameters or fragments and must use HTTP(S).",
    );
}

// Matches pinned Hermes custom_provider_aliases, including keyed definitions
// whose display name differs from their durable provider ID.
function aliases(...names) {
  return names.flatMap((name) => {
    if (typeof name !== "string") return [];
    const raw = name.trim().toLowerCase();
    const normalized = raw.replaceAll(" ", "-");
    if (!raw) return [];
    return [
      raw,
      normalized,
      `custom:${normalized}`,
      ...(normalized.startsWith("custom:") ? [normalized.slice(7)] : []),
    ];
  });
}

function candidates(providers, legacy, selection) {
  const requested = selection.provider.trim().toLowerCase();
  // Hermes resolves the legacy list before its keyed compatibility entries.
  return [
    ...(legacy ?? []).map((entry) => ({ entry })),
    ...Object.entries(providers ?? {}).map(([key, entry]) => ({
      entry,
      key,
    })),
  ].filter(
    ({ key, entry }) =>
      record(entry) && aliases(key, entry.name).includes(requested),
  );
}

function validateModels(models) {
  const metadata = (value) =>
    record(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        (["context_length", "max_output_tokens"].includes(key) &&
          Number.isFinite(item) &&
          item > 0) ||
        ([
          "reasoning",
          "vision",
          "tool_call",
          "can_disable_reasoning",
          "__discovered_model_catalog__",
          "__explicit_model_allowlist__",
        ].includes(key) &&
          typeof item === "boolean"),
    );
  if (Array.isArray(models))
    return models.every(
      (item) =>
        typeof item === "string" ||
        (record(item) &&
          typeof (item.id ?? item.name) === "string" &&
          metadata(
            Object.fromEntries(
              Object.entries(item).filter(
                ([key]) => !["id", "name"].includes(key),
              ),
            ),
          )),
    );
  return (
    record(models) &&
    Object.entries(models).every(
      ([key, value]) =>
        ([
          "__discovered_model_catalog__",
          "__explicit_model_allowlist__",
        ].includes(key) &&
          typeof value === "boolean") ||
        metadata(value),
    )
  );
}

function validateDefinition(entry) {
  for (const [key, value] of Object.entries(entry)) {
    let valid = stringFields.has(key)
      ? typeof value === "string"
      : numberFields.has(key)
        ? Number.isFinite(value) && value >= 0
        : booleanFields.has(key)
          ? typeof value === "boolean"
          : key === "models"
            ? validateModels(value)
            : key === "capabilities" &&
              record(value) &&
              Object.values(value).every((item) => typeof item === "boolean");
    if (keyReferenceFields.has(key))
      valid = valid && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value);
    if (!valid)
      throw new Error(
        `Shared custom provider field '${key}' cannot be inherited safely. Configure this provider in the target profile through Hermes; keep credentials in native auth storage.`,
      );
    if (endpointFields.has(key)) validateSharedEndpoint(value);
  }
  if (![...endpointFields].some((key) => entry[key]))
    throw new Error("Shared custom provider has no endpoint.");
}

function definitions(read, profile) {
  const providers = read(profile, "providers", null);
  const legacy = read(profile, "custom_providers", null);
  if (
    (providers !== null && !record(providers)) ||
    (legacy !== null && !Array.isArray(legacy))
  )
    throw new Error(
      "Hermes custom provider configuration has an invalid shape; preserve it and repair through native configuration.",
    );
  return { providers, legacy };
}

/** Seed only the selected native provider; never copy secrets or unrelated rows. */
export function inheritCustomProvider(selection, profile, read, write) {
  const shared = definitions(read, "default");
  const matches = candidates(shared.providers, shared.legacy, selection);
  if (!matches.length) {
    if (
      selection.provider.startsWith("custom:") ||
      (selection.provider === "custom" && !selection.base_url)
    )
      throw new Error(
        "Shared custom provider definition is missing. Configure it through Hermes before inheriting its model selection.",
      );
    return false;
  }
  if (matches.length > 1)
    throw new Error(
      "Shared custom provider selection is ambiguous. Configure the target profile through Hermes.",
    );
  const local = definitions(read, profile);
  if (candidates(local.providers, local.legacy, selection).length) return false;
  const { entry, key: sharedKey } = matches[0];
  validateDefinition(entry);
  // Native dotted setters cannot append a list item. Project legacy entries
  // through Hermes's compatible keyed form so no existing list (which may
  // contain credentials) needs to pass through config-set argv.
  const key = sharedKey ?? entry.name.trim().toLowerCase().replaceAll(" ", "-");
  // A conflicting raw key remains user-owned, even if its value is malformed.
  if (Object.hasOwn(local.providers ?? {}, key))
    throw new Error(
      "The target custom provider key is already configured; preserve it and configure the model through Hermes.",
    );
  const path = `providers.${key.replaceAll(".", "\\.")}`;
  write(profile, path, JSON.stringify(entry));
  if (!isDeepStrictEqual(read(profile, path), entry))
    throw new Error(
      "Hermes did not retain the shared custom provider definition.",
    );
  return true;
}
