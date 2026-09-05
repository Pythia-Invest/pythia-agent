#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(repoRoot, ".agents", "rules");
const claudeRoot = process.env.PYTHIA_AGENT_CLAUDE_RULES_ROOT
  ? path.resolve(process.env.PYTHIA_AGENT_CLAUDE_RULES_ROOT)
  : path.join(repoRoot, ".claude", "rules");
const cursorRoot = process.env.PYTHIA_AGENT_CURSOR_RULES_ROOT
  ? path.resolve(process.env.PYTHIA_AGENT_CURSOR_RULES_ROOT)
  : path.join(repoRoot, ".cursor", "rules");
const manifestName = ".pythia-agent-generated.json";
const nestedBuilderRoots = [
  ".agents",
  "apps/design-lab",
  "apps/desk",
  "packages/ui",
  "runtime",
];

function fail(message) {
  throw new Error(`sync-rules: ${message}`);
}

function parseRule(markdown, filename) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) fail(`${filename} has no frontmatter`);
  const blocks = [];
  let current;
  for (const line of match[1].split(/\r?\n/)) {
    const top = line.match(/^([A-Za-z_-]+):/);
    if (top) {
      current = { key: top[1], lines: [line] };
      blocks.push(current);
    } else if (current) current.lines.push(line);
  }
  const paths = blocks.find((block) => block.key === "paths");
  const globs = blocks.find((block) => block.key === "globs");
  if (
    !paths ||
    !globs ||
    paths.lines.slice(1).join("\n") !== globs.lines.slice(1).join("\n")
  ) {
    fail(`${filename} must have identical paths and globs lists`);
  }
  return { blocks, body: match[2] };
}

function renderRule(blocks, body, keys, extra = []) {
  const metadata = blocks
    .filter((block) => keys.has(block.key))
    .flatMap((block) => block.lines);
  return `---\n${[...metadata, ...extra].join("\n")}\n---\n${body}`;
}

function cursorScope(relativeRoot, body) {
  const name = `_scope-${relativeRoot.replaceAll("/", "--").replace(/[^A-Za-z0-9_-]/g, "-")}.mdc`;
  const content = [
    "---",
    `description: ${JSON.stringify(`Directory instructions for ${relativeRoot}/`)}`,
    "globs:",
    `  - ${JSON.stringify(`${relativeRoot}/**/*`)}`,
    "alwaysApply: false",
    "---",
    body,
  ].join("\n");
  return [name, content];
}

function projections() {
  if (!existsSync(sourceRoot))
    fail("missing canonical .agents/rules directory");
  const claude = new Map();
  const cursor = new Map();
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const { blocks, body } = parseRule(
      readFileSync(path.join(sourceRoot, entry.name), "utf8"),
      entry.name,
    );
    claude.set(
      entry.name,
      renderRule(blocks, body, new Set(["description", "paths"])),
    );
    cursor.set(
      entry.name.replace(/\.md$/, ".mdc"),
      renderRule(blocks, body, new Set(["description", "globs"]), [
        "alwaysApply: false",
      ]),
    );
  }
  for (const relativeRoot of nestedBuilderRoots) {
    const agentPath = path.join(repoRoot, relativeRoot, "AGENTS.md");
    if (existsSync(agentPath)) {
      const [name, content] = cursorScope(
        relativeRoot,
        readFileSync(agentPath, "utf8"),
      );
      cursor.set(name, content);
    }
  }
  return { claude, cursor };
}

function manifestEntries(root) {
  const manifest = path.join(root, manifestName);
  if (!existsSync(manifest)) return [];
  if (lstatSync(manifest).isSymbolicLink())
    fail(`refusing symlinked manifest ${manifest}`);
  const parsed = JSON.parse(readFileSync(manifest, "utf8"));
  if (!Array.isArray(parsed.files)) fail(`invalid manifest ${manifest}`);
  return parsed.files;
}

function ownedPath(root, relative) {
  if (
    typeof relative !== "string" ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes("..")
  ) {
    fail(`unsafe owned path ${JSON.stringify(relative)}`);
  }
  return path.join(root, relative);
}

function preflightOne(root, projection) {
  const toolRoot = path.basename(root) === "rules" ? path.dirname(root) : root;
  if (existsSync(toolRoot) && lstatSync(toolRoot).isSymbolicLink()) {
    fail(`refusing symlinked tool root ${toolRoot}`);
  }
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) {
    fail(`refusing symlinked target root ${root}`);
  }
  const owned = new Set(manifestEntries(root));
  for (const relative of [...owned, ...projection.keys()]) {
    let current = root;
    for (const part of relative.split(/[\\/]/)) {
      current = path.join(current, part);
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
        fail(`refusing symlinked destination ${current}`);
      }
    }
  }
  for (const relative of projection.keys()) {
    if (existsSync(ownedPath(root, relative)) && !owned.has(relative)) {
      fail(
        `refusing to overwrite unowned destination ${path.join(root, relative)}`,
      );
    }
  }
}

function syncOne(root, projection) {
  mkdirSync(root, { recursive: true });
  const next = new Set(projection.keys());
  for (const relative of manifestEntries(root)) {
    const target = ownedPath(root, relative);
    if (!next.has(relative) && existsSync(target)) unlinkSync(target);
  }
  for (const [relative, content] of projection)
    writeFileSync(ownedPath(root, relative), content);
  writeFileSync(
    path.join(root, manifestName),
    `${JSON.stringify({ files: [...projection.keys()] }, null, 2)}\n`,
  );
}

function checkOne(root, projection, label) {
  if (
    JSON.stringify(manifestEntries(root)) !==
    JSON.stringify([...projection.keys()])
  )
    fail(`${label} manifest drift`);
  for (const [relative, expected] of projection) {
    const target = ownedPath(root, relative);
    if (!existsSync(target) || readFileSync(target, "utf8") !== expected)
      fail(`${label}/${relative} drift`);
  }
}

const mode =
  process.argv[2] === "--check" ? "check" : (process.argv[2] ?? "sync");
const { claude, cursor } = projections();
if (mode === "sync") {
  preflightOne(claudeRoot, claude);
  preflightOne(cursorRoot, cursor);
  syncOne(claudeRoot, claude);
  syncOne(cursorRoot, cursor);
  console.log(
    `sync-rules: projected ${claude.size} Claude and ${cursor.size} Cursor files.`,
  );
} else if (mode === "check") {
  preflightOne(claudeRoot, claude);
  preflightOne(cursorRoot, cursor);
  checkOne(claudeRoot, claude, ".claude/rules");
  checkOne(cursorRoot, cursor, ".cursor/rules");
  console.log(
    `sync-rules: ${claude.size} Claude and ${cursor.size} Cursor files in sync.`,
  );
} else fail(`unknown mode ${JSON.stringify(mode)} (use sync or check)`);
