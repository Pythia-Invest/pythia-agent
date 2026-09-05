#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const port = Number(process.argv[2]);
const behavior = process.argv[3] ?? "serve";
if (behavior === "fail") {
  process.exit(23);
}

if (
  behavior === "spawn-delayed-descendant" ||
  behavior === "spawn-transient-descendant"
) {
  const transient = behavior === "spawn-transient-descendant";
  const [reclaimDelay, reclaimHold] = String(process.argv[4] ?? "100:300")
    .split(":")
    .map(Number);
  const descendant = spawn(
    process.execPath,
    [
      process.argv[1],
      String(port),
      transient ? "transient-descendant" : "delayed-descendant",
      String(process.pid),
      transient ? String(reclaimDelay) : (process.argv[4] ?? "300"),
      transient ? String(reclaimHold) : "0",
    ],
    { detached: true, stdio: "ignore" },
  );
  descendant.unref();
  const keepAlive = setInterval(() => {}, 1_000);
  const stop = () => {
    clearInterval(keepAlive);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else if (process.env.PYTHIA_TEST_GRANDCHILD_FILE) {
  const source = process.env.PYTHIA_TEST_GRANDCHILD_IGNORE_SIGTERM
    ? "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
    : "setInterval(() => {}, 1000)";
  const grandchild = spawn(process.execPath, ["-e", source]);
  writeFileSync(process.env.PYTHIA_TEST_GRANDCHILD_FILE, `${grandchild.pid}\n`);
}

if (
  behavior !== "spawn-delayed-descendant" &&
  behavior !== "spawn-transient-descendant"
) {
  const server = createServer((request, response) => {
    if (request.method === "POST") {
      request.resume();
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}');
  });

  server.listen(port, "127.0.0.1");
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  if (behavior === "die-second-after-health") {
    const counter = process.argv[4];
    const launches = existsSync(counter)
      ? Number(readFileSync(counter, "utf8")) + 1
      : 1;
    writeFileSync(counter, `${launches}\n`);
    if (launches >= 2) {
      setTimeout(() => process.exit(24), Number(process.argv[5] ?? "250"));
    }
  }

  if (behavior === "delayed-descendant") {
    const parentPid = Number(process.argv[4]);
    const delay = Number(process.argv[5] ?? "300");
    const parentWatch = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        clearInterval(parentWatch);
        setTimeout(stop, delay);
      }
    }, 20);
  }

  if (behavior === "transient-descendant") {
    const parentPid = Number(process.argv[4]);
    const reclaimDelay = Number(process.argv[5] ?? "100");
    const reclaimHold = Number(process.argv[6] ?? "300");
    const parentWatch = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        clearInterval(parentWatch);
        server.close(() => {
          setTimeout(() => {
            server.listen(port, "127.0.0.1", () => {
              setTimeout(stop, reclaimHold);
            });
          }, reclaimDelay);
        });
      }
    }, 20);
  }
}
