import { expect, test, vi } from "vitest";
import { createPluginInvokeRoutes } from "../src/server/plugin-invoke-routes";
import { createPluginReadRoutes } from "../src/server/plugin-read-routes";
import { HermesApiError } from "../src/server/hermes-records";
import type { PluginTransport } from "../src/server/plugin-transport";

const intent = {
  plugin: "research/local-feature",
  operation: "summary",
  arguments: { topic: "Synthetic" },
};
function request(body: unknown, trusted = true) {
  const token = "b".repeat(43);
  return new Request("http://localhost:8644/api/data/read", {
    method: "POST",
    headers: {
      host: "localhost:8644",
      origin: trusted ? "http://localhost:8644" : "http://hostile.invalid",
      "content-type": "application/json",
      cookie: `pythia_desk_session=${token}`,
      "x-pythia-csrf": token,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("a declared plugin snapshot passes its JSON unchanged without financial translation or tool context", async () => {
  const snapshot = {
    schema_version: 1,
    data: {
      label: "Synthetic",
      decimal: "12.3400",
      values: [null, false, { count: 3 }],
    },
    extra: { preserved: true },
  };
  const transport = vi.fn<PluginTransport>(async () =>
    JSON.stringify(snapshot),
  );
  const input = request(intent);
  const response = await createPluginReadRoutes(transport).pluginRead(input);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(snapshot);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(transport).toHaveBeenCalledExactlyOnceWith(
    { ...intent, readOnly: true },
    input.signal,
  );
});

test("untrusted, malformed, over-budget and tool-shaped calls are rejected before native invocation", async () => {
  const transport = vi.fn<PluginTransport>();
  const routes = createPluginReadRoutes(transport);
  expect((await routes.pluginRead(request(intent, false))).status).toBe(403);
  for (const input of [
    { ...intent, plugin: "../escape" },
    { ...intent, operation: "../../runs" },
    { ...intent, arguments: [] },
    { ...intent, tool: "shell_exec" },
    { ...intent, session_id: "not-widget-authority" },
    { ...intent, readOnly: false },
    { ...intent, read_only: false },
    "{",
  ])
    expect((await routes.pluginRead(request(input))).status).toBe(400);
  expect(
    (
      await routes.pluginRead(
        request({ ...intent, arguments: { value: "x".repeat(65_536) } }),
      )
    ).status,
  ).toBe(413);
  expect(transport).not.toHaveBeenCalled();
});

test("native denial remains an error instead of an alternate source or successful empty snapshot", async () => {
  const transport = vi.fn<PluginTransport>(async () => {
    throw new HermesApiError(
      "Plugin operation is unavailable.",
      403,
      "unavailable",
    );
  });
  const response = await createPluginReadRoutes(transport).pluginRead(
    request(intent),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: { code: "unavailable", message: "Plugin operation is unavailable." },
  });
  expect(transport).toHaveBeenCalledTimes(1);
});

test("only explicit invoke omits read-only and retains admission, validation and native denial", async () => {
  const transport = vi.fn<PluginTransport>(async () =>
    JSON.stringify({ done: true }),
  );
  const routes = createPluginInvokeRoutes(transport);
  const input = request(intent);
  expect(await (await routes.pluginInvoke(input)).json()).toEqual({
    done: true,
  });
  expect(transport).toHaveBeenCalledExactlyOnceWith(intent, input.signal);
  transport.mockClear();
  expect((await routes.pluginInvoke(request(intent, false))).status).toBe(403);
  const noCsrf = request(intent);
  noCsrf.headers.delete("x-pythia-csrf");
  expect((await routes.pluginInvoke(noCsrf)).status).toBe(403);
  for (const body of [
    { ...intent, tool: "shell_exec" },
    { ...intent, read_only: false },
    { ...intent, operation: "../tools" },
    { ...intent, arguments: [] },
  ])
    expect((await routes.pluginInvoke(request(body))).status).toBe(400);
  expect(
    (
      await routes.pluginInvoke(
        request({ ...intent, arguments: { value: "x".repeat(65_536) } }),
      )
    ).status,
  ).toBe(413);
  expect(transport).not.toHaveBeenCalled();
  transport.mockRejectedValueOnce(
    new HermesApiError("Unavailable", 403, "unavailable"),
  );
  expect((await routes.pluginInvoke(request(intent))).status).toBe(403);
});
