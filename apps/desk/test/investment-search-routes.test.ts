import { expect, test, vi } from "vitest";
import { createInvestmentSearchRoutes } from "../src/server/investment-search-routes";
import type { PluginTransport } from "../src/server/plugin-transport";

const input = {
  native_ref: {
    provider: "synthetic",
    native_id: "A",
    native_scope: "listing",
  },
  scope: "listing",
};
function request(body: unknown, trusted = true) {
  const token = "b".repeat(43);
  return new Request("http://localhost:8644/api/markets/adopt", {
    method: "POST",
    headers: {
      host: "localhost:8644",
      origin: trusted ? "http://localhost:8644" : "http://hostile.invalid",
      "content-type": "application/json",
      cookie: `pythia_desk_session=${token}`,
      "x-pythia-csrf": token,
    },
    body: JSON.stringify(body),
  });
}
test("selection admits only a typed local catalogue adoption, never arbitrary native mutation", async () => {
  const value = {
    schema_version: 1,
    outcome: "ok",
    effect: "local_write",
    issues: [],
    data: {
      subject: { kind: "listing", id: "listing:stable" },
      binding: input.native_ref,
      identity_status: "unresolved",
      mapping_id: "mapping:1",
    },
  };
  const transport = vi.fn<PluginTransport>(async () => JSON.stringify(value));
  const routes = createInvestmentSearchRoutes(transport);
  for (const body of [
    { ...input, action: "override" },
    { ...input, plugin: "other" },
    { ...input, scope: "unknown" },
    { ...input, native_ref: { ...input.native_ref, credentials: "secret" } },
  ]) {
    expect((await routes.adoptInvestment(request(body))).status).toBe(400);
  }
  expect((await routes.adoptInvestment(request(input, false))).status).toBe(
    403,
  );
  expect(transport).not.toHaveBeenCalled();
  const req = request(input);
  const response = await routes.adoptInvestment(req);
  expect(await response.json()).toEqual(value);
  expect(transport).toHaveBeenCalledExactlyOnceWith(
    {
      plugin: "pythia-market-data",
      operation: "query",
      arguments: { action: "adopt_search", ...input },
    },
    req.signal,
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
});
test("native identity failures preserve their reason instead of looking like successful selection", async () => {
  const transport = vi.fn<PluginTransport>(async () =>
    JSON.stringify({
      schema_version: 1,
      outcome: "error",
      data: null,
      issues: [
        {
          code: "ambiguous_identity",
          message: "The returned security could not be uniquely identified.",
          severity: "error",
        },
      ],
    }),
  );
  const response = await createInvestmentSearchRoutes(
    transport,
  ).adoptInvestment(request(input));
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({
    error: {
      code: "ambiguous_identity",
      message: "The returned security could not be uniquely identified.",
    },
  });
});

test.each([
  {
    label: "empty details",
    issues: [
      {
        code: "identity_not_selected",
        message: "No unique investment reference could be selected.",
        severity: "error",
      },
    ],
    code: "identity_not_selected",
    message: "No unique investment reference could be selected.",
  },
  {
    label: "incomplete details",
    issues: [
      {
        code: "incomplete_response",
        message: "The source returned incomplete identification details.",
        severity: "warning",
      },
      {
        code: "identity_not_selected",
        message: "No unique investment reference could be selected.",
        severity: "error",
      },
    ],
    code: "incomplete_response",
    message:
      "The source returned incomplete identification details. No unique investment reference could be selected.",
  },
])(
  "unsuccessful selection from $label retains native qualifications instead of a schema failure",
  async ({ issues, code, message }) => {
    // adopt_search normalizes non-writing outcomes to an error envelope; partial
    // success is reserved for an actual saved subject and usable binding.
    const transport = vi.fn<PluginTransport>(async () =>
      JSON.stringify({
        schema_version: 1,
        outcome: "error",
        data: null,
        issues,
      }),
    );
    const response = await createInvestmentSearchRoutes(
      transport,
    ).adoptInvestment(request(input));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code, message } });
  },
);
