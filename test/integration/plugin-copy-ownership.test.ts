import {
  copyFileSync,
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
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  PLUGIN_COPY_RECEIPT,
  refreshManagedPlugin,
} from "../../scripts/dev/files.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const files = [
  "__init__.py",
  "plugin.yaml",
  "skills/research/SKILL.md",
  "skills/research/assets/example.html",
];
function put(path: string, value: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pythia-plugin-ownership-"));
  roots.push(root);
  const source = join(root, "source");
  const destination = join(root, "profile/plugins/example");
  for (const file of files) put(join(source, file), `${file}\n`);
  return { root, source, destination };
}

it("updates an owned nested payload, removes retired owned files and discards only recognized Python cache", () => {
  const { source, destination } = fixture();
  expect(refreshManagedPlugin(source, destination, files).status).toBe(
    "installed",
  );
  put(
    join(destination, "__pycache__/__init__.cpython-312.pyc"),
    "native generated cache",
  );
  put(join(source, "__init__.py"), "new implementation\n");
  put(join(source, "skills/research/reference.md"), "new supporting file\n");
  const next = [
    ...files.filter((file) => !file.endsWith("example.html")),
    "skills/research/reference.md",
  ];
  expect(refreshManagedPlugin(source, destination, next).status).toBe(
    "updated",
  );
  expect(readFileSync(join(destination, "__init__.py"), "utf8")).toBe(
    "new implementation\n",
  );
  expect(
    readFileSync(join(destination, "skills/research/reference.md"), "utf8"),
  ).toBe("new supporting file\n");
  expect(
    existsSync(join(destination, "skills/research/assets/example.html")),
  ).toBe(false);
  expect(existsSync(join(destination, "__pycache__"))).toBe(false);
  expect(readdirSync(dirname(destination))).toEqual(["example"]);
});

it.each([
  "__init__.py",
  "local-notes.txt",
  "skills/research/assets/local.html",
  "__pycache__/notes.txt",
])(
  "preserves the whole plugin when local file %s changes ownership",
  (file) => {
    const { source, destination } = fixture();
    refreshManagedPlugin(source, destination, files);
    const before = readFileSync(join(destination, PLUGIN_COPY_RECEIPT));
    put(join(destination, file), "user choice\n");
    put(join(source, "plugin.yaml"), "upstream update\n");
    expect(refreshManagedPlugin(source, destination, files).status).toBe(
      "preserved",
    );
    expect(readFileSync(join(destination, file), "utf8")).toBe("user choice\n");
    expect(readFileSync(join(destination, "plugin.yaml"), "utf8")).toBe(
      "plugin.yaml\n",
    );
    expect(readFileSync(join(destination, PLUGIN_COPY_RECEIPT))).toEqual(
      before,
    );
  },
);

it("adopts an exact unreceipted payload but never claims an unknown replacement", () => {
  const { source, destination } = fixture();
  for (const file of files) {
    mkdirSync(dirname(join(destination, file)), { recursive: true });
    copyFileSync(join(source, file), join(destination, file));
  }
  expect(refreshManagedPlugin(source, destination, files).status).toBe(
    "adopted",
  );
  rmSync(join(destination, PLUGIN_COPY_RECEIPT));
  put(join(destination, "__init__.py"), "user replacement\n");
  expect(refreshManagedPlugin(source, destination, files).status).toBe(
    "preserved",
  );
  expect(existsSync(join(destination, PLUGIN_COPY_RECEIPT))).toBe(false);
  expect(readFileSync(join(destination, "__init__.py"), "utf8")).toBe(
    "user replacement\n",
  );
});

it("preserves missing or malformed ownership evidence after a local change", () => {
  const { source, destination } = fixture();
  refreshManagedPlugin(source, destination, files);
  put(join(destination, PLUGIN_COPY_RECEIPT), "not a receipt");
  expect(refreshManagedPlugin(source, destination, files).status).toBe(
    "preserved",
  );
  rmSync(join(destination, PLUGIN_COPY_RECEIPT));
  rmSync(join(destination, "__init__.py"));
  expect(refreshManagedPlugin(source, destination, files).status).toBe(
    "preserved",
  );
  expect(existsSync(join(destination, "__init__.py"))).toBe(false);
});

it("refuses path traversal and intermediate source links without changing an installed copy", () => {
  const { root, source, destination } = fixture();
  refreshManagedPlugin(source, destination, files);
  expect(() =>
    refreshManagedPlugin(source, destination, ["../outside"]),
  ).toThrow(/relative file allowlist/);
  rmSync(join(source, "skills"), { recursive: true });
  put(join(root, "foreign/research/SKILL.md"), "external file\n");
  symlinkSync(join(root, "foreign"), join(source, "skills"));
  expect(() => refreshManagedPlugin(source, destination, files)).toThrow(
    /real parent/,
  );
  expect(
    readFileSync(join(destination, "skills/research/SKILL.md"), "utf8"),
  ).toBe("skills/research/SKILL.md\n");
});

it("does not replace destination links or write through a linked plugins directory", () => {
  const { root, source, destination } = fixture();
  put(join(root, "foreign/keep"), "user-owned\n");
  mkdirSync(dirname(destination), { recursive: true });
  symlinkSync(join(root, "foreign"), destination);
  expect(refreshManagedPlugin(source, destination, files).status).toBe(
    "preserved",
  );
  rmSync(dirname(destination), { recursive: true });
  symlinkSync(join(root, "foreign"), dirname(destination));
  expect(refreshManagedPlugin(source, destination, files).status).toBe(
    "preserved",
  );
  expect(readdirSync(join(root, "foreign"))).toEqual(["keep"]);
});

it("can update the largest admitted file inventory without rejecting its own receipt", () => {
  const { source, destination } = fixture();
  const names = Array.from(
    { length: 512 },
    (_, index) => `${index}-${"a".repeat(226)}.md`,
  );
  for (const name of names) put(join(source, name), "supporting content\n");
  expect(refreshManagedPlugin(source, destination, names).status).toBe(
    "installed",
  );
  expect(refreshManagedPlugin(source, destination, names).status).toBe(
    "updated",
  );
});
