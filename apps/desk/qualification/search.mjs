import assert from "node:assert/strict";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createQualificationProcesses } from "./processes.mjs";

const require = createRequire(import.meta.url);
const desk = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desk, "../..");
const evidence = join(root, ".private/plans/shared-investment-search/browser");
await mkdir(evidence, { recursive: true });
await mkdir(join(root, ".local"), { recursive: true });
const temporary = await mkdtemp(join(root, ".local/search-qualification-"));
const appDirectory = join(temporary, "apps/desk");
const abort = new AbortController();
const deadline = setTimeout(
  () => abort.abort(Error("Search qualification deadline")),
  240_000,
);
deadline.unref();
const processes = createQualificationProcesses(abort.signal);
let browser, native;
const requests = [];
let denied = false,
  releaseAdoption,
  pendingSearch = false,
  cancelled = false;
const reference = {
  provider: "synthetic",
  native_id: "AAPL",
  native_scope: "listing",
  qualifiers: { currency: "USD", venue: "Synthetic exchange" },
};
const investment = {
  id: "candidate:aapl",
  subject: null,
  name: "Apple ordinary share",
  symbol: "AAPL",
  kind: "listing",
  currency: "USD",
  venue: "Synthetic exchange",
  identity_status: "unresolved",
  references: [
    {
      native_ref: reference,
      name: "Apple ordinary share",
      symbol: "AAPL",
      status: "unresolved",
      available: true,
      metadata: { security_type: "Common stock" },
    },
  ],
};
function search(query) {
  return {
    schema_version: 1,
    outcome: query === "partial" ? "partial" : "ok",
    issues: [],
    data: {
      results:
        query === "empty"
          ? []
          : [
              investment,
              {
                ...investment,
                id: "candidate:receipt",
                name: "Apple depositary receipt",
                currency: "ARS",
                venue: "Argentina",
                references: [
                  {
                    ...investment.references[0],
                    native_ref: { ...reference, native_id: "AAPL.BA" },
                  },
                ],
              },
            ],
      coverage: [
        {
          provider: "synthetic",
          status: query === "partial" ? "error" : "ok",
          issues:
            query === "partial"
              ? [
                  {
                    code: "temporary",
                    message: "Synthetic source unavailable",
                    severity: "warning",
                  },
                ]
              : [],
          truncated: false,
        },
      ],
      truncated: false,
    },
  };
}
function adopted() {
  return {
    schema_version: 1,
    outcome: "partial",
    effect: "local_write",
    issues: [],
    data: {
      subject: { kind: "listing", id: "listing:stable-aapl" },
      binding: reference,
      identity_status: "unresolved",
      mapping_id: "mapping:stable-aapl",
    },
  };
}
try {
  await mkdir(appDirectory, { recursive: true });
  for (const name of [
    "src",
    "scripts",
    "package.json",
    "next.config.mjs",
    "tailscale.mjs",
    "tailscale.d.mts",
    "postcss.config.mjs",
    "tsconfig.json",
  ])
    await cp(join(desk, name), join(appDirectory, name), { recursive: true });
  for (const name of [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "tsconfig.base.json",
  ])
    await cp(join(root, name), join(temporary, name));
  await symlink(join(root, "packages"), join(temporary, "packages"), "dir");
  await symlink(
    join(root, "node_modules"),
    join(temporary, "node_modules"),
    "dir",
  );
  await symlink(
    join(desk, "node_modules"),
    join(appDirectory, "node_modules"),
    "dir",
  );
  const environment = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG"].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]]] : [],
    ),
  );
  Object.assign(environment, {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
  });
  await processes.command(
    process.execPath,
    [join(appDirectory, "scripts/pdf-assets.mjs")],
    { cwd: appDirectory, env: environment, stdio: "inherit" },
  );
  await processes.command(
    process.execPath,
    [require.resolve("next/dist/bin/next"), "build", "--webpack"],
    { cwd: appDirectory, env: environment, stdio: "inherit" },
  );
  native = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer synthetic-search-key");
    if (!req.url.endsWith("/plugins/pythia-market-data/query")) {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    if (denied) {
      res.writeHead(403, { "content-type": "application/json" }).end(
        JSON.stringify({
          error: { message: "Plugin disabled", code: "disabled" },
        }),
      );
      return;
    }
    res.setHeader("content-type", "application/json");
    if (body.arguments.action === "search_catalogue") {
      assert.equal(body.read_only, true);
      if (body.arguments.query === "slow") {
        pendingSearch = true;
        res.on("close", () => {
          cancelled = true;
        });
        return;
      }
      res.end(JSON.stringify(search(body.arguments.query)));
    } else if (body.arguments.action === "adopt_search") {
      assert.equal(body.read_only, undefined);
      releaseAdoption = () => res.end(JSON.stringify(adopted()));
    } else throw Error("Unexpected native action");
  });
  await new Promise((resolve) => native.listen(0, "127.0.0.1", resolve));
  const server = processes.child(
    process.execPath,
    [join(desk, "qualification/server.mjs"), appDirectory],
    {
      cwd: appDirectory,
      env: {
        ...environment,
        PYTHIA_HERMES_PROFILE: "synthetic",
        PYTHIA_HERMES_API_URL: `http://127.0.0.1:${native.address().port}`,
        API_SERVER_KEY: "synthetic-search-key",
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    },
  );
  const [{ port }] = await Promise.race([
    once(server, "message"),
    once(server, "exit").then(([code]) => {
      throw Error(`Server exited ${code}`);
    }),
  ]);
  const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({
    ...(process.env.PYTHIA_BROWSER_CHANNEL
      ? { channel: process.env.PYTHIA_BROWSER_CHANNEL }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/sessions")
      return route.fulfill({
        json: { data: [{ id: "chat1", title: "Apple research" }] },
      });
    return route.continue();
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const input = page.getByRole("searchbox", {
    name: "Search investments and chats",
  });
  await expect(input).toBeFocused();
  await input.fill("apple");
  const ordinary = page.getByRole("button", { name: /Apple ordinary share/ });
  await expect(ordinary).toBeVisible();
  await page.screenshot({ path: join(evidence, "search-desktop.png") });
  await expect(
    page.getByRole("button", { name: /Apple depositary receipt/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Apple research" }),
  ).toBeVisible();
  await input.press("Tab");
  await expect(ordinary).toBeFocused();
  await ordinary.press("Enter");
  await expect.poll(() => Boolean(releaseAdoption)).toBe(true);
  // Changing intent during a durable selection may complete the write, but
  // must not replace the new search with an obsolete selected investment.
  await input.fill("empty");
  releaseAdoption();
  releaseAdoption = undefined;
  await expect(
    page.getByText("No investments found.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Selected investment" }),
  ).toHaveCount(0);
  await input.fill("partial");
  await expect(
    page.getByText("Some sources could not be fully searched."),
  ).toBeVisible();
  await ordinary.click();
  await expect.poll(() => Boolean(releaseAdoption)).toBe(true);
  releaseAdoption();
  releaseAdoption = undefined;
  await expect(
    page.getByRole("region", { name: "Selected investment" }),
  ).toBeVisible();
  await page.getByText("Stable reference", { exact: true }).click();
  await expect(page.getByText(/listing:stable-aapl/)).toBeVisible();
  // Close/reopen forces current native authorization, never cached results.
  await input.press("Escape");
  await expect(
    page.getByRole("button", { name: "Search", exact: true }),
  ).toBeFocused();
  denied = true;
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByText(
      "Investment search is unavailable. Your chats are still searchable.",
    ),
  ).toBeVisible();
  await expect(ordinary).toHaveCount(0);
  denied = false;
  await input.fill("slow");
  await expect.poll(() => pendingSearch).toBe(true);
  await input.press("Escape");
  await expect.poll(() => cancelled).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Control+k");
  await expect(input).toBeFocused();
  await input.fill("apple");
  await expect(ordinary).toBeVisible();
  const box = await page.getByRole("dialog").boundingBox();
  await page.screenshot({ path: join(evidence, "search-mobile.png") });
  assert(box && box.x >= 0 && box.x + box.width <= 390);
  await ordinary.click();
  await expect.poll(() => Boolean(releaseAdoption)).toBe(true);
  releaseAdoption();
  releaseAdoption = undefined;
  await expect(
    page.getByRole("region", { name: "Selected investment" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue research in chat" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message Pythia", exact: true }),
  ).toHaveValue(/listing:stable-aapl/);
  assert.deepEqual(errors, []);
  assert(requests.length > 0);
  console.log(
    JSON.stringify(
      {
        productionSearch: true,
        nativeReadAndAdopt: true,
        keyboardAndNarrow: true,
        identityDetails: true,
        partialAndFailure: true,
        authorizationRevalidation: true,
        cancellation: true,
        staleSelectionRejected: true,
        researchDraft: true,
        providerCalls: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await processes.close();
  if (native) {
    native.closeAllConnections();
    await new Promise((resolve) => native.close(resolve));
  }
  await rm(temporary, { recursive: true, force: true });
  clearTimeout(deadline);
}
