import type { ModelProvider } from "@/server/model-catalog";

const VISIBILITY_KEY = "pythia-desk:model-visibility";

/** Hermes Desktop uses the backend order and caps non-featured defaults. */
export const DEFAULT_VISIBLE_PER_PROVIDER = 50;

export interface ModelFamily {
  id: string;
  fastId: string | null;
}

export type ModelVisibility = Set<string> | null;

/** Match Hermes Desktop's collision-safe provider/model key. */
export function modelKey(provider: string, model: string) {
  return `${provider}::${model}`;
}

const EMPTY_PROVIDER_MODEL = "";

function emptyProviderKey(provider: string) {
  return modelKey(provider, EMPTY_PROVIDER_MODEL);
}

function isProviderSentinel(key: string) {
  return key.endsWith("::");
}

/**
 * Match Hermes Desktop's model-family presentation. A native `-fast` sibling
 * is one model family, and a dated snapshot is omitted when its rolling alias
 * is present. The backend's order remains authoritative.
 */
export function collapseModelFamilies(models: readonly string[]) {
  const present = new Set(models);
  const consumed = new Set<string>();
  const families: ModelFamily[] = [];

  for (const model of models) {
    if (consumed.has(model)) continue;
    if (/-fast$/iu.test(model) && present.has(model.replace(/-fast$/iu, "")))
      continue;
    if (/-\d{8}$/u.test(model) && present.has(model.replace(/-\d{8}$/u, "")))
      continue;

    const fastId = `${model}-fast`;
    const hasFast = present.has(fastId);
    families.push({ id: model, fastId: hasFast ? fastId : null });
    consumed.add(model);
    if (hasFast) consumed.add(fastId);
  }

  return families;
}

function addProviderDefaults(provider: ModelProvider, target: Set<string>) {
  const families = collapseModelFamilies(
    provider.models.map((model) => model.id),
  );
  const defaults = provider.featuredModels.length
    ? families.filter((family) => provider.featuredModels.includes(family.id))
    : families.slice(0, DEFAULT_VISIBLE_PER_PROVIDER);

  for (const family of defaults) target.add(modelKey(provider.slug, family.id));
}

export function defaultVisibleModels(providers: readonly ModelProvider[]) {
  const visible = new Set<string>();
  for (const provider of providers) addProviderDefaults(provider, visible);
  return visible;
}

/**
 * Add Hermes defaults for providers the user has never edited. A sentinel
 * distinguishes an explicitly empty provider from an untouched provider.
 */
export function resolveVisibleModels(
  stored: ModelVisibility,
  providers: readonly ModelProvider[],
) {
  if (stored === null) return defaultVisibleModels(providers);
  if (stored.size === 0) return new Set<string>();

  const visible = new Set(stored);
  for (const provider of providers) {
    const prefix = `${provider.slug}::`;
    const hasModels = [...stored].some(
      (key) => key.startsWith(prefix) && !isProviderSentinel(key),
    );
    if (hasModels || stored.has(emptyProviderKey(provider.slug))) continue;
    addProviderDefaults(provider, visible);
  }
  return visible;
}

export function effectiveVisibleModels(
  stored: ModelVisibility,
  providers: readonly ModelProvider[],
) {
  const visible = resolveVisibleModels(stored, providers);
  for (const key of visible) {
    if (isProviderSentinel(key)) visible.delete(key);
  }
  return visible;
}

export function toggleModelVisibility(
  stored: ModelVisibility,
  providers: readonly ModelProvider[],
  providerSlug: string,
  model: string,
) {
  const visible = resolveVisibleModels(stored, providers);
  const key = modelKey(providerSlug, model);
  const sentinel = emptyProviderKey(providerSlug);

  if (visible.has(key)) {
    visible.delete(key);
    const prefix = `${providerSlug}::`;
    const providerStillVisible = [...visible].some(
      (candidate) =>
        candidate.startsWith(prefix) && !isProviderSentinel(candidate),
    );
    if (!providerStillVisible) visible.add(sentinel);
  } else {
    visible.delete(sentinel);
    visible.add(key);
  }
  return visible;
}

export function setProviderVisibility(
  stored: ModelVisibility,
  providers: readonly ModelProvider[],
  providerSlug: string,
  enabled: boolean,
) {
  const visible = resolveVisibleModels(stored, providers);
  const prefix = `${providerSlug}::`;
  for (const key of visible) {
    if (key.startsWith(prefix)) visible.delete(key);
  }

  if (enabled) {
    const provider = providers.find((entry) => entry.slug === providerSlug);
    for (const family of collapseModelFamilies(
      provider?.models.map((model) => model.id) ?? [],
    )) {
      visible.add(modelKey(providerSlug, family.id));
    }
  } else {
    visible.add(emptyProviderKey(providerSlug));
  }
  return visible;
}

export function readModelVisibility(): ModelVisibility {
  try {
    const value = JSON.parse(
      localStorage.getItem(VISIBILITY_KEY) ?? "null",
    ) as unknown;
    if (value === null) return null;
    // The previous object format represented different semantics. Treating it
    // as untouched lets Hermes's current curated defaults replace that state.
    if (!Array.isArray(value)) return null;
    return new Set(
      value.filter((key): key is string => typeof key === "string"),
    );
  } catch {
    return null;
  }
}

export function writeModelVisibility(value: Set<string>) {
  try {
    localStorage.setItem(VISIBILITY_KEY, JSON.stringify([...value]));
  } catch {
    // Hermes's curated defaults remain usable when browser storage is blocked.
  }
}
