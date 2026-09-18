import { lstatSync, readFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";

const NAME = "pythia-agent-basic-memory.service";
function quote(value) {
  if (/[\r\n\0]/u.test(value)) throw new Error("Unsafe legacy unit path.");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
}
function pathValue(value) {
  if (
    !value.startsWith("/") ||
    /[\r\n\0]/u.test(value) ||
    value.trim() !== value
  )
    throw new Error("Unsafe legacy unit path.");
  return value.replaceAll("%", "%%");
}

export function legacyBasicMemoryUnit(paths) {
  return readFileSync(
    new URL("./legacy-basic-memory.service.in", import.meta.url),
    "utf8",
  )
    .replaceAll(
      "@@BASIC_MEMORY_ENVIRONMENT_FILE@@",
      pathValue(paths.legacyBasicMemoryEnvironment),
    )
    .replaceAll("@@WORKSPACE@@", pathValue(paths.workspace))
    .replaceAll(
      "@@BASIC_MEMORY@@",
      quote(join(paths.legacyPython, ".venv", "bin", "basic-memory")),
    );
}

const retiredFile = (paths) =>
  join(paths.unitRoot, ".pythia-workspace-basic-memory.retired");
const info = (file) => lstatSync(file, { throwIfNoEntry: false });
function assertExactFile(file, expected) {
  const stat = info(file);
  if (
    !stat?.isFile() ||
    stat.isSymbolicLink() ||
    readFileSync(file, "utf8") !== expected
  )
    throw new Error(
      "Legacy Basic Memory unit is customized or unowned; preserve it for manual review.",
    );
}
function property(control, name) {
  return control(["show", NAME, `--property=${name}`, "--value"], {
    allowedStatuses: [0, 1],
  });
}
function assertNoDropIns(control) {
  if (property(control, "DropInPaths"))
    throw new Error(
      "Legacy Basic Memory has user drop-ins; preserve them for manual review.",
    );
}
function assertStopped(control) {
  const state = control(["is-active", NAME], { allowedStatuses: [0, 3, 4] });
  if (
    !["inactive", "failed"].includes(state) ||
    property(control, "MainPID") !== "0" ||
    property(control, "ControlPID") !== "0" ||
    property(control, "ControlGroup") !== ""
  )
    throw new Error(
      "Legacy Basic Memory still has live processes; its files were preserved.",
    );
}

export function assertLegacyBasicMemoryOwned(paths, control) {
  const file = join(paths.unitRoot, NAME);
  const fragment = property(control, "FragmentPath");
  if (!info(file) && !fragment) return { present: false };
  if (!fragment || resolve(fragment) !== resolve(file))
    throw new Error(
      "Legacy Basic Memory loaded fragment does not match its owned file.",
    );
  const root = info(paths.unitRoot);
  if (!root?.isDirectory() || root.isSymbolicLink())
    throw new Error(
      "Legacy unit directory is not an ordinary owned directory.",
    );
  const present = Boolean(info(file));
  assertExactFile(
    present ? file : retiredFile(paths),
    legacyBasicMemoryUnit(paths),
  );
  assertNoDropIns(control);
  if (!present) {
    // The atomic retired file preserves explicit removal authority across a
    // failed daemon-reload. A missing file alone never grants this authority.
    assertStopped(control);
    const executable = join(paths.legacyPython, ".venv", "bin", "basic-memory");
    const argv = `${executable} mcp --transport streamable-http --host 127.0.0.1 --port 8643 --path /mcp --project production`;
    const loaded = property(control, "ExecStart");
    if (
      !loaded.includes(`path=${executable} ;`) ||
      !loaded.includes(`argv[]=${argv} ;`)
    )
      throw new Error("Retired Basic Memory has an unexpected loaded command.");
  }
  return { present };
}

// Only the explicit transition retires a unit. Preserve the exact old unit as
// transaction evidence before requesting reload, so interruption can recover.
export function retireLegacyBasicMemoryUnit(paths, control) {
  const state = assertLegacyBasicMemoryOwned(paths, control);
  if (!state.present) {
    if (!property(control, "FragmentPath"))
      return { retired: false, reason: "absent" };
    control(["daemon-reload"]);
    return { retired: true };
  }
  const file = join(paths.unitRoot, NAME);
  const backup = retiredFile(paths);
  if (info(backup))
    throw new Error(
      "Legacy retirement backup already exists; preserve it for manual review.",
    );
  control(["stop", NAME]);
  assertStopped(control);
  assertLegacyBasicMemoryOwned(paths, control);
  control(["disable", NAME]);
  assertLegacyBasicMemoryOwned(paths, control);
  renameSync(file, backup);
  control(["daemon-reload"]);
  return { retired: true };
}
