import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceManifest } from "./source-snapshot.mjs";

const ignoredRuntimeProducts = [
  ".claude/",
  ".codex/",
  ".cursor/",
  ".local/",
  ".next/",
  ".private/",
  ".turbo/",
  "node_modules/",
  "dist/",
  "coverage/",
];
const reviewedBinaryExtensions = new Set([".ico", ".png", ".woff2"]);
const personalName = ["ra", "lph"].join("");
const privateRepository = ["pythia", "-invest"].join("");
const privatePatterns = [
  new RegExp(`/Users/${personalName}(?:/|\\b)`, "u"),
  new RegExp(`/home/${personalName}(?:/|\\b)`, "u"),
  new RegExp(`${privateRepository}/(?:plans|docs/experiments)`, "u"),
  /plans\/main\/grilling/u,
  /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/u,
  /\bgh[opsu]_[A-Za-z0-9]{30,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
];

export function checkPublicSource(repository) {
  const root = resolve(repository);
  const manifest = sourceManifest(root);
  const violations = [];

  for (const item of manifest.entries) {
    if (ignoredRuntimeProducts.some((prefix) => item.path.startsWith(prefix))) {
      violations.push(
        `${item.path}: ignored, private, or generated path entered source`,
      );
    }
    if (item.path.endsWith(".map")) {
      violations.push(`${item.path}: source maps are not public source inputs`);
    }
    if (item.size > 2 * 1024 * 1024) {
      violations.push(
        `${item.path}: source file exceeds the bounded scan limit`,
      );
    }
    const bytes = readFileSync(join(root, item.path));
    const extension = extname(item.path);
    const binary = bytes.includes(0);
    if (binary && !reviewedBinaryExtensions.has(extension)) {
      violations.push(
        `${item.path}: unreviewed binary source type ${extension || "<none>"}`,
      );
    }
    if (!binary && reviewedBinaryExtensions.has(extension)) {
      violations.push(`${item.path}: reviewed binary extension contains text`);
    }
    const content = bytes.toString("latin1");
    for (const pattern of privatePatterns) {
      if (pattern.test(content)) {
        violations.push(
          `${item.path}: matches private/secret pattern ${pattern}`,
        );
      }
    }
  }

  const versions = JSON.parse(
    readFileSync(join(root, "runtime/versions.json"), "utf8"),
  );
  const expectedLicenses = {
    hermes_agent: "MIT",
    basic_memory: "AGPL-3.0-or-later",
    edgartools: "MIT",
    eodhd: "MIT",
  };
  if (
    Object.keys(versions.dependencies ?? {})
      .sort()
      .join("\0") !== Object.keys(expectedLicenses).sort().join("\0")
  ) {
    violations.push(
      "runtime/versions.json: dependency provenance set is not the reviewed four-package boundary",
    );
  }
  for (const [name, license] of Object.entries(expectedLicenses)) {
    const dependency = versions.dependencies?.[name];
    if (
      dependency?.license !== license ||
      typeof dependency?.license_url !== "string" ||
      !dependency.license_url.startsWith("https://") ||
      !Array.isArray(dependency.artifacts) ||
      dependency.artifacts.length === 0 ||
      dependency.artifacts.some(
        (artifact) =>
          !/^https:\/\//u.test(artifact.url ?? "") ||
          !/^[0-9a-f]{64}$/u.test(artifact.sha256 ?? ""),
      )
    ) {
      violations.push(
        `runtime/versions.json: incomplete provenance for ${name}`,
      );
    }
  }

  const projectLicense = readFileSync(join(root, "LICENSE"), "utf8");
  if (
    !projectLicense.includes("Apache License") ||
    !projectLicense.includes("Version 2.0")
  ) {
    violations.push("LICENSE: expected the complete Apache-2.0 license text");
  }
  const managedNotice = readFileSync(
    join(root, "runtime/managed/python/NOTICE.md"),
    "utf8",
  );
  for (const required of [
    "Hermes Agent",
    "Basic Memory",
    "AGPL-3.0-or-later",
  ]) {
    if (!managedNotice.includes(required)) {
      violations.push(`runtime/managed/python/NOTICE.md: missing ${required}`);
    }
  }

  const fixtureGuide = readFileSync(
    join(root, "runtime/test/fixtures/README.md"),
    "utf8",
  );
  for (const required of [
    "authored examples, not recorded provider responses",
    "SDK 1.1.0",
    "EdgarTools 5.56.0",
    "deliberately fictional",
  ]) {
    if (!fixtureGuide.includes(required)) {
      violations.push(`runtime/test/fixtures/README.md: missing ${required}`);
    }
  }
  const marketFixture = JSON.parse(
    readFileSync(join(root, "runtime/test/fixtures/eodhd-daily.json"), "utf8"),
  );
  if (
    !Array.isArray(marketFixture) ||
    marketFixture.length === 0 ||
    marketFixture.length > 10 ||
    marketFixture.some((row) =>
      Object.keys(row).some(
        (key) =>
          ![
            "date",
            "open",
            "high",
            "low",
            "close",
            "adjusted_close",
            "volume",
          ].includes(key),
      ),
    )
  ) {
    violations.push(
      "runtime/test/fixtures/eodhd-daily.json: fixture is not bounded",
    );
  }

  if (violations.length > 0) {
    throw new Error(`Public source check failed:\n${violations.join("\n")}`);
  }
  return manifest;
}

const invoked =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const rootArg =
    process.argv[2] === "--root"
      ? process.argv[3]
      : resolve(import.meta.dirname, "..");
  if (!rootArg) throw new Error("Usage: check-public-source.mjs [--root PATH]");
  const manifest = checkPublicSource(rootArg);
  console.log(
    `Public source check passed (${manifest.entries.length} files, ${manifest.digest}).`,
  );
}
