import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".py",
  ".ts",
  ".tsx",
]);
// Tool-owned state that lives inside the tree but is never hand-authored.
// Mirrors the directory names in .gitignore; extend both together.
const IGNORED_DIRECTORIES = new Set([
  ".ds-sync",
  ".git",
  ".local",
  ".mypy_cache",
  ".next",
  ".private",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "ds-bundle",
  "node_modules",
  "venv",
]);
const TEST_PATH =
  /(?:^|\/)(?:test|tests|__tests__|testing)(?:\/|$)|(?:^|\/)[^/]+\.(?:test|spec)\.[^.]+$/u;
const TYPESCRIPT_EXTENSION = /\.[cm]?[jt]sx?$/u;
const TS_IGNORE_DIRECTIVE = ["@ts", "ignore"].join("-");
const TS_EXPECT_ERROR_DIRECTIVE = ["@ts", "expect", "error"].join("-");
const DOUBLE_CAST = new RegExp(`\\bas\\s+unknown\\s+${"as"}\\b`, "u");
const EXPLAINED_EXPECT_ERROR = new RegExp(
  `${TS_EXPECT_ERROR_DIRECTIVE}\\s*(?:--|:)\\s*\\S.{4,}`,
  "u",
);

function normalized(path) {
  return path.split(sep).join("/");
}

function sourceFiles(root, current = root) {
  if (!existsSync(current)) return [];
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) return [];
    const path = join(current, entry.name);
    if (entry.isDirectory()) return sourceFiles(root, path);
    return entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))
      ? [normalized(relative(root, path))]
      : [];
  });
}

function hasReasonedIgnore(lines) {
  return lines
    .slice(0, 12)
    .some((line) => /pythia-structure-ignore\s*:\s*\S.{7,}/u.test(line));
}

function isTestInsideSource(path) {
  const sourceIndex = path.indexOf("/src/");
  return sourceIndex >= 0 && TEST_PATH.test(path.slice(sourceIndex + 5));
}

function broadDirectoryViolations(root) {
  const violations = [];
  for (const owner of ["apps", "packages"]) {
    const ownerRoot = join(root, owner);
    if (!existsSync(ownerRoot)) continue;
    const walk = (current) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name))
          continue;
        const path = join(current, entry.name);
        if (entry.name === "shared" || entry.name === "utils") {
          violations.push(
            `${normalized(relative(root, path))}: broad ${entry.name}/ directories are not allowed`,
          );
        }
        walk(path);
      }
    };
    walk(ownerRoot);
  }
  return violations;
}

export function collectStructureViolations(rootValue = process.cwd()) {
  const root = resolve(rootValue);
  const violations = broadDirectoryViolations(root);
  for (const path of sourceFiles(root)) {
    const text = readFileSync(join(root, path), "utf8");
    const lines = text.split(/\r?\n/u);
    const lineCount = lines.length - (text.endsWith("\n") ? 1 : 0);
    const isTest = TEST_PATH.test(path);
    const maximum = isTest ? 600 : 400;
    if (lineCount > maximum && !hasReasonedIgnore(lines)) {
      violations.push(
        `${path}: ${lineCount} lines exceeds the ${maximum}-line ${isTest ? "test" : "production"} review threshold; split it or add an early pythia-structure-ignore with a concrete reason`,
      );
    }
    if (isTestInsideSource(path)) {
      violations.push(`${path}: tests belong in a test/ tree outside src/`);
    }
    if (!TYPESCRIPT_EXTENSION.test(path)) continue;
    lines.forEach((line, index) => {
      if (line.includes(TS_IGNORE_DIRECTIVE)) {
        violations.push(
          `${path}:${index + 1}: ${TS_IGNORE_DIRECTIVE} is not allowed`,
        );
      }
      if (
        line.includes(TS_EXPECT_ERROR_DIRECTIVE) &&
        !EXPLAINED_EXPECT_ERROR.test(line)
      ) {
        violations.push(
          `${path}:${index + 1}: ${TS_EXPECT_ERROR_DIRECTIVE} needs a same-line explanation`,
        );
      }
      if (!isTest && DOUBLE_CAST.test(line)) {
        violations.push(
          `${path}:${index + 1}: production code must validate or narrow data instead of using ${["as", "unknown", "as"].join(" ")}`,
        );
      }
    });
  }
  return violations;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const violations = collectStructureViolations();
  if (violations.length > 0) {
    throw new Error(`Structure check failed:\n${violations.join("\n")}`);
  }
}
