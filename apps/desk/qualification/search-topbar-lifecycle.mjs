import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { buildWidget } from "../../../packages/widget-sdk/build.mjs";

/** Native presentation and a deliberately unfinished protected read. No provider
 * work or generated substitute host: the production Desk serves this artifact. */
export async function createTopBarLifecycleFixture(root, temporary) {
  const artifact = join(temporary, "topbar-lifetime.mjs");
  await buildWidget(
    join(root, "apps/desk/qualification/search-topbar-probe.tsx"),
    artifact,
  );
  const content = await readFile(artifact, "utf8");
  const asset = {
    id: "probe",
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: Buffer.byteLength(content),
    media_type: "text/javascript",
  };
  const state = { assetRequests: 0, pendingReads: 0, cancelledReads: 0 };
  return {
    state,
    digest: asset.sha256,
    handle(req, res, body) {
      if (req.url.endsWith("/plugins/qualification-top-bar/widgets")) {
        assert.equal(body.read_only, true);
        res.setHeader("content-type", "application/json");
        if (body.arguments.asset) {
          assert.equal(body.arguments.asset, "probe");
          state.assetRequests += 1;
          if (state.assetRequests === 1) {
            res.writeHead(503).end(
              JSON.stringify({
                error: { message: "Synthetic temporary asset failure" },
              }),
            );
          } else {
            res.end(
              JSON.stringify({
                schema_version: 1,
                data: { ...asset, asset: "probe", content },
              }),
            );
          }
        } else {
          res.end(
            JSON.stringify({
              schema_version: 1,
              data: {
                version: 1,
                widgets: [
                  {
                    id: "probe",
                    asset: "probe",
                    input_contract: "pythia.desk-topbar.v1",
                  },
                ],
                assets: [asset],
              },
            }),
          );
        }
        return true;
      }
      if (req.url.endsWith("/plugins/qualification-top-bar/query")) {
        assert.equal(body.read_only, true);
        assert.deepEqual(body.arguments, { action: "wait" });
        state.pendingReads += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.flushHeaders();
        res.on("close", () => {
          if (!res.writableEnded) state.cancelledReads += 1;
        });
        return true;
      }
      return false;
    },
  };
}

export async function qualifyTopBarLifecycle({ page, fixture, topBarConfig }) {
  await writeFile(
    topBarConfig,
    JSON.stringify({
      version: 1,
      renderer: {
        plugin: "qualification-top-bar",
        asset: "probe",
        presentation: "probe",
      },
    }),
  );
  const assets = [];
  const observeRequest = (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/plugins/qualification-top-bar/widgets/probe")
      assets.push(url);
  };
  page.on("request", observeRequest);
  let navigations = 0;
  const observeNavigation = (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  };
  try {
    await page.reload();
    const retry = page.getByRole("button", {
      name: "Retry top bar",
      exact: true,
    });
    await expect(retry).toBeVisible();
    assert.equal(fixture.state.assetRequests, 1);
    await expect(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    ).toBeVisible();
    // Only this explicit retry may recover the rejected dynamic import. The
    // native descriptor, artifact digest and browser document stay unchanged.
    page.on("framenavigated", observeNavigation);
    await retry.click();
    await expect(
      page.getByText("Custom topbar recovered", { exact: true }),
    ).toBeVisible();
    assert.equal(fixture.state.assetRequests, 2);
    assert.equal(navigations, 0);
    assert.equal(assets.length, 2);
    assert(
      assets.every(
        (url) => url.searchParams.get("revision") === fixture.digest,
      ),
    );
    await expect.poll(() => fixture.state.pendingReads).toBe(1);
    assert.equal(fixture.state.cancelledReads, 0);
    await page
      .getByRole("button", { name: "Crash custom topbar", exact: true })
      .click();
    await expect(retry).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-slot="topbar-lifetime-probe"]'),
    ).toHaveCount(0);
    // This read supplied no author AbortSignal; the host must abort its own
    // lifetime when the module fails, well before the native 35s timeout.
    await expect
      .poll(() => fixture.state.cancelledReads, { timeout: 5_000 })
      .toBe(1);
    assert.equal(fixture.state.pendingReads, 1);
    assert.equal(navigations, 0);
    return {
      transientModuleRetry: true,
      unchangedDescriptorRetry: true,
      crashedModuleReadCancellation: true,
    };
  } finally {
    page.off("request", observeRequest);
    page.off("framenavigated", observeNavigation);
    await rm(topBarConfig, { force: true });
    await page.reload();
  }
}
