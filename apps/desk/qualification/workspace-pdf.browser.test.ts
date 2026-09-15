import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import {
  NodeNextRequest,
  NodeNextResponse,
} from "next/dist/server/base-http/node";
import { buildCustomRoute } from "next/dist/server/lib/router-utils/filesystem";
import { sendResponse } from "next/dist/server/send-response";
import nextConfig from "../next.config.mjs";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { chromium, type Browser } from "@playwright/test";
import { expect, it } from "vitest";
import { createWorkspaceStore } from "@/server/workspace/store";

/** A valid one-page PDF with a large distinctive red rectangle and white text.
 * Rendering, not the presence of a PDF prefix or authored HTML, is the oracle. */
function syntheticPdf() {
  const drawing =
    "1 0 0 rg 30 30 260 340 re f 1 1 1 rg BT /F1 20 Tf 40 200 Td (PYTHIA PDF PROBE) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}endstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

/** Decode Chromium's PNG screenshot using the documented PNG filter rules.
 * Count only the distinctive PDF ink, not chrome, PDF DOM or fixture text. */
function redPixels(png: Buffer) {
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0;
  const chunks: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const kind = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (kind === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0)
        throw new Error("Unsupported screenshot PNG encoding");
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (!channels) throw new Error("Unsupported screenshot PNG color type");
    }
    if (kind === "IDAT") chunks.push(data);
    offset += length + 12;
  }
  const data = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  let previous = Buffer.alloc(stride),
    cursor = 0,
    red = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = data[cursor++];
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? (row[x - channels] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const corner = x >= channels ? (previous[x - channels] ?? 0) : 0;
      const prediction = left + up - corner;
      const pa = Math.abs(prediction - left),
        pb = Math.abs(prediction - up),
        pc = Math.abs(prediction - corner);
      const delta =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : filter === 4
                  ? pa <= pb && pa <= pc
                    ? left
                    : pb <= pc
                      ? up
                      : corner
                  : NaN;
      if (!Number.isFinite(delta)) throw new Error("Unsupported PNG filter");
      row[x] = ((data[cursor++] ?? 0) + delta) & 255;
    }
    for (let x = 0; x < stride; x += channels)
      if (
        (row[x] ?? 0) > 220 &&
        (row[x + 1] ?? 255) < 50 &&
        (row[x + 2] ?? 255) < 50
      )
        red += 1;
    previous = row;
  }
  return red;
}

async function composedHeaders(
  source: Headers,
  path = "/api/workspace/content",
) {
  const socket = new Socket(); // Unconnected stream only; no bind/listen/connect.
  const request = new IncomingMessage(socket);
  request.method = "HEAD";
  request.url = path;
  const response = new ServerResponse(request);
  // Use the installed native route matcher and header sender. Global routing
  // headers are seeded first, exactly as router-server does before app-route.
  const headerRules = nextConfig.headers;
  if (!headerRules) throw new Error("Desk routing headers are unavailable.");
  for (const rule of await headerRules()) {
    if (!buildCustomRoute("header", rule, "", false).match(path)) continue;
    for (const header of rule.headers)
      response.setHeader(header.key, header.value);
  }
  try {
    await sendResponse(
      new NodeNextRequest(request),
      new NodeNextResponse(response),
      new Response(null, { headers: source }),
    );
    return Object.fromEntries(
      Object.entries(response.getHeaders()).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
  } finally {
    socket.destroy();
  }
}

it("qualifies actual Chromium PDF rendering under workspace response headers without a listener", async () => {
  const executablePath = chromium.executablePath();
  if (!existsSync(executablePath))
    throw new Error(
      "Installed Playwright Chromium is unavailable; install requires a separate decision.",
    );
  const temporary = await mkdtemp(join(tmpdir(), "pythia-pdf-probe-"));
  const output = process.env.PYTHIA_PDF_PROBE_OUTPUT;
  const reports: unknown[] = [];
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      env: {
        HOME: temporary,
        TMPDIR: temporary,
        PATH: process.env.PATH ?? "/usr/bin:/bin",
      },
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--no-first-run",
      ],
    });
    await writeFile(join(temporary, "probe.pdf"), syntheticPdf());
    const store = createWorkspaceStore(() => temporary);
    const entry = await store.entry("probe.pdf");
    for (const path of [
      "/",
      "/workspace",
      "/api/workspace/entry",
      "/api/workspace/content/",
      "/api/workspace/content/child",
      "/api/workspace/content-other",
    ]) {
      const pageHeaders = await composedHeaders(new Headers(), path);
      expect(pageHeaders["x-frame-options"]).toBe("DENY");
      expect(pageHeaders["content-security-policy"]).toContain(
        "frame-ancestors 'none'",
      );
    }
    for (const width of [900, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 720 },
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const messages: string[] = [];
      let internalResources = 0;
      const requests: {
        url: string;
        range: string | undefined;
        status?: number;
      }[] = [];
      page.on("console", (message) => messages.push(message.text()));
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === "http://workspace.invalid" && url.pathname === "/")
          return route.fulfill({
            contentType: "text/html",
            body: `<html><head><title>Synthetic PDF contract probe</title></head><body style="margin:0;background:white"><iframe title="PDF: probe.pdf" referrerpolicy="no-referrer" style="width:100%;height:700px;border:0" src="/api/workspace/content?path=probe.pdf&revision=${encodeURIComponent(entry.revision)}"></iframe></body></html>`,
          });
        if (
          url.origin === "http://workspace.invalid" &&
          url.pathname === "/api/workspace/content"
        ) {
          const request = new Request(url, {
            headers: route.request().headers(),
          });
          const response = await store.response("probe.pdf", request);
          const headers = await composedHeaders(response.headers);
          requests.push({
            url: url.href,
            range: route.request().headers().range,
            status: response.status,
          });
          return route.fulfill({
            status: response.status,
            headers,
            body: Buffer.from(await response.arrayBuffer()),
          });
        }
        if (
          (url.protocol === "chrome-extension:" &&
            url.hostname === "mhjfbmdgcfjbbpaeojofohoefgiehjai") ||
          (url.protocol === "chrome:" && url.hostname === "resources")
        ) {
          internalResources += 1;
          return route.continue(); // Installed native PDF viewer resources, never external network.
        }
        requests.push({
          url: url.href,
          range: route.request().headers().range,
        });
        return route.abort();
      });
      await page.goto("http://workspace.invalid/");
      let red = 0;
      let screenshot: Buffer = Buffer.alloc(0);
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        screenshot = await page.screenshot();
        red = redPixels(screenshot);
        if (red > 10000) break;
        await page.waitForTimeout(200);
      }
      const report = {
        headers: await composedHeaders(
          (
            await store.response(
              "probe.pdf",
              new Request(
                "http://workspace.invalid/api/workspace/content?path=probe.pdf",
                { method: "HEAD" },
              ),
            )
          ).headers,
        ),
        browserVersion: browser.version(),

        width,
        redPixels: red,
        internalResources,
        frames: page.frames().map((frame) => frame.url()),
        requests,
        messages,
      };
      reports.push(report);
      console.info(JSON.stringify(report));
      expect(red).toBeGreaterThan(10000);
      expect(report.headers["content-security-policy"]).toBe(
        "default-src 'none'; sandbox; frame-ancestors 'self'",
      );
      expect(report.headers["x-frame-options"]).toBe("SAMEORIGIN");
      if (output) {
        await mkdir(output, { recursive: true });
        await writeFile(join(output, `pdf-composed-${width}.png`), screenshot);
      }
      await context.close();
      if (output)
        await writeFile(
          join(output, "observations.json"),
          JSON.stringify(reports, null, 2),
        );
    }
    if (output)
      await writeFile(
        join(output, "observations.json"),
        JSON.stringify(reports, null, 2),
      );
  } finally {
    await browser?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
