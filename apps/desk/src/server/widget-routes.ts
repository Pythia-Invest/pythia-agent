import { createHash } from "node:crypto";
import { admitBrowserRequest } from "./admission";
import { profileFrom } from "./device-settings-native";
import { createHermesRequest, HermesApiError } from "./hermes";
import { result, routeError } from "./route-utils";
import { MAX_WIDGET_ARTIFACT_BYTES } from "@pythia/widget-sdk/runtime";

const pluginPattern = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/u;
const assetPattern = /^[a-z][a-z0-9_-]{0,63}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const moduleLimit = MAX_WIDGET_ARTIFACT_BYTES;
type RouteContext = { params: Promise<Record<string, string>> };
type WidgetRead = (
  plugin: string,
  args: { asset?: string },
  signal: AbortSignal,
) => Promise<unknown>;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function invalidNative() {
  return new HermesApiError("The plugin returned invalid widget assets.", 502);
}

function nativeData(value: unknown) {
  const body = record(value);
  if (body.schema_version !== 1) throw invalidNative();
  return record(body.data);
}

/** The same protected loopback transport as chat; only the widgets operation. */
export function createWidgetReader(): WidgetRead {
  const request = createHermesRequest();
  return async (plugin, args, signal) => {
    const response = await request(
      `/p/${encodeURIComponent(profileFrom(process.env))}/v1/pythia/plugins/${encodeURIComponent(plugin)}/widgets`,
      {
        method: "POST",
        body: JSON.stringify({ arguments: args, read_only: true }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
      },
    );
    const reader = response.body?.getReader();
    if (!reader) throw invalidNative();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        // JSON escaping can expand the admitted UTF-8 module.
        if (length > moduleLimit * 6 + 65_536) throw invalidNative();
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw invalidNative();
    }
  };
}

/** Read current native presentation authority; safe for admitted server consumers. */
export async function readWidgetPresentation(
  plugin: string,
  signal: AbortSignal,
  read: WidgetRead = createWidgetReader(),
) {
  if (plugin.length > 129 || !pluginPattern.test(plugin)) {
    throw new HermesApiError("A valid plugin identifier is required.", 400);
  }
  const body = nativeData(await read(plugin, {}, signal));
  if (
    body.version !== 1 ||
    !Array.isArray(body.widgets) ||
    !Array.isArray(body.assets) ||
    body.widgets.length > 32 ||
    body.assets.length > 32
  ) {
    throw invalidNative();
  }
  const assets = body.assets.map((value) => {
    const asset = record(value);
    if (
      typeof asset.id !== "string" ||
      !assetPattern.test(asset.id) ||
      typeof asset.sha256 !== "string" ||
      !digestPattern.test(asset.sha256) ||
      typeof asset.bytes !== "number" ||
      !Number.isInteger(asset.bytes) ||
      asset.bytes < 1 ||
      asset.bytes > moduleLimit ||
      asset.media_type !== "text/javascript"
    ) {
      throw invalidNative();
    }
    return {
      id: asset.id,
      sha256: asset.sha256,
      bytes: asset.bytes,
      moduleUrl: `/api/plugins/${encodeURIComponent(plugin)}/widgets/${asset.id}?revision=${asset.sha256}`,
    };
  });
  const assetIds = new Set(assets.map((asset) => asset.id));
  if (assetIds.size !== assets.length) throw invalidNative();
  const widgets = body.widgets.map((value) => {
    const widget = record(value);
    if (
      typeof widget.id !== "string" ||
      !assetPattern.test(widget.id) ||
      typeof widget.asset !== "string" ||
      !assetIds.has(widget.asset) ||
      typeof widget.input_contract !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(widget.input_contract)
    ) {
      throw invalidNative();
    }
    return {
      id: widget.id,
      asset: widget.asset,
      input_contract: widget.input_contract,
    };
  });
  if (new Set(widgets.map((widget) => widget.id)).size !== widgets.length) {
    throw invalidNative();
  }
  return { version: 1 as const, widgets, assets };
}

export function createWidgetRoutes(read: WidgetRead = createWidgetReader()) {
  return {
    async widgetPresentations(request: Request, context: RouteContext) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        const plugin = (await context.params).plugin ?? "";
        return result(
          await readWidgetPresentation(plugin, request.signal, read),
        );
      } catch (error) {
        return routeError(error);
      }
    },
    async widgetAsset(request: Request, context: RouteContext) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        const { plugin = "", asset = "" } = await context.params;
        const revision =
          new URL(request.url).searchParams.get("revision") ?? "";
        if (
          plugin.length > 129 ||
          !pluginPattern.test(plugin) ||
          !assetPattern.test(asset) ||
          !digestPattern.test(revision)
        ) {
          throw new HermesApiError("A valid widget asset is required.", 400);
        }
        // Do this even for If-None-Match: native enablement owns every read.
        const body = nativeData(await read(plugin, { asset }, request.signal));
        if (
          body.asset !== asset ||
          body.media_type !== "text/javascript" ||
          typeof body.content !== "string" ||
          typeof body.bytes !== "number" ||
          !Number.isInteger(body.bytes) ||
          body.bytes < 1 ||
          body.bytes > moduleLimit ||
          Buffer.byteLength(body.content) !== body.bytes ||
          typeof body.sha256 !== "string" ||
          !digestPattern.test(body.sha256) ||
          createHash("sha256").update(body.content).digest("hex") !==
            body.sha256
        ) {
          throw invalidNative();
        }
        if (revision !== body.sha256) {
          throw new HermesApiError(
            "This widget changed. Refresh its presentation before loading it.",
            409,
          );
        }
        return new Response(body.content, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
          },
        });
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
