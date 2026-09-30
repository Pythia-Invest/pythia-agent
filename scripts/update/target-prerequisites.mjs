import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReleaseError, runGit } from "./release.mjs";

/** Run only after the exact target has passed the installed release trust policy.
 * The target owns a read-only check; this is not a sandbox for untrusted code.
 * Preserve installed path identity: transition receipts bind to that checkout.
 */
export function assertTargetPrerequisites(paths, revision) {
  const root = mkdtempSync(join(tmpdir(), "pythia-prerequisites-"));
  try {
    const archive = join(root, "target.tar");
    runGit(paths.checkout, [
      "archive",
      "--format=tar",
      `--output=${archive}`,
      revision,
      "scripts",
      "runtime",
    ]);
    const extracted = spawnSync("tar", ["-xf", archive, "-C", root], {
      encoding: "utf8",
      timeout: 60_000,
    });
    if (extracted.error || extracted.status !== 0)
      throw new ReleaseError(
        "Could not inspect target release prerequisites; preflight did not change service state.",
        "target_preflight_failed",
      );
    const entry = join(root, "scripts", "update", "prerequisites.mjs");
    if (!existsSync(entry))
      throw new ReleaseError(
        "This target does not expose update prerequisites. Use its documented compatibility procedure; preflight did not change service state.",
        "target_preflight_missing",
      );
    const result = spawnSync(process.execPath, [entry], {
      cwd: root,
      input: JSON.stringify(paths),
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, PYTHIA_CHECKOUT: paths.checkout },
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) {
      const detail = String(
        result.stderr || result.stdout || result.error?.message || "",
      ).trim();
      throw new ReleaseError(
        `Target release prerequisites are not satisfied. Preflight did not change service state.${detail ? `\n${detail}` : ""}`,
        "target_prerequisites_pending",
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
