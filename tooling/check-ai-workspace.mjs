import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const expectedSkills = [
  "commit",
  "create-plan",
  "create-pr",
  "create-rule",
  "create-skill",
  "create-test-plan",
  "grill-me",
  "implement-plan",
  "mergeprep",
  "resolve-conflicts",
  "review",
  "run-test-plan",
];
const expectedAgents = ["implementer.md", "researcher.md", "reviewer.md"];
const builderAgentRoots = [
  ".agents",
  "apps/design-lab",
  "apps/desk",
  "packages/ui",
  "runtime",
];

function fail(message) {
  throw new Error(`check-ai-workspace: ${message}`);
}

function walk(root, directory = root, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      fail(`symlink is not allowed: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) walk(root, absolute, output);
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

function section(markdown, title) {
  const lines = markdown.split(/\r?\n/);
  const heading = lines.findIndex(
    (line) =>
      line
        .replace(/^##?\s+/, "")
        .trim()
        .toLowerCase() === title.toLowerCase(),
  );
  if (heading < 0) return "";
  const next = lines.findIndex(
    (line, index) => index > heading && /^##?\s+/.test(line),
  );
  return lines
    .slice(heading + 1, next < 0 ? undefined : next)
    .join("\n")
    .trim();
}

export function assertPublicDecisionDocument(markdown, label = "decision") {
  for (const heading of [
    "Context",
    "Ruling",
    "Rationale",
    "Consequences",
    "Rejected alternatives",
  ]) {
    if (!section(markdown, heading))
      fail(`${label} lacks a non-empty ${heading} section`);
  }
}

export function assertNoTrackedPrivate(root) {
  const tracked = execFileSync(
    "git",
    ["ls-files", "--cached", "--", ".private"],
    {
      cwd: root,
      encoding: "utf8",
    },
  ).trim();
  if (tracked)
    fail(
      `private working records are tracked: ${tracked.split("\n").join(", ")}`,
    );
}

function parseInstructionFrontmatter(markdown, relative) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) fail(`${relative} lacks frontmatter`);
  const name = match[1].match(/^name:\s*([^\r\n]+)$/m)?.[1].trim();
  const description = match[1]
    .match(/^description:\s*([^\r\n]+)$/m)?.[1]
    .trim();
  if (!name || !description) fail(`${relative} requires name and description`);
  return name;
}

function checkReferences(root, markdownFiles) {
  for (const file of markdownFiles) {
    const markdown = readFileSync(file, "utf8");
    const links = [...markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(
      (match) => match[1],
    );
    for (const link of links) {
      if (/^(?:https?:|#|mailto:)/.test(link)) continue;
      const targetText = link.split("#")[0];
      const target = targetText.startsWith(".")
        ? path.resolve(path.dirname(file), targetText)
        : path.resolve(root, targetText);
      if (!existsSync(target))
        fail(`${path.relative(root, file)} has unresolved link ${link}`);
    }
    const codeReferences = [...markdown.matchAll(/`([^`\r\n]+\.md)`/g)].map(
      (match) => match[1],
    );
    for (const reference of codeReferences) {
      if (/[<>{}*]/.test(reference) || reference.startsWith(".private/"))
        continue;
      let target;
      if (reference.startsWith("references/")) {
        target = path.resolve(path.dirname(file), reference);
      } else if (
        reference.startsWith(".agents/") ||
        reference.startsWith("docs/")
      ) {
        target = path.resolve(root, reference);
      } else if (reference === "AGENTS.md") {
        target = path.resolve(root, reference);
      } else {
        continue;
      }
      if (!existsSync(target)) {
        fail(
          `${path.relative(root, file)} has unresolved code reference ${reference}`,
        );
      }
    }
  }
}

function checkInstructionTopology(root) {
  const agentRoot = path.join(root, ".agents");
  for (const file of walk(agentRoot)) {
    if (lstatSync(file).isSymbolicLink())
      fail(`symlink is not allowed: ${path.relative(root, file)}`);
  }

  const skillRoot = path.join(agentRoot, "skills");
  const skills = readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const missingSkills = expectedSkills.filter(
    (skill) => !skills.includes(skill),
  );
  if (missingSkills.length > 0) {
    fail(`missing required curated skills: ${missingSkills.join(", ")}`);
  }
  for (const skill of skills) {
    const skillFile = path.join(skillRoot, skill, "SKILL.md");
    if (!existsSync(skillFile)) fail(`${skill}/SKILL.md is missing`);
    const name = parseInstructionFrontmatter(
      readFileSync(skillFile, "utf8"),
      path.relative(root, skillFile),
    );
    if (name !== skill)
      fail(`${skill}/SKILL.md declares name ${JSON.stringify(name)}`);
  }

  const agentFiles = readdirSync(path.join(agentRoot, "agents"))
    .filter((name) => name.endsWith(".md"))
    .sort();
  const missingAgents = expectedAgents.filter(
    (agent) => !agentFiles.includes(agent),
  );
  if (missingAgents.length > 0) {
    fail(`missing required agent definitions: ${missingAgents.join(", ")}`);
  }
  for (const agent of agentFiles) {
    const agentPath = path.join(agentRoot, "agents", agent);
    const name = parseInstructionFrontmatter(
      readFileSync(agentPath, "utf8"),
      path.relative(root, agentPath),
    );
    if (name !== agent.replace(/\.md$/, "")) {
      fail(
        `${path.relative(root, agentPath)} declares name ${JSON.stringify(name)}`,
      );
    }
  }

  for (const relativeRoot of builderAgentRoots) {
    const agents = path.join(root, relativeRoot, "AGENTS.md");
    const claude = path.join(root, relativeRoot, "CLAUDE.md");
    if (!existsSync(agents)) fail(`${path.relative(root, agents)} is missing`);
    if (
      !existsSync(claude) ||
      readFileSync(claude, "utf8").trim() !== "@AGENTS.md"
    ) {
      fail(`${path.relative(root, claude)} must be a thin @AGENTS.md pointer`);
    }
  }

  const rootGuidance = readFileSync(path.join(root, "AGENTS.md"), "utf8");
  if (
    !/must not automatically\s+inject/.test(rootGuidance) ||
    !/approved source\s+maintenance may read/.test(rootGuidance)
  ) {
    fail(
      "root guidance must distinguish automatic runtime injection from approved source reading",
    );
  }

  const allMarkdown = walk(agentRoot).filter((file) => file.endsWith(".md"));
  checkReferences(root, allMarkdown);
  assertPublicDecisionDocument(
    readFileSync(path.join(agentRoot, "README.md"), "utf8"),
    ".agents/README.md",
  );

  const combined = allMarkdown
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  for (const forbidden of [
    "Pythia Invest",
    "pythia-invest",
    "apps/web",
    "apps/worker",
    "fleet/",
    "SSM-backed",
    "Postgres holds",
  ]) {
    if (combined.includes(forbidden))
      fail(`private architecture dependency remains: ${forbidden}`);
  }

  for (const skill of ["create-plan", "implement-plan"]) {
    const markdown = readFileSync(
      path.join(skillRoot, skill, "SKILL.md"),
      "utf8",
    );
    for (const term of [
      "context",
      "ruling",
      "rationale",
      "consequences",
      "rejected alternatives",
    ]) {
      if (!markdown.toLowerCase().includes(term))
        fail(`${skill} lacks public decision field ${term}`);
    }
  }

  for (const script of ["ai-sync.mjs", "sync-agents.mjs", "sync-rules.mjs"]) {
    const source = readFileSync(path.join(root, "scripts", script), "utf8");
    if (source.includes("runtime/seeds") || source.includes(".private")) {
      fail(
        `${script} must not inspect or project runtime seeds/private records`,
      );
    }
    if (/rmSync\([^\n]*recursive:\s*true/.test(source)) {
      fail(`${script} must not recursively delete a tool directory`);
    }
  }

  const ignore = readFileSync(path.join(root, ".gitignore"), "utf8");
  for (const pattern of ["/.private/", "/.claude/", "/.codex/", "/.cursor/"]) {
    if (!ignore.split(/\r?\n/).includes(pattern))
      fail(`.gitignore lacks ${pattern}`);
  }
  assertNoTrackedPrivate(root);
  return { skills: skills.length, agents: agentFiles.length };
}

export function checkAiWorkspace(root) {
  return checkInstructionTopology(path.resolve(root));
}

const invoked =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const rootArg =
    process.argv[2] === "--root" ? process.argv[3] : process.cwd();
  const result = checkAiWorkspace(rootArg);
  console.log(
    `check-ai-workspace: ${result.skills} skills, ${result.agents} roles, and public/private boundaries passed.`,
  );
}
