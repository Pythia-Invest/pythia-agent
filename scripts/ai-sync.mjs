#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  lstatSync,
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
const sourceRoot = path.join(repoRoot, ".agents", "skills");
const targetRoot = process.env.PYTHIA_AGENT_CLAUDE_SKILLS_ROOT
  ? path.resolve(process.env.PYTHIA_AGENT_CLAUDE_SKILLS_ROOT)
  : path.join(repoRoot, ".claude", "skills");
const toolRoot =
  path.basename(targetRoot) === "skills"
    ? path.dirname(targetRoot)
    : targetRoot;
const manifestName = ".pythia-agent-generated.json";
const toolBlock =
  /<!--\s*tool:([\w,-]+)\s*-->([\s\S]*?)<!--\s*\/tool:\1\s*-->/g;

function fail(message) {
  throw new Error(`ai-sync: ${message}`);
}

function walkFiles(root, directory = root, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(root, absolute, output);
    else if (entry.isFile()) output.push(path.relative(root, absolute));
  }
  return output;
}

function projectMarkdown(markdown) {
  return markdown.replace(toolBlock, (_match, tools, body) =>
    tools
      .split(",")
      .map((tool) => tool.trim())
      .includes("claude")
      ? body
      : "",
  );
}

function expectedProjection() {
  if (!existsSync(sourceRoot))
    fail("missing canonical .agents/skills directory");
  const output = new Map();
  for (const relative of walkFiles(sourceRoot).sort()) {
    const source = path.join(sourceRoot, relative);
    const content = readFileSync(source);
    output.set(
      relative,
      relative.endsWith(".md")
        ? projectMarkdown(content.toString("utf8"))
        : content,
    );
  }
  return output;
}

function manifestEntries() {
  const manifest = path.join(targetRoot, manifestName);
  if (!existsSync(manifest)) return [];
  if (lstatSync(manifest).isSymbolicLink())
    fail(`refusing symlinked manifest ${manifest}`);
  const parsed = JSON.parse(readFileSync(manifest, "utf8"));
  if (
    !Array.isArray(parsed.files) ||
    parsed.files.some((item) => typeof item !== "string")
  ) {
    fail(`invalid owned-file manifest at ${manifest}`);
  }
  return parsed.files;
}

function ownedPath(relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
    fail(`unsafe owned path ${JSON.stringify(relative)}`);
  }
  return path.join(targetRoot, relative);
}

function assertSafePath(relative) {
  let current = targetRoot;
  if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
    fail(`refusing symlinked target root ${current}`);
  }
  for (const part of relative.split(/[\\/]/)) {
    current = path.join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      fail(`refusing symlinked destination ${current}`);
    }
  }
}

function preflight(projection) {
  if (existsSync(toolRoot) && lstatSync(toolRoot).isSymbolicLink()) {
    fail(`refusing symlinked tool root ${toolRoot}`);
  }
  if (existsSync(targetRoot) && lstatSync(targetRoot).isSymbolicLink()) {
    fail(`refusing symlinked target root ${targetRoot}`);
  }
  const owned = new Set(manifestEntries());
  for (const relative of [...owned, ...projection.keys()])
    assertSafePath(relative);
  for (const relative of projection.keys()) {
    if (existsSync(ownedPath(relative)) && !owned.has(relative)) {
      fail(`refusing to overwrite unowned destination ${relative}`);
    }
  }
}

function check(projection) {
  preflight(projection);
  const problems = [];
  const listed = manifestEntries();
  if (JSON.stringify(listed) !== JSON.stringify([...projection.keys()])) {
    problems.push("owned-file manifest differs from canonical skills");
  }
  for (const [relative, expected] of projection) {
    const target = ownedPath(relative);
    if (!existsSync(target)) problems.push(`missing ${relative}`);
    else {
      const actual = readFileSync(target);
      const expectedBuffer = Buffer.isBuffer(expected)
        ? expected
        : Buffer.from(expected);
      if (!actual.equals(expectedBuffer)) problems.push(`drifted ${relative}`);
    }
  }
  if (problems.length > 0)
    fail(`${problems.join("; ")}. Run the skill sync command.`);
  console.log(`ai-sync: ${projection.size} Claude skill files in sync.`);
}

function sync(projection) {
  preflight(projection);
  mkdirSync(targetRoot, { recursive: true });
  const next = new Set(projection.keys());
  for (const relative of manifestEntries()) {
    if (!next.has(relative)) {
      const target = ownedPath(relative);
      if (existsSync(target)) unlinkSync(target);
    }
  }
  for (const [relative, content] of projection) {
    const target = ownedPath(relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  writeFileSync(
    path.join(targetRoot, manifestName),
    `${JSON.stringify({ files: [...projection.keys()] }, null, 2)}\n`,
  );
  console.log(`ai-sync: projected ${projection.size} Claude skill files.`);
}

const mode =
  process.argv[2] === "--check" ? "check" : (process.argv[2] ?? "sync");
const projection = expectedProjection();
if (mode === "check") check(projection);
else if (mode === "sync") sync(projection);
else fail(`unknown mode ${JSON.stringify(mode)} (use sync or check)`);
