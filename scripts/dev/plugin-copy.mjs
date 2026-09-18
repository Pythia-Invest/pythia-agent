import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  opendirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import legacyCopies from "./plugin-copy-legacy.json" with { type: "json" };

export const PLUGIN_COPY_RECEIPT = ".pythia-managed-copy.json";
const MAX_FILES = 512;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 256 * 1024;

function info(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function relativeFile(path) {
  return (
    typeof path === "string" &&
    path.length <= 240 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").length <= 8 &&
    path.split("/").every((part) => part && part !== "." && part !== "..") &&
    path !== PLUGIN_COPY_RECEIPT
  );
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function payload(source, files) {
  const root = lstatSync(source);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new Error(
      `Managed plugin source must be a real directory: ${source}`,
    );
  if (
    !Array.isArray(files) ||
    !files.length ||
    files.length > MAX_FILES ||
    new Set(files).size !== files.length ||
    !files.every(relativeFile)
  )
    throw new Error(
      "Managed plugin requires a bounded relative file allowlist.",
    );
  let bytes = 0;
  return Object.fromEntries(
    files.map((name) => {
      let current = source;
      const parts = name.split("/");
      for (const [index, part] of parts.entries()) {
        current = join(current, part);
        const entry = lstatSync(current);
        const file = index === parts.length - 1;
        if (
          entry.isSymbolicLink() ||
          !(file ? entry.isFile() : entry.isDirectory())
        )
          throw new Error(
            `Managed plugin input must be a regular file with real parent directories: ${current}`,
          );
        if (file && entry.size > MAX_FILE_BYTES)
          throw new Error(
            `Managed plugin input exceeds ${MAX_FILE_BYTES} bytes: ${current}`,
          );
      }
      const content = readFileSync(current);
      bytes += content.length;
      if (bytes > MAX_PAYLOAD_BYTES)
        throw new Error(
          `Managed plugin payload exceeds ${MAX_PAYLOAD_BYTES} bytes.`,
        );
      return [name, content];
    }),
  );
}

export function assertManagedPluginSource(source, files) {
  payload(source, files);
}

function receipt(destination) {
  const path = join(destination, PLUGIN_COPY_RECEIPT);
  const entry = info(path);
  if (!entry) return undefined;
  if (
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    entry.size > MAX_RECEIPT_BYTES
  )
    return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    const files = value.files;
    if (
      value.schema_version !== 1 ||
      value.name !== basename(destination) ||
      !files ||
      typeof files !== "object" ||
      Array.isArray(files) ||
      !Object.keys(files).length ||
      Object.keys(files).length > MAX_FILES ||
      !Object.entries(files).every(
        ([name, hash]) => relativeFile(name) && /^[a-f0-9]{64}$/.test(hash),
      )
    )
      return null;
    return files;
  } catch {
    return null;
  }
}

function generatedBytecode(name, files) {
  const match =
    /^(.*\/)?__pycache__\/([^/]+)\.cpython-\d+t?(?:\.opt-[012])?\.pyc$/.exec(
      name,
    );
  return Boolean(
    match && Object.hasOwn(files, `${match[1] ?? ""}${match[2]}.py`),
  );
}

function knownLegacyCopy(destination) {
  for (const known of legacyCopies.filter(
    (copy) => copy.name === basename(destination),
  )) {
    try {
      const content = payload(destination, known.files);
      const entries = Object.entries(content).map(([name, bytes]) => [
        name,
        digest(bytes),
      ]);
      if (digest(JSON.stringify(entries)) !== known.sha256) continue;
      const hashes = Object.fromEntries(entries);
      if (matches(destination, hashes, false)) return hashes;
    } catch {
      // A missing, edited, oversized or symlinked legacy copy is not ours.
    }
  }
  return undefined;
}

// A receipt proves only unchanged copy content, never native enablement or trust.
function matches(destination, files, hasReceipt) {
  let entries = 0;
  let bytes = 0;
  const seen = new Set();
  const expected = Object.keys(files);
  function visit(directory, prefix = "") {
    const handle = opendirSync(directory);
    try {
      while (true) {
        const entry = handle.readSync();
        if (entry === null) break;
        if (++entries > MAX_FILES * 4) return false;
        const name = `${prefix}${entry.name}`;
        if (entry.isSymbolicLink()) return false;
        if (entry.isDirectory()) {
          const nested = `${name}/`;
          const cache =
            entry.name === "__pycache__" &&
            expected.some(
              (file) =>
                dirname(file) === (prefix.slice(0, -1) || ".") &&
                file.endsWith(".py"),
            );
          if (
            (!cache && !expected.some((file) => file.startsWith(nested))) ||
            !visit(join(directory, entry.name), nested)
          )
            return false;
        } else if (entry.isFile()) {
          if (
            (hasReceipt && name === PLUGIN_COPY_RECEIPT) ||
            generatedBytecode(name, files)
          )
            continue;
          if (!Object.hasOwn(files, name)) return false;
          const path = join(directory, entry.name);
          const size = lstatSync(path).size;
          bytes += size;
          if (
            size > MAX_FILE_BYTES ||
            bytes > MAX_PAYLOAD_BYTES ||
            digest(readFileSync(path)) !== files[name]
          )
            return false;
          seen.add(name);
        } else return false;
      }
    } finally {
      handle.closeSync();
    }
    return true;
  }
  return visit(destination) && seen.size === expected.length;
}

export function refreshCopiedPlugin(source, destination, files) {
  const contents = payload(source, files);
  const hashes = Object.fromEntries(
    Object.entries(contents).map(([name, bytes]) => [name, digest(bytes)]),
  );
  const nextReceipt = `${JSON.stringify({ schema_version: 1, name: basename(destination), files: hashes }, null, 2)}\n`;
  // JSON escaping can expand unusual names; never publish a receipt we cannot read.
  if (Buffer.byteLength(nextReceipt) > MAX_RECEIPT_BYTES)
    throw new Error(
      `Managed plugin receipt exceeds ${MAX_RECEIPT_BYTES} bytes; shorten its allowlisted file paths.`,
    );
  const existing = info(destination);
  let ownership = hashes;
  let hasReceipt = false;
  let status = "installed";
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink())
      return {
        status: "preserved",
        reason: "destination is not a real plugin directory",
      };
    const previous = receipt(destination);
    hasReceipt = previous !== undefined;
    ownership =
      previous ??
      (matches(destination, hashes, false)
        ? hashes
        : knownLegacyCopy(destination));
    if (
      previous === null ||
      !ownership ||
      !matches(destination, ownership, hasReceipt)
    )
      return {
        status: "preserved",
        reason:
          previous === undefined
            ? "unreceipted contents do not match the selected payload"
            : "copy ownership changed or includes local files",
      };
    status = previous ? "updated" : "adopted";
  }
  const parent = dirname(destination);
  const parentInfo = info(parent);
  if (parentInfo && (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()))
    return {
      status: "preserved",
      reason: "plugin parent is not a real directory",
    };
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(parent, ".pythia-copy-"));
  const next = join(stage, "value");
  const previous = join(stage, "previous");
  try {
    mkdirSync(next, { mode: 0o700 });
    for (const [name, bytes] of Object.entries(contents)) {
      const target = join(next, name);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, bytes, { mode: 0o600 });
    }
    writeFileSync(join(next, PLUGIN_COPY_RECEIPT), nextReceipt, {
      mode: 0o600,
    });
    // Recheck after staging so edits made while reading/staging are never replaced.
    if (existing) {
      const current = info(destination);
      if (
        !current?.isDirectory() ||
        current.isSymbolicLink() ||
        (hasReceipt &&
          JSON.stringify(receipt(destination)) !== JSON.stringify(ownership)) ||
        (!hasReceipt && info(join(destination, PLUGIN_COPY_RECEIPT))) ||
        !matches(destination, ownership, hasReceipt)
      )
        return {
          status: "preserved",
          reason: "copy changed during preparation",
        };
      renameSync(destination, previous);
    } else if (info(destination)) {
      return {
        status: "preserved",
        reason: "destination appeared during preparation",
      };
    }
    try {
      renameSync(next, destination);
    } catch (error) {
      if (info(previous)) renameSync(previous, destination);
      throw error;
    }
    return { status };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
