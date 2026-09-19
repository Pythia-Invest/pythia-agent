import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HermesApiError } from "@/server/hermes";
import { createWidgetRoutes } from "@/server/widget-routes";

const content = "export const label = 'café';";
const bytes = Buffer.byteLength(content);
const sha256 = createHash("sha256").update(content).digest("hex");
const asset = {
  schema_version: 1,
  data: {
    asset: "tile",
    media_type: "text/javascript",
    sha256,
    content,
    bytes,
  },
};
const context = {
  params: Promise.resolve({ plugin: "example", asset: "tile" }),
};
function request(headers: HeadersInit = {}) {
  return new Request(
    `http://localhost:43123/api/plugins/example/widgets/tile?revision=${sha256}`,
    {
      headers: {
        host: "localhost:43123",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
    },
  );
}

describe("native widget asset admission", () => {
  it("rejects an untrusted origin before reading native presentation state", async () => {
    const read = vi.fn().mockResolvedValue(asset);
    const routes = createWidgetRoutes(read);
    expect(
      (
        await routes.widgetAsset(
          request({ origin: "https://other.test" }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });

  it("rechecks native ownership on every read, including a conditional cached request", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(asset)
      .mockRejectedValueOnce(
        new HermesApiError("The native plugin is disabled.", 403),
      );
    const routes = createWidgetRoutes(read);
    const first = await routes.widgetAsset(request(), context);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(await first.text()).toBe(content);
    const denied = await routes.widgetAsset(
      request({ "if-none-match": `"${sha256}"` }),
      context,
    );
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain(content);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[0]?.slice(0, 2)).toEqual([
      "example",
      { asset: "tile" },
    ]);
  });

  it("rejects changed revisions and digest mismatches without serving executable content", async () => {
    const changed = createWidgetRoutes(async () => ({
      ...asset,
      data: {
        ...asset.data,
        content: "changed",
        bytes: Buffer.byteLength("changed"),
      },
    }));
    expect((await changed.widgetAsset(request(), context)).status).toBe(502);
    const routes = createWidgetRoutes(async () => asset);
    const stale = new Request(request().url.replace(sha256, "0".repeat(64)), {
      headers: request().headers,
    });
    expect((await routes.widgetAsset(stale, context)).status).toBe(409);
  });

  it("publishes only validated descriptors and revision-pinned admitted URLs", async () => {
    const read = vi.fn().mockResolvedValue({
      schema_version: 1,
      data: {
        version: 1,
        widgets: [
          { id: "overview", asset: "tile", input_contract: "example.read.v1" },
        ],
        assets: [
          {
            id: "tile",
            media_type: "text/javascript",
            sha256,
            bytes,
            path: "/private",
          },
        ],
      },
    });
    const routes = createWidgetRoutes(read);
    const response = await routes.widgetPresentations(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: 1,
      widgets: [
        { id: "overview", asset: "tile", input_contract: "example.read.v1" },
      ],
      assets: [
        {
          id: "tile",
          sha256,
          bytes,
          moduleUrl: `/api/plugins/example/widgets/tile?revision=${sha256}`,
        },
      ],
    });
    expect(read.mock.calls[0]?.slice(0, 2)).toEqual(["example", {}]);
  });

  it("rejects a declared asset size that differs from its UTF-8 content bytes", async () => {
    const routes = createWidgetRoutes(async () => ({
      ...asset,
      data: { ...asset.data, bytes: content.length },
    }));
    expect((await routes.widgetAsset(request(), context)).status).toBe(502);
  });

  it.each([undefined, 0, 1.5, 1_048_577])(
    "rejects missing or out-of-budget descriptor byte sizes (%s)",
    async (bytes) => {
      const routes = createWidgetRoutes(async () => ({
        schema_version: 1,
        data: {
          version: 1,
          widgets: [
            {
              id: "overview",
              asset: "tile",
              input_contract: "example.read.v1",
            },
          ],
          assets: [
            { id: "tile", media_type: "text/javascript", sha256, bytes },
          ],
        },
      }));
      expect(
        (await routes.widgetPresentations(request(), context)).status,
      ).toBe(502);
    },
  );
});
