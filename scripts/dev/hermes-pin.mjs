import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// `runtime/versions.json` is the single Hermes pin record. The install-facing
// `runtime/hermes/hermes-source.json` keeps the hydration command and
// must repeat the same release, commit and archive; `hermesPinDisagreements`
// is the mechanical agreement check run by `tooling/check-public-source.mjs`.
const checkoutRoot = resolve(import.meta.dirname, "..", "..");
const TAG_ARCHIVE = "github-tag-source-tarball";

function readJson(root, ...segments) {
  return JSON.parse(readFileSync(join(root, ...segments), "utf8"));
}

export function hermesPin(root = checkoutRoot) {
  const pin = readJson(root, "runtime", "versions.json").dependencies
    ?.hermes_agent;
  const archive = pin?.artifacts?.find((item) => item.kind === TAG_ARCHIVE);
  if (!pin?.release || !pin.commit || !pin.package_version || !archive) {
    throw new Error("runtime/versions.json: incomplete Hermes pin record.");
  }
  return {
    release: pin.release,
    commit: pin.commit,
    packageVersion: pin.package_version,
    archiveUrl: archive.url,
    archiveSha256: archive.sha256,
    sourceUrl: pin.source_url,
    licenseUrl: pin.license_url,
  };
}

export function hermesPinDisagreements(root = checkoutRoot) {
  const pin = hermesPin(root);
  const source = readJson(root, "runtime", "hermes", "hermes-source.json");
  const problems = [];
  const expect = (label, actual, expected) => {
    if (actual !== expected) {
      problems.push(`${label} is ${actual ?? "<missing>"}; pin is ${expected}`);
    }
  };
  expect("hermes-source.json release", source.release, pin.release);
  expect("hermes-source.json commit", source.commit, pin.commit);
  expect("hermes-source.json archive_url", source.archive_url, pin.archiveUrl);
  expect(
    "hermes-source.json archive_sha256",
    source.archive_sha256,
    pin.archiveSha256,
  );
  if (!/^[0-9a-f]{40}$/u.test(pin.commit)) {
    problems.push(`versions.json commit is not a full SHA: ${pin.commit}`);
  }
  if (!pin.archiveUrl.endsWith(`/refs/tags/${pin.release}`)) {
    problems.push(`versions.json archive URL does not name ${pin.release}`);
  }
  for (const [label, url] of [
    ["source_url", pin.sourceUrl],
    ["license_url", pin.licenseUrl],
  ]) {
    if (!url?.includes(`/${pin.commit}`)) {
      problems.push(`versions.json ${label} does not name ${pin.commit}`);
    }
  }
  return problems;
}

// Hermes `/health` reports `hermes_cli.__version__`; readiness accepts only the
// pinned package version so a stale or foreign gateway is never treated as ours.
export function isPinnedHermesHealth(body, pin = hermesPin()) {
  return (
    body?.status === "ok" &&
    body?.platform === "hermes-agent" &&
    body?.version === pin.packageVersion
  );
}
