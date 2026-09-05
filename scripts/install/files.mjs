import {
  chmodSync,
  fsyncSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  renameSync,
  rmSync,
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

export function ensurePrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Private path must be a real directory: ${path}`);
  }
  chmodSync(path, 0o700);
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
      writeFileSync(descriptor, contents, "utf8");
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

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readJsonIfPresent(path) {
  return existsSync(path) ? readJson(path) : null;
}

export function copyPrivateFile(source, destination) {
  const sourceInfo = lstatSync(source);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
    throw new Error(`Refusing non-file or symlink source: ${source}`);
  }
  const temporary = `${destination}.${process.pid}.new`;
  const parent = dirname(destination);
  ensurePrivateDirectory(parent);
  rmSync(temporary, { force: true });
  try {
    copyFileSync(source, temporary);
    chmodSync(temporary, 0o600);
    const descriptor = openSync(temporary, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, destination);
    fsyncDirectory(parent);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function assertNoSymlink(path, label = "path") {
  if (!existsSync(path)) return;
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`${label} may not be a symlink: ${path}`);
  }
}

export function assertPrivateFile(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Expected a private regular file: ${path}`);
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(`Private file permissions are too open: ${path}`);
  }
}

export function transactionReceipt(paths) {
  const pointer = join(paths.transactionRoot, "active.json");
  return { pointer, value: readJsonIfPresent(pointer) };
}

export function writeTransaction(paths, value) {
  ensurePrivateDirectory(paths.transactionRoot);
  if (
    value.transaction_id &&
    !/^[a-z]+-[0-9]+-[0-9]+$/u.test(value.transaction_id)
  ) {
    throw new Error("Transaction identifier is invalid.");
  }
  const now = new Date().toISOString();
  const transactionPath = value.transaction_id
    ? join(paths.transactionRoot, `${value.transaction_id}.json`)
    : null;
  const previous = transactionPath ? readJsonIfPresent(transactionPath) : null;
  const history = [
    ...(Array.isArray(previous?.history) ? previous.history : []),
    {
      phase: value.phase ?? "unknown",
      services: value.services ?? null,
      at: now,
      ...(value.error_code ? { error_code: value.error_code } : {}),
    },
  ];
  const next = {
    schema_version: 1,
    ...value,
    history,
    updated_at: now,
  };
  if (transactionPath) atomicWriteJson(transactionPath, next);
  atomicWriteJson(join(paths.transactionRoot, "active.json"), next);
  return next;
}
