import { afterEach, describe, expect, it, vi } from "vitest";
import { tailscaleAccess } from "../tailscale.mjs";
import {
  admitBrowserRequest,
  browserAdmissionNames,
  issueBrowserSession,
} from "@/server/admission";

const url = "http://127.0.0.1:43121/api/sessions";

afterEach(() => vi.unstubAllEnvs());

function request(method = "GET", headers: Record<string, string> = {}) {
  return new Request(url, {
    ...(method === "GET" || method === "OPTIONS" ? {} : { body: "{}" }),
    headers: { host: "127.0.0.1:43121", ...headers },
    method,
  });
}

describe("browser admission", () => {
  it("accepts a same-origin read from the loopback Desk", () => {
    expect(
      admitBrowserRequest(
        request("GET", { origin: "http://127.0.0.1:43121" }),
        "read",
      ),
    ).toBeNull();
  });

  it.each([
    [
      "hostile Host",
      {
        host: "attacker.example:43121",
        origin: "http://attacker.example:43121",
      },
    ],
    ["foreign Origin", { origin: "https://attacker.example" }],
    ["opaque Origin", { origin: "null" }],
    ["cross-site fetch metadata", { "sec-fetch-site": "cross-site" }],
  ])("rejects %s", async (_label, headers) => {
    const response = admitBrowserRequest(request("GET", headers), "read");
    expect(response?.status).toBe(403);
    expect(await response?.text()).toContain("browser_request_rejected");
  });

  it("rejects preflight explicitly", () => {
    const response = admitBrowserRequest(
      request("OPTIONS", {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
      }),
      "read",
    );
    expect(response?.status).toBe(405);
    expect(response?.headers.get("access-control-allow-origin")).toBeNull();
  });

  it.each([
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "text/plain",
  ])("rejects simple mutation content type %s", (contentType) => {
    const response = admitBrowserRequest(
      request("POST", {
        "content-type": contentType,
        origin: "http://127.0.0.1:43121",
      }),
      "mutation",
    );
    expect(response?.status).toBe(415);
  });

  it("requires a valid browser-session token for mutations", async () => {
    const bootstrap = issueBrowserSession(
      request("GET", { "sec-fetch-site": "same-origin" }),
    );
    const cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const { csrf_token: token } = (await bootstrap.json()) as {
      csrf_token: string;
    };

    const missing = admitBrowserRequest(
      request("POST", {
        "content-type": "application/json",
        origin: "http://127.0.0.1:43121",
      }),
      "mutation",
    );
    expect(missing?.status).toBe(403);

    const invalid = admitBrowserRequest(
      request("POST", {
        "content-type": "application/json",
        cookie,
        [browserAdmissionNames.csrfHeader]: "A".repeat(43),
      }),
      "mutation",
    );
    expect(invalid?.status).toBe(403);

    expect(
      admitBrowserRequest(
        request("POST", {
          "content-type": "application/json",
          cookie,
          [browserAdmissionNames.csrfHeader]: token,
        }),
        "mutation",
      ),
    ).toBeNull();
  });
});

describe("optional Tailscale access", () => {
  function configure(
    origin = "https://desk.example.ts.net:9443",
    login = "developer@example.com",
  ) {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PYTHIA_DESK_TAILSCALE_ORIGIN", origin);
    vi.stubEnv("PYTHIA_DESK_TAILSCALE_LOGIN", login);
    return {
      host: new URL(origin).host,
      "x-forwarded-host": new URL(origin).host,
      "x-forwarded-proto": "https",
      "tailscale-user-login": login,
      "sec-fetch-site": "same-origin",
    };
  }

  it.each([
    ["https://desk.example.ts.net:9443", "developer@example.com"],
    ["https://laptop.other.ts.net", "investor@example.org"],
  ])("uses operator configuration %s", async (origin, login) => {
    const headers = configure(origin, login);
    const session = issueBrowserSession(request("GET", headers));
    expect(session.status).toBe(200);
    expect(session.headers.get("set-cookie")).toContain("; Secure");
    expect(admitBrowserRequest(request("GET", headers), "read")).toBeNull();
    const { csrf_token: token } = await session.json();
    const mutation = {
      ...headers,
      origin,
      "content-type": "application/json",
      cookie: session.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
      "x-pythia-csrf": token,
    };
    expect(
      admitBrowserRequest(request("POST", mutation), "mutation"),
    ).toBeNull();
    expect(
      admitBrowserRequest(
        request("POST", { ...mutation, "x-pythia-csrf": "" }),
        "mutation",
      )?.status,
    ).toBe(403);
    expect(
      admitBrowserRequest(
        request("POST", { ...mutation, origin: "https://foreign.example" }),
        "mutation",
      )?.status,
    ).toBe(403);
  });

  it.each(["health", "bootstrap", "read", "mutation"] as const)(
    "rejects proxy bypasses before %s",
    (kind) => {
      const headers = configure();
      for (const override of [
        { "tailscale-user-login": "" },
        { "tailscale-user-login": "stranger@example.com" },
        { host: "127.0.0.1:43121" },
        {
          host: "127.0.0.1:43121",
          "tailscale-user-login": "",
          "x-forwarded-host": "127.0.0.1:43121",
        },
        { "x-forwarded-host": "foreign.example" },
        { "x-forwarded-proto": "http" },
        { "tailscale-funnel-request": "?1" },
      ])
        expect(
          admitBrowserRequest(request("GET", { ...headers, ...override }), kind)
            ?.status,
        ).toBe(403);
    },
  );

  it("keeps direct Next localhost traffic working", () => {
    configure();
    expect(
      admitBrowserRequest(
        request("GET", {
          "x-forwarded-host": "127.0.0.1:43121",
          "x-forwarded-proto": "http",
          "x-forwarded-for": "127.0.0.1",
          "sec-fetch-site": "same-origin",
        }),
        "read",
      ),
    ).toBeNull();
  });

  it("supports production opt-in, but remains disabled by default", () => {
    const headers = configure();
    vi.stubEnv("NODE_ENV", "production");
    expect(tailscaleAccess()?.host).toBe(headers.host);
    expect(admitBrowserRequest(request("GET", headers), "health")).toBeNull();
    expect(tailscaleAccess({ NODE_ENV: "development" })).toBeNull();
    expect(tailscaleAccess({ NODE_ENV: "production" })).toBeNull();
    vi.stubEnv("PYTHIA_DESK_TAILSCALE_ORIGIN", undefined);
    vi.stubEnv("PYTHIA_DESK_TAILSCALE_LOGIN", undefined);
    expect(admitBrowserRequest(request("GET", headers), "health")?.status).toBe(
      403,
    );
  });

  it.each([
    "",
    "http://desk.example.ts.net",
    "https://desk.example.ts.net/path",
    "https://desk.example.ts.net/",
    "https://desk.example.ts.net?x=1",
    "https://someone:password@desk.example.ts.net",
    "https://foreign.example",
  ])("rejects invalid origin %s", (origin) => {
    expect(() =>
      tailscaleAccess({
        NODE_ENV: "development",
        PYTHIA_DESK_TAILSCALE_ORIGIN: origin,
        PYTHIA_DESK_TAILSCALE_LOGIN: "developer@example.com",
      }),
    ).toThrow();
  });

  it("requires both configuration values", () => {
    expect(() =>
      tailscaleAccess({
        NODE_ENV: "development",
        PYTHIA_DESK_TAILSCALE_ORIGIN: "https://desk.example.ts.net",
      }),
    ).toThrow();
    expect(() =>
      tailscaleAccess({
        NODE_ENV: "development",
        PYTHIA_DESK_TAILSCALE_LOGIN: "developer@example.com",
      }),
    ).toThrow();
  });
});
