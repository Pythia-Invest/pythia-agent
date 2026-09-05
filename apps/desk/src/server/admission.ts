import { randomBytes, timingSafeEqual } from "node:crypto";
import { tailscaleAccess } from "../../tailscale.mjs";

const SESSION_COOKIE = "pythia_desk_session";
const CSRF_HEADER = "x-pythia-csrf";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

type AdmissionKind = "health" | "bootstrap" | "read" | "mutation";

function denied(message: string, status = 403, headers?: HeadersInit) {
  return Response.json(
    { error: { code: "browser_request_rejected", message } },
    { status, ...(headers ? { headers } : {}) },
  );
}

function parseLoopbackHost(value: string | null) {
  if (!value || /[\s/@\\]/u.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      !["127.0.0.1", "localhost"].includes(parsed.hostname)
    ) {
      return null;
    }
    return parsed.host;
  } catch {
    return null;
  }
}

function cookies(value: string | null) {
  const parsed = new Map<string, string>();
  for (const entry of (value ?? "").split(";")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    parsed.set(
      entry.slice(0, separator).trim(),
      entry.slice(separator + 1).trim(),
    );
  }
  return parsed;
}

function equalTokens(left: string, right: string) {
  if (!TOKEN_PATTERN.test(left) || !TOKEN_PATTERN.test(right)) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function admittedOrigin(request: Request) {
  const access = tailscaleAccess();
  const host = request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto");
  // Next supplies forwarded headers even for direct requests. HTTPS or a
  // Tailscale identity must never fall back to ordinary HTTP loopback access.
  if (
    protocol === "https" ||
    request.headers.has("tailscale-user-login") ||
    request.headers.has("tailscale-funnel-request") ||
    !parseLoopbackHost(host)
  ) {
    if (
      !access ||
      host !== access.host ||
      protocol !== "https" ||
      request.headers.get("x-forwarded-host") !== access.host ||
      request.headers.get("tailscale-user-login") !== access.login ||
      request.headers.has("tailscale-funnel-request")
    )
      return null;
    return access.origin;
  }
  if (protocol !== null && protocol !== "http") return null;
  return `http://${parseLoopbackHost(host)}`;
}

function trustedBrowserContext(request: Request, expectedOrigin: string) {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (origin === "null") return false;
    try {
      const parsed = new URL(origin);
      return parsed.origin === expectedOrigin && parsed.origin === origin;
    } catch {
      return false;
    }
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function validCsrf(request: Request) {
  const token = request.headers.get(CSRF_HEADER) ?? "";
  const session =
    cookies(request.headers.get("cookie")).get(SESSION_COOKIE) ?? "";
  return equalTokens(token, session);
}

export function admitBrowserRequest(
  request: Request,
  kind: AdmissionKind,
): Response | null {
  const expectedOrigin = admittedOrigin(request);
  if (!expectedOrigin)
    return denied(
      "Use the local Desk address or its configured Tailscale access.",
    );

  if (request.method === "OPTIONS") {
    return denied("Browser preflight requests are not accepted.", 405, {
      Allow: "GET, POST, PATCH",
    });
  }
  if (kind === "health") return null;

  const origin = request.headers.get("origin");
  if (origin === "null")
    return denied("Opaque browser origins are not accepted.");
  if (origin !== null && origin !== expectedOrigin)
    return denied("This request has a different browser origin.");
  const trustedContext = trustedBrowserContext(request, expectedOrigin);

  if (kind === "bootstrap") {
    return trustedContext
      ? null
      : denied("Open Pythia Desk before requesting a browser session.");
  }
  if (kind === "read") {
    return trustedContext || validCsrf(request)
      ? null
      : denied("This request did not come from the open Pythia Desk session.");
  }

  if (!["POST", "PATCH"].includes(request.method)) {
    return denied("This route does not accept that mutation method.", 405);
  }
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim();
  if (mediaType !== "application/json") {
    return denied("Pythia Desk mutations require application/json.", 415);
  }
  if (!trustedContext && !validCsrf(request)) {
    return denied(
      "This mutation did not come from the open Pythia Desk session.",
    );
  }
  if (!validCsrf(request)) {
    return denied(
      "The Pythia Desk browser session token is missing or invalid.",
    );
  }
  return null;
}

export function issueBrowserSession(request: Request) {
  const rejection = admitBrowserRequest(request, "bootstrap");
  if (rejection) return rejection;
  const existing =
    cookies(request.headers.get("cookie")).get(SESSION_COOKIE) ?? "";
  const token = TOKEN_PATTERN.test(existing)
    ? existing
    : randomBytes(32).toString("base64url");
  return Response.json(
    { csrf_token: token },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict${admittedOrigin(request)?.startsWith("https:") ? "; Secure" : ""}`,
      },
    },
  );
}

export const browserAdmissionNames = {
  csrfHeader: CSRF_HEADER,
  sessionCookie: SESSION_COOKIE,
};
