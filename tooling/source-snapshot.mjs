import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

function normalize(path) {
  return path.split(sep).join("/");
}

function assertRelative(path) {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe source-snapshot path: ${JSON.stringify(path)}`);
  }
  return path;
}

function existsInWorkingTree(repository, path) {
  try {
    lstatSync(join(repository, path));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function gitSourcePaths(repository) {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: repository,
      encoding: "buffer",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    },
  );
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(assertRelative)
    .filter((path) => existsInWorkingTree(repository, path))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function directoryPaths(repository, current = repository) {
  return readdirSync(current, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .flatMap((entry) => {
      if (entry.name === ".git") return [];
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) return directoryPaths(repository, absolute);
      return [assertRelative(normalize(relative(repository, absolute)))];
    });
}

function entry(repository, path) {
  const absolute = join(repository, path);
  const info = lstatSync(absolute);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`Snapshots accept only regular files: ${path}`);
  }
  const bytes = readFileSync(absolute);
  return {
    path,
    mode: info.mode & 0o111 ? "100755" : "100644",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function sourceManifest(repository) {
  const root = resolve(repository);
  const entries = gitSourcePaths(root).map((path) => entry(root, path));
  const digest = createHash("sha256")
    .update(`${JSON.stringify(entries)}\n`)
    .digest("hex");
  return { schema_version: 1, digest, entries };
}

export function directoryManifest(repository) {
  const root = resolve(repository);
  const entries = directoryPaths(root)
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((path) => entry(root, path));
  const digest = createHash("sha256")
    .update(`${JSON.stringify(entries)}\n`)
    .digest("hex");
  return { schema_version: 1, digest, entries };
}

export function copySourceSnapshot(repository, destination) {
  const source = resolve(repository);
  const target = resolve(destination);
  if (existsSync(target)) {
    throw new Error(`Snapshot destination already exists: ${target}`);
  }
  mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const item of sourceManifest(source).entries) {
    const output = join(target, item.path);
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
    copyFileSync(join(source, item.path), output);
    chmodSync(output, item.mode === "100755" ? 0o755 : 0o644);
  }
  return directoryManifest(target);
}

export function derivePredecessor(snapshot, specificationPath) {
  const root = resolve(snapshot);
  const specification = JSON.parse(readFileSync(specificationPath, "utf8"));
  if (
    specification.schema_version !== 1 ||
    !Array.isArray(specification.remove) ||
    !Array.isArray(specification.replace)
  ) {
    throw new Error("The predecessor specification is invalid.");
  }
  for (const raw of specification.remove) {
    const path = assertRelative(raw);
    const target = join(root, path);
    const info = lstatSync(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`Predecessor removal is not a regular file: ${path}`);
    }
    rmSync(target);
  }
  for (const replacement of specification.replace) {
    const path = assertRelative(replacement.path);
    if (
      typeof replacement.from !== "string" ||
      typeof replacement.to !== "string" ||
      !replacement.from ||
      replacement.from === replacement.to
    ) {
      throw new Error(`Invalid predecessor replacement for ${path}.`);
    }
    const target = join(root, path);
    const current = readFileSync(target, "utf8");
    const first = current.indexOf(replacement.from);
    if (first === -1 || current.indexOf(replacement.from, first + 1) !== -1) {
      throw new Error(
        `Predecessor replacement must match exactly once in ${path}.`,
      );
    }
    writeFileSync(
      target,
      current.replace(replacement.from, replacement.to),
      "utf8",
    );
  }
  return directoryManifest(root);
}

export function synchronizeSnapshot(source, destination) {
  const expected = directoryManifest(source);
  const existing = new Set(directoryPaths(destination));
  for (const item of expected.entries) {
    const output = join(destination, item.path);
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
    copyFileSync(join(source, item.path), output);
    chmodSync(output, item.mode === "100755" ? 0o755 : 0o644);
    existing.delete(item.path);
  }
  for (const path of existing) rmSync(join(destination, path));
  return directoryManifest(destination);
}
