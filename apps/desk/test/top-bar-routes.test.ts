import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createTopBarRoutes } from "../src/server/top-bar-routes";
import { createWorkspaceStore } from "../src/server/workspace/store";
import { TOP_BAR_CONFIG_PATH } from "../src/top-bar/config";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
function request(origin = "http://localhost:8644") {
  return new Request("http://localhost:8644/api/desk/top-bar", {
    headers: {
      host: "localhost:8644",
      origin,
      "sec-fetch-site": "same-origin",
    },
  });
}
const renderer = {
  plugin: "community/example",
  asset: "header",
  presentation: "topbar",
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "topbar-"));
  directories.push(root);
  await mkdir(join(root, "desk"));
  const native = vi.fn(async () => ({
    version: 1 as const,
    widgets: [
      {
        id: "topbar",
        asset: "header",
        input_contract: "pythia.desk-topbar.v1",
      },
    ],
    assets: [
      {
        id: "header",
        sha256: "a".repeat(64),
        bytes: 100,
        moduleUrl:
          "/api/plugins/community%2Fexample/widgets/header?revision=" +
          "a".repeat(64),
      },
    ],
  }));
  const routes = createTopBarRoutes(
    createWorkspaceStore(() => root),
    native,
  );
  const config = (value: unknown) =>
    writeFile(join(root, TOP_BAR_CONFIG_PATH), JSON.stringify(value));
  return { root, native, routes, config };
}
test("explicit core selection is preserved; configured native top bar is revalidated every read", async () => {
  const { routes, native, config } = await fixture();
  await config({ version: 1, renderer: null });
  expect(await (await routes.topBar(request())).json()).toEqual({
    renderer: null,
    settings: {},
  });
  expect(native).not.toHaveBeenCalled();
  await config({
    version: 1,
    renderer,
    settings: { caption: "Example", nested: [false, 2, null] },
  });
  const result = await (await routes.topBar(request())).json();
  expect(result.renderer).toEqual(renderer);
  expect(result.settings.nested).toEqual([false, 2, null]);
  expect(result.moduleUrl).toContain("revision=");
  await routes.topBar(request());
  expect(native).toHaveBeenCalledTimes(2);
  native.mockRejectedValueOnce(Error("disabled"));
  expect(await (await routes.topBar(request())).json()).toMatchObject({
    renderer: null,
    issue: expect.any(String),
  });
  expect((await (await routes.topBar(request())).json()).renderer).toEqual(
    renderer,
  );
});
test("invalid configuration, wrong input contract, missing module, and links fail visibly to core", async () => {
  const { root, routes, native, config } = await fixture();
  for (const value of [
    { version: 1, renderer: { ...renderer, plugin: "../escape" } },
    { version: 2, renderer },
    { version: 1, renderer, settings: [] },
    { version: 1, renderer, regions: {} },
  ]) {
    await config(value);
    expect(await (await routes.topBar(request())).json()).toMatchObject({
      renderer: null,
      issue: expect.any(String),
    });
  }
  expect(native).not.toHaveBeenCalled();
  await config({ version: 1, renderer });
  native.mockResolvedValueOnce({
    version: 1,
    widgets: [{ id: "topbar", asset: "header", input_contract: "other.v1" }],
    assets: [],
  });
  expect(await (await routes.topBar(request())).json()).toMatchObject({
    renderer: null,
    issue: expect.any(String),
  });
  await writeFile(join(root, TOP_BAR_CONFIG_PATH), " ".repeat(65_537));
  expect(await (await routes.topBar(request())).json()).toMatchObject({
    renderer: null,
    issue: expect.any(String),
  });
  await rm(join(root, TOP_BAR_CONFIG_PATH));
  await symlink(join(root, "outside.json"), join(root, TOP_BAR_CONFIG_PATH));
  expect(await (await routes.topBar(request())).json()).toMatchObject({
    renderer: null,
    issue: expect.any(String),
  });
});
test("explicit core selection and origin denial never inspect a plugin", async () => {
  const { routes, native, config } = await fixture();
  await config({ version: 1, renderer: null });
  expect(await (await routes.topBar(request())).json()).toEqual({
    renderer: null,
    settings: {},
  });
  expect((await routes.topBar(request("https://hostile.test"))).status).toBe(
    403,
  );
  expect(native).not.toHaveBeenCalled();
});
