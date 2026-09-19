import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

/** Disposable synthetic native authority using the real profile-scoped wire paths. */
export async function createNativeDataFixture(contents, examplesPath) {
  const examples = JSON.parse(await readFile(examplesPath, "utf8"));
  const sample = examples.find(
    (item) => item.name === "latest_unknown_time",
  ).value;
  const assets = Object.entries(contents).map(([id, content]) => ({
    id,
    content,
    bytes: Buffer.byteLength(content),
    media_type: "text/javascript",
    sha256: createHash("sha256").update(content).digest("hex"),
  }));
  const streams = new Map();
  const counters = {
    connections: 0,
    maxResources: 0,
    slowReads: 0,
    cancelledReads: 0,
    cancelledQuoteReads: 0,
    cancelledPeerReads: 0,
    reads: 0,
    assetReads: 0,
  };
  let revision = 1,
    price = "123.45",
    label = "Research revision 1";
  let researchEnabled = true,
    enabled = true,
    hold = false;
  const errors = [];
  const pendingQuotes = new Set();
  const peerReads = [],
    pendingPeers = new Set();
  let peerStale = false,
    peerDenied = false;
  let holdQuotes = false;
  let summaryPublished = false,
    quotePublished = false;
  let quoteDenied = false;
  let financialStale = false,
    readDenied = false,
    manualPrice = "345.67";
  function financial(reads, selectedPrice = price) {
    return {
      schema_version: 1,
      outcome: "ok",
      data: reads.map((read) => {
        const result = structuredClone(sample);
        result.request = read.request;
        result.selection.view = read.request.view;
        result.observations[0].value = selectedPrice;
        if (read.request.operation === "history") {
          result.observations = [0, 1].map((index) => ({
            ...result.observations[0],
            time: { kind: "instant", value: `2026-01-06T1${index}:00:00Z` },
            value: String(100 + index * 10),
          }));
          result.returned_window = {
            start: result.observations[0].time,
            end: result.observations[1].time,
          };
        }
        result.retrieved_at = new Date().toISOString();
        return result;
      }),
      delivery: {
        max_age_seconds: reads.map(() => 60),
        reuse_scope: "a".repeat(64),
      },
    };
  }
  function publish(response, resources) {
    if (hold) return;
    for (const [index, resource] of resources.entries()) {
      if (resource.operation === "summary") summaryPublished = true;
      const isFinancial = resource.plugin === "pythia-market-data";
      const isPeer = resource.operation === "peer";
      const stale = (isFinancial && financialStale) || (isPeer && peerStale);
      if (
        isFinancial &&
        resource.arguments.reads?.[0]?.request.operation === "latest"
      )
        quotePublished = true;
      const denied =
        !enabled ||
        (isPeer && peerDenied) ||
        (isFinancial &&
          (readDenied ||
            (quoteDenied &&
              resource.arguments.reads?.[0]?.request.operation ===
                "latest"))) ||
        (resource.plugin === "synthetic-research" && !researchEnabled);
      const value = {
        schema_version: 1,
        index,
        generation: "synthetic-generation",
        revision,
        type: denied ? "reset" : stale ? "status" : "snapshot",
        state: denied ? "unavailable" : stale ? "stale" : "ready",
        ...(denied
          ? { code: "access_denied" }
          : {
              data:
                resource.plugin === "pythia-market-data"
                  ? financial(resource.arguments.reads)
                  : {
                      schema_version: 1,
                      data: {
                        label: isPeer
                          ? "Peer 321"
                          : resource.operation === "detail"
                            ? label.replace("Research", "Detail")
                            : label,
                      },
                    },
            }),
      };
      response.write(`data: ${JSON.stringify(value)}\n\n`);
    }
  }
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(
        request.headers.authorization,
        "Bearer synthetic-data-qualification-key",
      );
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (request.url === "/p/synthetic/v1/pythia/updates") {
        assert.ok(body.resources.length > 0 && body.resources.length <= 64);
        assert.equal(
          new Set(body.resources.map((item) => JSON.stringify(item))).size,
          body.resources.length,
        );
        for (const item of body.resources)
          assert.ok(
            ["pythia-market-data", "synthetic-research"].includes(item.plugin),
          );
        if (body.resources.some((resource) => resource.operation === "detail"))
          assert.equal(summaryPublished, true);
        if (
          body.resources.some(
            (resource) =>
              resource.arguments.reads?.[0]?.request.operation === "history",
          )
        )
          assert.equal(quotePublished, true);
        counters.connections++;
        counters.maxResources = Math.max(
          counters.maxResources,
          body.resources.length,
        );
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.flushHeaders();
        streams.set(response, body.resources);
        response.once("close", () => streams.delete(response));
        publish(response, body.resources);
        return;
      }
      assert.equal(body.read_only, true);
      response.setHeader("content-type", "application/json");
      if (request.url === "/p/synthetic/v1/pythia/plugins/synthetic/widgets") {
        if (!enabled)
          return response
            .writeHead(403)
            .end(JSON.stringify({ error: { message: "Disabled" } }));
        if (body.arguments.asset) {
          counters.assetReads++;
          const selected = assets.find(
            (asset) => asset.id === body.arguments.asset,
          );
          assert.ok(selected);
          const { id: asset, ...metadata } = selected;
          return response.end(
            JSON.stringify({ schema_version: 1, data: { asset, ...metadata } }),
          );
        }
        return response.end(
          JSON.stringify({
            schema_version: 1,
            data: {
              version: 1,
              widgets: assets.map(({ id }) => ({
                id,
                asset: id,
                input_contract: "synthetic.read.v1",
              })),
              assets: assets.map(({ content: _, ...metadata }) => metadata),
            },
          }),
        );
      }
      if (
        request.url ===
        "/p/synthetic/v1/pythia/plugins/pythia-market-data/query"
      ) {
        counters.reads++;
        if (readDenied)
          return response.writeHead(403).end(
            JSON.stringify({
              error: { code: "access_denied", message: "Read denied" },
            }),
          );
        if (
          holdQuotes &&
          body.arguments.reads?.[0]?.request.operation === "latest"
        ) {
          pendingQuotes.add(response);
          response.once("close", () => {
            pendingQuotes.delete(response);
            if (!response.writableFinished) counters.cancelledQuoteReads++;
          });
          return;
        }
        return response.end(
          JSON.stringify(
            body.arguments.action === "get_preferences"
              ? { schema_version: 1, outcome: "ok", data: { revision: 7 } }
              : financial(body.arguments.reads, manualPrice),
          ),
        );
      }
      if (
        request.url === "/p/synthetic/v1/pythia/plugins/synthetic-research/peer"
      ) {
        peerReads.push(response);
        pendingPeers.add(response);
        response.once("close", () => {
          pendingPeers.delete(response);
          if (!response.writableFinished) counters.cancelledPeerReads++;
        });
        return;
      }
      assert.equal(
        request.url,
        "/p/synthetic/v1/pythia/plugins/synthetic-research/slow",
      );
      counters.slowReads++;
      response.once("close", () => counters.cancelledReads++);
    } catch (error) {
      errors.push(String(error));
      response
        .writeHead(500)
        .end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  return {
    server,
    streams,
    pendingQuotes,
    peerReads,
    pendingPeers,
    counters,
    errors,
    stalePeers() {
      peerStale = true;
      revision++;
      for (const entry of streams) publish(...entry);
    },
    denyFirstPeer() {
      assert.equal(peerReads.length, 2);
      peerDenied = true;
      peerReads[0].writeHead(403).end(
        JSON.stringify({
          error: { code: "access_denied", message: "Peer read denied" },
        }),
      );
    },
    releaseLatePeer() {
      peerReads[1].end(
        JSON.stringify({ schema_version: 1, data: { label: "Peer 999" } }),
      );
    },
    update() {
      revision++;
      price = "234.56";
      label = "Research revision 2";
      for (const entry of streams) publish(...entry);
    },
    holdQuoteReads() {
      holdQuotes = true;
    },
    releaseQuoteReads() {
      holdQuotes = false;
      for (const response of pendingQuotes)
        response.end(
          JSON.stringify({ schema_version: 1, data: { price: 999 } }),
        );
    },
    setQuoteDenied(value) {
      quoteDenied = value;
      revision++;
      for (const entry of streams) publish(...entry);
    },
    staleFinancial() {
      financialStale = true;
      revision++;
      for (const entry of streams) publish(...entry);
    },
    denyReads() {
      readDenied = true;
    },
    denyResearch() {
      researchEnabled = false;
      revision++;
      for (const entry of streams) publish(...entry);
    },
    disable() {
      enabled = false;
      revision++;
      for (const entry of streams) publish(...entry);
    },
    hold(value) {
      hold = value;
    },
    release() {
      hold = false;
      revision++;
      for (const entry of streams) publish(...entry);
    },
  };
}
