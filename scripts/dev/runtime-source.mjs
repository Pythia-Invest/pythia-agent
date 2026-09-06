import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { atomicWriteJson, readJson } from "./files.mjs";

export function assertHermesRuntimePath(paths, platform = process.platform) {
  if (platform !== "darwin" && platform !== "linux") return;
  const limit = platform === "darwin" ? 103 : 107;
  const witness = join(
    paths.profileRoot,
    "state",
    "gateway.loop-tick.9999999999.sock",
  );
  const bytes = Buffer.byteLength(witness);
  if (bytes > limit) {
    throw new Error(
      `Hermes profile path is too long for its required ${platform} loop-liveness socket (${bytes} bytes; maximum ${limit}): ${paths.profileRoot}. Choose a shorter XDG_CONFIG_HOME or PYTHIA_DEV_CONFIG_HOME.`,
    );
  }
}

export function developmentPrivateRoots(paths) {
  return [
    paths.configRoot,
    paths.hermesRoot,
    paths.stateRoot,
    paths.processRoot,
    paths.dataRoot,
    paths.workspace,
    paths.knowledge,
    paths.cacheRoot,
    paths.fetchCache,
    paths.basicMemoryConfig,
    paths.basicMemoryCache,
    paths.edgarData,
    paths.edgarCache,
    paths.testRoot,
  ];
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: options.interactive ? "inherit" : ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 300_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.status}${detail ? `:\n${detail}` : ""}`,
    );
  }
  return String(result.stdout ?? "").trim();
}

function exactVersion(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

export function validateToolchain(repositoryRoot) {
  const versions = readJson(join(repositoryRoot, "tooling", "toolchain.json"));
  const actual = {
    node: exactVersion("node", ["--version"]).replace(/^v/u, ""),
    pnpm: exactVersion("pnpm", ["--version"]),
    uv: exactVersion("uv", ["--version"]).split(/\s+/u)[1],
  };
  for (const name of Object.keys(actual)) {
    if (actual[name] !== versions[name]) {
      throw new Error(
        `${name} ${versions[name]} is required; found ${actual[name]}. See docs/development.md.`,
      );
    }
  }
  return actual;
}

async function downloadVerified(url, expectedSha256, destination) {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  if (existsSync(destination)) {
    const current = createHash("sha256")
      .update(readFileSync(destination))
      .digest("hex");
    if (current === expectedSha256) return;
    throw new Error(
      `Cached Hermes archive hash mismatch at ${destination}; remove this exact file and retry.`,
    );
  }
  const temporary = `${destination}.${process.pid}.partial`;
  rmSync(temporary, { force: true });
  const response = await fetch(url, {
    headers: { "user-agent": "pythia-agent-development-bootstrap" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Hermes archive download failed with HTTP ${response.status}.`,
    );
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 150 * 1024 * 1024) {
    throw new Error("Hermes archive exceeds the 150 MiB bootstrap limit.");
  }
  const hash = createHash("sha256");
  let bytes = 0;
  const source = Readable.fromWeb(response.body).map((chunk) => {
    bytes += chunk.length;
    if (bytes > 150 * 1024 * 1024) {
      throw new Error("Hermes archive exceeds the 150 MiB bootstrap limit.");
    }
    hash.update(chunk);
    return chunk;
  });
  try {
    await pipeline(source, createWriteStream(temporary, { mode: 0o600 }));
    const actual = hash.digest("hex");
    if (actual !== expectedSha256) {
      throw new Error(
        `Hermes archive hash mismatch: expected ${expectedSha256}, got ${actual}.`,
      );
    }
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const HERMES_SOURCE_DERIVED_NAMES = new Set([
  ".pythia-source.json",
  ".venv",
  "__pycache__",
]);

function hermesSourceDigest(root) {
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Hermes source must be a real directory: ${root}`);
  }
  const hash = createHash("sha256");
  function walk(current, relative = "") {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (
        HERMES_SOURCE_DERIVED_NAMES.has(entry.name) ||
        (relative === "" && entry.name === "hermes_agent.egg-info") ||
        entry.name.endsWith(".pyc")
      ) {
        continue;
      }
      const child = join(current, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const childInfo = lstatSync(child);
      if (childInfo.isSymbolicLink()) {
        throw new Error(
          `Hermes source contains an unsupported symbolic link: ${child}`,
        );
      }
      if (childInfo.isDirectory()) {
        hash.update(`directory\0${childRelative}\0${childInfo.mode & 0o777}\n`);
        walk(child, childRelative);
      } else if (childInfo.isFile()) {
        hash.update(`file\0${childRelative}\0${childInfo.mode & 0o777}\0`);
        hash.update(readFileSync(child));
        hash.update("\n");
      } else {
        throw new Error(
          `Hermes source contains an unsupported entry: ${child}`,
        );
      }
    }
  }
  walk(root);
  return hash.digest("hex");
}

function validateExtractedHermesSource(source) {
  for (const required of ["uv.lock", "pyproject.toml"]) {
    if (!existsSync(join(source, required))) {
      throw new Error(`Verified Hermes archive lacks ${required}.`);
    }
  }
  return hermesSourceDigest(source);
}

export async function ensureHermesSource(paths, sourceContract) {
  const archive = join(
    paths.fetchCache,
    `hermes-${sourceContract.commit}.tar.gz`,
  );
  await downloadVerified(
    sourceContract.archive_url,
    sourceContract.archive_sha256,
    archive,
  );
  if (existsSync(paths.hermesSource)) {
    const current = lstatSync(paths.hermesSource);
    if (!current.isDirectory() || current.isSymbolicLink()) {
      throw new Error(
        `Hermes source cache must be a real directory: ${paths.hermesSource}`,
      );
    }
  }

  const parent = dirname(paths.hermesSource);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(parent, ".pythia-hermes-source-"));
  const candidate = join(stage, "source");
  const previous = join(stage, "previous");
  mkdirSync(candidate, { recursive: true, mode: 0o700 });
  try {
    run("tar", ["-xzf", archive, "--strip-components=1", "-C", candidate]);
    const expectedDigest = validateExtractedHermesSource(candidate);
    let currentDigest = null;
    if (existsSync(paths.hermesSource)) {
      try {
        currentDigest = hermesSourceDigest(paths.hermesSource);
      } catch {
        currentDigest = null;
      }
    }
    if (currentDigest !== expectedDigest) {
      if (existsSync(paths.hermesSource)) {
        renameSync(paths.hermesSource, previous);
      }
      try {
        renameSync(candidate, paths.hermesSource);
      } catch (error) {
        if (existsSync(previous)) renameSync(previous, paths.hermesSource);
        throw error;
      }
    }
    atomicWriteJson(join(paths.hermesSource, ".pythia-source.json"), {
      schema_version: 1,
      release: sourceContract.release,
      commit: sourceContract.commit,
      archive_sha256: sourceContract.archive_sha256,
      source_tree_sha256: expectedDigest,
    });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
