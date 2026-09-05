/** Optional access through a local Tailscale Serve HTTPS proxy. */
export function tailscaleAccess(environment = process.env) {
  const origin = environment.PYTHIA_DESK_TAILSCALE_ORIGIN;
  const login = environment.PYTHIA_DESK_TAILSCALE_LOGIN;
  if (origin === undefined && login === undefined) return null;
  const message =
    "Set PYTHIA_DESK_TAILSCALE_ORIGIN to an HTTPS origin and PYTHIA_DESK_TAILSCALE_LOGIN to the permitted Tailscale login, or unset both.";
  let parsed;
  try {
    parsed = new URL(origin ?? "");
  } catch {
    throw new Error(message);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== origin ||
    !parsed.hostname.endsWith(".ts.net") ||
    parsed.username ||
    parsed.password ||
    !login ||
    login.trim() !== login ||
    /[^\x21-\x7e]/u.test(login)
  ) {
    throw new Error(message);
  }
  return { origin, host: parsed.host, hostname: parsed.hostname, login };
}
