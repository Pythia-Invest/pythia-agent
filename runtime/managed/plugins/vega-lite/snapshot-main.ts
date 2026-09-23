import { renderSnapshotInput, SNAPSHOT_ERROR } from "./snapshot";

try {
  process.stdout.write(await renderSnapshotInput(process.stdin));
} catch {
  process.stderr.write(`${SNAPSHOT_ERROR}\n`);
  process.exitCode = 1;
}
