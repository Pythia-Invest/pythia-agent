import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pinnedHermesArchive, sha256 } from "./assembled-cache.mjs";

/*
 * Fills the nightly archive cache (PYTHIA_QUALIFICATION_ARCHIVE_CACHE) with
 * the pinned Hermes source tarball. The pinned URL is GitHub's API, which
 * allows few anonymous requests per runner IP; in CI the workflow's
 * read-only token (GITHUB_TOKEN) authenticates the same request. The pinned
 * sha256 stays the only trust boundary, and dev-init verifies it again.
 */
const directory = resolve(process.argv[2] ?? "");
if (!process.argv[2])
  throw new Error("Usage: fetch-hermes-archive.mjs <directory>");
const pinned = pinnedHermesArchive();
const destination = join(directory, pinned.name);
if (existsSync(destination) && sha256(destination) === pinned.sha256)
  process.exit(0);

const token = process.env.GITHUB_TOKEN;
const response = await fetch(pinned.url, {
  headers: {
    "user-agent": "pythia-agent-qualification",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  signal: AbortSignal.timeout(120_000),
});
if (!response.ok)
  throw new Error(
    `Hermes archive download failed with HTTP ${response.status}.`,
  );
const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== pinned.sha256)
  throw new Error(`Hermes archive digest ${digest} does not match the pin.`);
mkdirSync(directory, { recursive: true, mode: 0o700 });
writeFileSync(`${destination}.partial`, bytes, { mode: 0o600 });
renameSync(`${destination}.partial`, destination);
