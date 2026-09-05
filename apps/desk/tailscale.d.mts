export function tailscaleAccess(
  environment?: Record<string, string | undefined>,
): { origin: string; host: string; hostname: string; login: string } | null;
