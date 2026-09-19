import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";

/** Synthetic native authority, including one failed fetch before recovery. */
export function createNativeWidgetFixture(content, module) {
  let enabled = true;
  const assets = new Map();
  const assetReads = new Map();
  const incompatible = `export const metadata=${JSON.stringify({ ...module.metadata, runtimeVersion: 99 })};export const css="";export function createWidget(){globalThis.incompatibleWidgetRan=true;throw Error("should not run")}`;
  const recovery = `export const metadata=${JSON.stringify({ ...module.metadata, scope: "pyw-012345678901234567890124", imports: { react: ["createElement"] } })};export const css="";export function createWidget(host){globalThis.widgetRecoveryFactories=(globalThis.widgetRecoveryFactories??0)+1;return {Component:()=>host.react.createElement('p',null,'Recovered widget')}}`;
  for (const [id, source] of [
    ["probe", content],
    ["incompatible", incompatible],
    ["missing", recovery],
  ]) {
    assets.set(id, {
      asset: id,
      media_type: "text/javascript",
      sha256: createHash("sha256").update(source).digest("hex"),
      bytes: Buffer.byteLength(source),
      content: source,
    });
  }
  const server = createServer(async (request, response) => {
    try {
      assert.equal(
        request.url,
        "/p/synthetic/v1/pythia/plugins/synthetic/widgets",
      );
      assert.equal(
        request.headers.authorization,
        "Bearer synthetic-widget-qualification-key",
      );
      assert.equal(request.method, "POST");
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(body.read_only, true);
      response.setHeader("content-type", "application/json");
      if (!enabled) {
        response
          .writeHead(403)
          .end(
            JSON.stringify({ error: { message: "Synthetic plugin disabled" } }),
          );
        return;
      }
      if (body.arguments.asset) {
        const id = body.arguments.asset;
        assetReads.set(id, (assetReads.get(id) ?? 0) + 1);
        if (id === "missing" && assetReads.get(id) === 1) {
          response
            .writeHead(503)
            .end(
              JSON.stringify({ error: { message: "Synthetic asset missing" } }),
            );
        } else {
          response.end(
            JSON.stringify({ schema_version: 1, data: assets.get(id) }),
          );
        }
      } else {
        response.end(
          JSON.stringify({
            schema_version: 1,
            data: {
              version: 1,
              widgets: [
                {
                  id: "probe",
                  asset: "probe",
                  input_contract: "synthetic.read.v1",
                },
              ],
              assets: [...assets.values()].map(
                ({ asset: id, media_type, sha256, bytes }) => ({
                  id,
                  media_type,
                  sha256,
                  bytes,
                }),
              ),
            },
          }),
        );
      }
    } catch (error) {
      response
        .writeHead(500)
        .end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  return {
    server,
    assets,
    assetReads,
    setEnabled(value) {
      enabled = value;
    },
  };
}
