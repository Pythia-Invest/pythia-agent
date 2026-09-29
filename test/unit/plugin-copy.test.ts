import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MANAGED_CORE_FILES,
  refreshManagedPlugin,
} from "../../scripts/dev/files.mjs";
import {
  inspectManagedPluginCopy,
  PLUGIN_COPY_RECEIPT,
} from "../../scripts/dev/plugin-copy.mjs";

const roots: string[] = [];
const source = resolve("runtime/managed/core");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pythia-plugin-"));
  roots.push(root);
  const destination = join(root, "pythia");
  mkdirSync(destination);
  for (const name of ["__init__.py", "plugin.yaml"])
    cpSync(
      resolve("test/fixtures/plugin-562dfc9", name),
      join(destination, name),
    );
  return { root, destination };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("managed plugin historical ownership", () => {
  it("adopts the actual old two-file release, ignores normal bytecode, and creates compatible receipts", () => {
    const { destination } = fixture();
    mkdirSync(join(destination, "__pycache__"));
    writeFileSync(
      join(destination, "__pycache__", "__init__.cpython-314.pyc"),
      "synthetic bytecode",
    );
    const before = readdirSync(destination);
    expect(
      inspectManagedPluginCopy(source, destination, MANAGED_CORE_FILES),
    ).toMatchObject({ safe: true, kind: "adopted" });
    expect(readdirSync(destination)).toEqual(before);
    refreshManagedPlugin(source, destination);
    expect(
      JSON.parse(readFileSync(join(destination, PLUGIN_COPY_RECEIPT), "utf8")),
    ).toMatchObject({ schema_version: 1, name: "pythia" });
    expect(refreshManagedPlugin(source, destination).status).toBe("updated");
  });

  it.each([
    "edit",
    "unexpected",
    "cache",
    "symlink",
    "dangling",
    "parent-link",
    "receipt",
  ])("preserves %s conflicts", (kind) => {
    const { root, destination } = fixture();
    let target = destination;
    if (kind === "edit")
      writeFileSync(join(destination, "__init__.py"), "local customization");
    if (kind === "unexpected")
      writeFileSync(join(destination, "notes.txt"), "local notes");
    if (kind === "cache") {
      mkdirSync(join(destination, "__pycache__"));
      writeFileSync(
        join(destination, "__pycache__", "unknown.cpython-314.pyc"),
        "unknown",
      );
    }
    if (kind === "symlink" || kind === "dangling") {
      target = join(root, "linked");
      symlinkSync(
        kind === "symlink" ? destination : join(root, "missing"),
        target,
      );
    }
    if (kind === "parent-link") {
      symlinkSync(root, join(root, "parent"));
      target = join(root, "parent", "pythia");
    }
    if (kind === "receipt")
      writeFileSync(join(destination, PLUGIN_COPY_RECEIPT), "{}");
    const before = readFileSync(join(destination, "__init__.py"));
    expect(
      inspectManagedPluginCopy(source, target, MANAGED_CORE_FILES).safe,
    ).toBe(false);
    expect(refreshManagedPlugin(source, target).status).toBe("preserved");
    expect(readFileSync(join(destination, "__init__.py"))).toEqual(before);
    expect(existsSync(join(destination, "desk_view.py"))).toBe(false);
  });

  it("preserves customization made after a receipted update", () => {
    const { destination } = fixture();
    refreshManagedPlugin(source, destination);
    writeFileSync(join(destination, "desk_view.py"), "custom");
    expect(refreshManagedPlugin(source, destination).status).toBe("preserved");
    expect(readFileSync(join(destination, "desk_view.py"), "utf8")).toBe(
      "custom",
    );
  });
});
