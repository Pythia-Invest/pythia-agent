/** Copy a selected native custom provider's public routing, never credentials. */
export function inheritProviderDefaults(paths, apiKey, provider, execute) {
  if (typeof provider !== "string" || !provider.startsWith("custom:"))
    return false;
  const name = provider.slice("custom:".length);
  // Dotted native setters must address one literal provider key.
  if (!/^[A-Za-z0-9_-]+$/u.test(name)) return false;
  const read = (profile) =>
    JSON.parse(
      execute(
        paths,
        ["-p", profile, "config", "get", "providers", "--json"],
        apiKey,
      ),
    );
  const current = read(paths.profile);
  if (current && Object.hasOwn(current, name)) return false;
  const shared = read("default")?.[name];
  if (!shared || typeof shared !== "object" || Array.isArray(shared))
    return false;
  // Unsupported credential/header/command arrangements remain native user setup;
  // never partially reproduce them with a different authentication mechanism.
  const allowed = new Set([
    "api",
    "url",
    "base_url",
    "name",
    "key_env",
    "api_key_env",
    "transport",
    "api_mode",
    "default_model",
    "enabled",
  ]);
  if (Object.keys(shared).some((key) => !allowed.has(key))) return false;
  // Validate every copied alias, not just whichever one a consumer prefers.
  // Native surfaces accept different aliases; conflicting endpoints require
  // explicit native setup rather than silently choosing a route for the user.
  const endpoints = ["api", "url", "base_url"]
    .filter((key) => Object.hasOwn(shared, key))
    .map((key) => shared[key]);
  if (!endpoints.length) return false;
  let canonical;
  for (const endpoint of endpoints) {
    if (typeof endpoint !== "string") return false;
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      return false;
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false;
    if (canonical && canonical !== url.href) return false;
    canonical = url.href;
  }
  if (
    Object.entries(shared).some(([key, value]) =>
      key === "enabled"
        ? typeof value !== "boolean"
        : typeof value !== "string",
    )
  )
    return false;
  // One native mapping write avoids a half-populated endpoint on interruption.
  execute(
    paths,
    [
      "-p",
      paths.profile,
      "config",
      "set",
      `providers.${name}`,
      JSON.stringify(shared),
    ],
    apiKey,
  );
  const saved = read(paths.profile)?.[name];
  if (
    !saved ||
    Object.entries(shared).some(([key, value]) => saved[key] !== value)
  )
    throw new Error("Hermes did not retain the shared provider routing.");
  return true;
}
