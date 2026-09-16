// Dependency-owned static data, generated before dev/build; never workspace files.
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(
  readFileSync(join(source, "package.json"), "utf8"),
);
const target = fileURLToPath(
  new URL(`../public/_pdfjs/${version}/`, import.meta.url),
);
mkdirSync(target, { recursive: true });
cpSync(join(source, "cmaps"), join(target, "cmaps"), { recursive: true });
