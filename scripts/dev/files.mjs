import {
  chmodSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { refreshCopiedPlugin } from "./plugin-copy.mjs";
export {
  assertManagedPluginSource,
  PLUGIN_COPY_RECEIPT,
} from "./plugin-copy.mjs";

function fsyncDirectory(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export const MANAGED_CORE_FILES = Object.freeze([
  "__init__.py",
  "plugin.yaml",
  "desk_view.py",
  "identity_ops.py",
  "operating.py",
  "platform/__init__.py",
  "platform/access.py",
  "platform/admission.py",
  "platform/request_context.py",
  "platform/operations.py",
  "platform/http.py",
  "platform/live.py",
  "platform/live_http.py",
  "platform/subscription.py",
  "platform/specialist.py",
  "platform/assets.py",
  "platform/widgets.py",
  "platform/configuration.py",
  "identity/__init__.py",
  "identity/claims.py",
  "identity/manifest.py",
  "identity/model.py",
  "identity/page.py",
  "identity/resolution.py",
  "identity/schemes.py",
  "identity/search.py",
  "identity/store.py",
  "identity/vocabulary.py",
  "identity/sql/identity.sql",
  "identity/sql/reference.sql",
  "identity/native_coins.json",
]);

export function ensurePrivateDirectory(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Private directory must be a real directory: ${path}`);
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error(
      `Private directory permissions are too open (${(info.mode & 0o777).toString(8)}): ${path}. Run chmod 700 on it.`,
    );
  }
  return path;
}

export function ensurePrivateTree(paths) {
  for (const path of paths) {
    ensurePrivateDirectory(path);
  }
}

export function atomicWrite(path, contents, mode = 0o600) {
  const parent = dirname(path);
  ensurePrivateDirectory(parent);
  const temporaryRoot = mkdtempSync(join(parent, ".pythia-write-"));
  chmodSync(temporaryRoot, 0o700);
  const temporary = join(temporaryRoot, "value");
  try {
    const descriptor = openSync(temporary, "wx", mode);
    try {
      writeFileSync(descriptor, contents, { encoding: "utf8" });
      chmodSync(temporary, mode);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, path);
    fsyncDirectory(parent);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function atomicWriteJson(path, value) {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function createJsonExclusive(path, value) {
  const parent = dirname(path);
  ensurePrivateDirectory(parent);
  const temporaryRoot = mkdtempSync(join(parent, ".pythia-create-"));
  chmodSync(temporaryRoot, 0o700);
  const temporary = join(temporaryRoot, "value");
  try {
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
      });
      chmodSync(temporary, 0o600);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    try {
      linkSync(temporary, path);
    } catch (error) {
      if (error.code === "EEXIST") return false;
      throw error;
    }
    fsyncDirectory(parent);
    return true;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function copyFileIfAbsent(source, destination, mode = 0o600) {
  if (existsSync(destination)) {
    return false;
  }
  const sourceInfo = lstatSync(source);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
    throw new Error(`Seed source must be a regular file: ${source}`);
  }
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  copyFileSync(source, destination, 0);
  chmodSync(destination, mode);
  return true;
}

export function refreshManagedPlugin(
  source,
  destination,
  files = MANAGED_CORE_FILES,
) {
  return refreshCopiedPlugin(source, destination, files);
}

export function assertRegularPrivateFile(path) {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`Expected a regular private file: ${path}`);
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error(`Private file permissions are too open: ${path}`);
  }
}

export function directoryBytes(path) {
  if (!existsSync(path)) return 0;
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    const child = join(path, entry.name);
    return (
      total +
      (entry.isDirectory() ? directoryBytes(child) : statSync(child).size)
    );
  }, 0);
}
