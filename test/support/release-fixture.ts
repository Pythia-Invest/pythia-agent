import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import {
  atomicWriteJson,
  copyPrivateFile,
} from "../../scripts/install/files.mjs";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

export function run(cwd: string, args: string[]) {
  return execFileSync(args[0] ?? "", args.slice(1), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "pythia-release-test-"));
  roots.push(root);
  return root;
}

export function commit(repository: string, message: string) {
  run(repository, ["git", "add", "."]);
  run(repository, ["git", "commit", "-m", message]);
  return run(repository, ["git", "rev-parse", "HEAD"]);
}

export function signedTag(repository: string, key: string, tag: string) {
  run(repository, [
    "git",
    "-c",
    "gpg.format=ssh",
    "-c",
    `user.signingkey=${key}`,
    "tag",
    "-s",
    tag,
    "-m",
    tag,
  ]);
}

export function releaseFixture(
  prerequisite: string | null = "// No additional prerequisites.\n",
) {
  const root = temporaryRoot();
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  const checkout = join(root, "checkout");
  const key = join(root, "release-key");
  mkdirSync(source);
  run(root, ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", key]);
  const publicKey = readFileSync(`${key}.pub`, "utf8").trim();
  run(source, ["git", "init", "-b", "main"]);
  run(source, ["git", "config", "user.name", "Pythia test"]);
  run(source, ["git", "config", "user.email", "release@test.invalid"]);
  mkdirSync(join(source, "release"));
  writeFileSync(
    join(source, "release", "allowed_signers"),
    `release@test.invalid namespaces="git" ${publicKey}\n`,
  );
  writeFileSync(join(source, "version.txt"), "A\n");
  const revisionA = commit(source, "release A");
  signedTag(source, key, "v0.1.0");
  mkdirSync(join(source, "scripts", "update"), { recursive: true });
  mkdirSync(join(source, "runtime"));
  writeFileSync(join(source, "runtime", "fixture.txt"), "synthetic release");
  if (prerequisite !== null)
    writeFileSync(
      join(source, "scripts", "update", "prerequisites.mjs"),
      prerequisite,
    );
  writeFileSync(join(source, "version.txt"), "B\n");
  const revisionB = commit(source, "release B");
  signedTag(source, key, "v0.2.0");
  run(root, ["git", "init", "--bare", remote]);
  run(source, ["git", "remote", "add", "origin", remote]);
  run(source, ["git", "push", "origin", "main", "--tags"]);
  run(root, ["git", "clone", remote, checkout]);
  run(checkout, ["git", "checkout", "-b", "installed-v0.1.0", "v0.1.0"]);

  const environment = {
    ...process.env,
    HOME: join(root, "home"),
    PYTHIA_CHECKOUT: checkout,
    PYTHIA_INSTALL_BIN_HOME: join(root, "home", ".local", "bin"),
    PYTHIA_INSTALL_CACHE_HOME: join(root, "cache"),
    PYTHIA_INSTALL_CONFIG_HOME: join(root, "config"),
    PYTHIA_INSTALL_DATA_HOME: join(root, "data"),
    PYTHIA_INSTALL_STATE_HOME: join(root, "state"),
    PYTHIA_INSTALL_SYSTEMD_HOME: join(root, "units"),
  };
  const paths = resolveInstallPaths(environment);
  mkdirSync(paths.configRoot, { recursive: true, mode: 0o700 });
  mkdirSync(paths.trustRoot, { recursive: true, mode: 0o700 });
  mkdirSync(paths.transactionRoot, { recursive: true, mode: 0o700 });
  copyPrivateFile(
    join(checkout, "release", "allowed_signers"),
    paths.allowedSigners,
  );
  atomicWriteJson(paths.releaseFile, { schema_version: 1, channel: "stable" });
  atomicWriteJson(paths.installFile, {
    schema_version: 1,
    checkout,
    channel: "stable",
    revision: revisionA,
  });
  return { checkout, key, paths, revisionA, revisionB, root, source };
}
