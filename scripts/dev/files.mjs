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

function fsyncDirectory(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export const MANAGED_PLUGIN_FILES = Object.freeze([
  "__init__.py",
  "plugin.yaml",
]);

export const MANAGED_PYTHON_SOURCE_FILES = Object.freeze([
  "NOTICE.md",
  "hermes-source.json",
  "pyproject.toml",
  "uv.lock",
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

function refreshExactCopiedDirectory(source, destination, files, label) {
  const sourceInfo = lstatSync(source);
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) {
    throw new Error(`${label} source must be a real directory: ${source}`);
  }
  const sources = files.map((filename) => {
    const path = join(source, filename);
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`${label} input must be a regular file: ${path}`);
    }
    return [path, filename];
  });
  const parent = dirname(destination);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(parent, ".pythia-copy-"));
  const stagedDestination = join(stage, "value");
  const previous = join(stage, "previous");
  mkdirSync(stagedDestination, { mode: 0o700 });
  for (const [sourcePath, filename] of sources) {
    const stagedPath = join(stagedDestination, filename);
    copyFileSync(sourcePath, stagedPath);
    chmodSync(stagedPath, 0o600);
  }
  if (existsSync(destination)) {
    if (lstatSync(destination).isSymbolicLink()) {
      rmSync(stage, { recursive: true, force: true });
      throw new Error(
        `Refusing to replace symlinked managed copy: ${destination}`,
      );
    }
    renameSync(destination, previous);
  }
  try {
    renameSync(stagedDestination, destination);
  } catch (error) {
    if (existsSync(previous)) {
      renameSync(previous, destination);
    }
    throw error;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function refreshExactFilesPreservingDirectory(
  source,
  destination,
  files,
  label,
  preservedDirectories = [],
) {
  const sourceInfo = lstatSync(source);
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) {
    throw new Error(`${label} source must be a real directory: ${source}`);
  }
  const sources = files.map((filename) => {
    const path = join(source, filename);
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`${label} input must be a regular file: ${path}`);
    }
    return [path, filename];
  });
  const parent = dirname(destination);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (existsSync(destination)) {
    const destinationInfo = lstatSync(destination);
    if (destinationInfo.isSymbolicLink() || !destinationInfo.isDirectory()) {
      throw new Error(
        `${label} destination must be a real directory: ${destination}`,
      );
    }
  } else {
    mkdirSync(destination, { mode: 0o700 });
  }

  const allowedNames = new Set([...files, ...preservedDirectories]);
  for (const entry of readdirSync(destination, { withFileTypes: true })) {
    const current = join(destination, entry.name);
    if (preservedDirectories.includes(entry.name)) {
      const info = lstatSync(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error(
          `${label} preserved environment must be a real directory: ${current}`,
        );
      }
    } else if (!allowedNames.has(entry.name)) {
      rmSync(current, { recursive: true, force: true });
    }
  }

  const stage = mkdtempSync(join(parent, ".pythia-inputs-"));
  try {
    for (const [sourcePath, filename] of sources) {
      const current = join(destination, filename);
      if (existsSync(current)) {
        const currentInfo = lstatSync(current);
        if (currentInfo.isSymbolicLink() || !currentInfo.isFile()) {
          throw new Error(
            `${label} destination input must be a regular file: ${current}`,
          );
        }
      }
      const staged = join(stage, filename);
      copyFileSync(sourcePath, staged);
      chmodSync(staged, 0o600);
    }
    for (const filename of files) {
      renameSync(join(stage, filename), join(destination, filename));
    }
    fsyncDirectory(destination);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function refreshManagedPlugin(source, destination) {
  refreshExactCopiedDirectory(
    source,
    destination,
    MANAGED_PLUGIN_FILES,
    "Managed plugin",
  );
}

export function refreshManagedPythonSource(source, destination) {
  refreshExactFilesPreservingDirectory(
    source,
    destination,
    MANAGED_PYTHON_SOURCE_FILES,
    "Managed Python",
    [".venv"],
  );
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
