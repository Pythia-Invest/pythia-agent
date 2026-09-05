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
const sourceRoot = path.join(repoRoot, ".agents", "agents");
const claudeRoot = process.env.PYTHIA_AGENT_CLAUDE_AGENTS_ROOT
  ? path.resolve(process.env.PYTHIA_AGENT_CLAUDE_AGENTS_ROOT)
  : path.join(repoRoot, ".claude", "agents");
const codexRoot = process.env.PYTHIA_AGENT_CODEX_AGENTS_ROOT
  ? path.resolve(process.env.PYTHIA_AGENT_CODEX_AGENTS_ROOT)
  : path.join(repoRoot, ".codex", "agents");
const manifestName = ".pythia-agent-generated.json";
const toolBlock =
  /<!--\s*tool:([\w,-]+)\s*-->([\s\S]*?)<!--\s*\/tool:\1\s*-->/g;

function fail(message) {
  throw new Error(`sync-agents: ${message}`);
}

function parse(markdown, filename) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) fail(`${filename} has no frontmatter`);
  const metadata = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    metadata.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    );
  }
  const value = (key) => (metadata.get(key) ?? "").replace(/^['"]|['"]$/g, "");
  const compatibility = value("compatibility")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return { metadata, value, compatibility, body: match[2] };
}

function toolContent(markdown, tool) {
  return markdown.replace(toolBlock, (_match, tools, body) =>
    tools
      .split(",")
      .map((name) => name.trim())
      .includes(tool)
      ? body
      : "",
  );
}

function claudeProjection(markdown, filename) {
  const parsed = parse(markdown, filename);
  const kept = [...parsed.metadata]
    .filter(([key]) => key !== "compatibility" && key !== "codexSandbox")
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${kept.join("\n")}\n---\n${toolContent(parsed.body, "claude")}`;
}

function codexProjection(markdown, filename) {
  const parsed = parse(markdown, filename);
  if (!parsed.compatibility.includes("codex")) return null;
  const name = parsed.value("name") || filename.replace(/\.md$/, "");
  const description = parsed.value("description");
  const sandbox = parsed.value("codexSandbox");
  const instructions = `${toolContent(parsed.body, "codex").trim()}\n`;
  if (!description || !instructions.trim())
    fail(`${filename} lacks Codex role content`);
  const lines = [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
  ];
  if (sandbox) lines.push(`sandbox_mode = ${JSON.stringify(sandbox)}`);
  lines.push(`developer_instructions = ${JSON.stringify(instructions)}`, "");
  return lines.join("\n");
}

function projections() {
  if (!existsSync(sourceRoot))
    fail("missing canonical .agents/agents directory");
  const claude = new Map();
  const codex = new Map();
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const markdown = readFileSync(path.join(sourceRoot, entry.name), "utf8");
    claude.set(entry.name, claudeProjection(markdown, entry.name));
    const projected = codexProjection(markdown, entry.name);
    if (projected !== null)
      codex.set(entry.name.replace(/\.md$/, ".toml"), projected);
  }
  if (claude.size === 0) fail("no canonical roles found");
  return { claude, codex };
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
  const toolRoot = path.basename(root) === "agents" ? path.dirname(root) : root;
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
  const listed = manifestEntries(root);
  if (JSON.stringify(listed) !== JSON.stringify([...projection.keys()]))
    fail(`${label} manifest drift`);
  for (const [relative, expected] of projection) {
    const target = ownedPath(root, relative);
    if (!existsSync(target) || readFileSync(target, "utf8") !== expected)
      fail(`${label}/${relative} drift`);
  }
}

const mode =
  process.argv[2] === "--check" ? "check" : (process.argv[2] ?? "sync");
const { claude, codex } = projections();
if (mode === "sync") {
  preflightOne(claudeRoot, claude);
  preflightOne(codexRoot, codex);
  syncOne(claudeRoot, claude);
  syncOne(codexRoot, codex);
  console.log(
    `sync-agents: projected ${claude.size} Claude and ${codex.size} Codex roles.`,
  );
} else if (mode === "check") {
  preflightOne(claudeRoot, claude);
  preflightOne(codexRoot, codex);
  checkOne(claudeRoot, claude, ".claude/agents");
  checkOne(codexRoot, codex, ".codex/agents");
  console.log(
    `sync-agents: ${claude.size} Claude and ${codex.size} Codex roles in sync.`,
  );
} else fail(`unknown mode ${JSON.stringify(mode)} (use sync or check)`);
