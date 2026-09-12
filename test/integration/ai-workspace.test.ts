import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertNoTrackedPrivate,
  assertPublicDecisionDocument,
} from "../../tooling/check-ai-workspace.mjs";

const repository = path.resolve(import.meta.dirname, "../..");
const temporaryRoots: string[] = [];

function temporaryRoot(label: string) {
  const root = mkdtempSync(path.join(tmpdir(), `pythia-agent-${label}-`));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("public development-agent workspace", () => {
  test("copy adapters preserve unknown files and Codex multiline role instructions", () => {
    const root = temporaryRoot("adapters");
    const targets = {
      PYTHIA_AGENT_CLAUDE_SKILLS_ROOT: path.join(root, "claude-skills"),
      PYTHIA_AGENT_CLAUDE_AGENTS_ROOT: path.join(root, "claude-agents"),
      PYTHIA_AGENT_CODEX_AGENTS_ROOT: path.join(root, "codex-agents"),
      PYTHIA_AGENT_CLAUDE_RULES_ROOT: path.join(root, "claude-rules"),
      PYTHIA_AGENT_CURSOR_RULES_ROOT: path.join(root, "cursor-rules"),
    };
    const environment = { ...process.env, ...targets };

    for (const script of ["ai-sync.mjs", "sync-agents.mjs", "sync-rules.mjs"]) {
      execFileSync("node", [path.join(repository, "scripts", script)], {
        env: environment,
      });
    }

    const userFile = path.join(
      targets.PYTHIA_AGENT_CLAUDE_AGENTS_ROOT,
      "user-owned.toml",
    );
    writeFileSync(userFile, "user-owned = true\n");
    execFileSync(
      "node",
      [path.join(repository, "scripts", "sync-agents.mjs")],
      { env: environment },
    );
    expect(readFileSync(userFile, "utf8")).toBe("user-owned = true\n");

    for (const [script, checkRoots] of [
      ["ai-sync.mjs", [targets.PYTHIA_AGENT_CLAUDE_SKILLS_ROOT]],
      [
        "sync-agents.mjs",
        [
          targets.PYTHIA_AGENT_CLAUDE_AGENTS_ROOT,
          targets.PYTHIA_AGENT_CODEX_AGENTS_ROOT,
        ],
      ],
      [
        "sync-rules.mjs",
        [
          targets.PYTHIA_AGENT_CLAUDE_RULES_ROOT,
          targets.PYTHIA_AGENT_CURSOR_RULES_ROOT,
        ],
      ],
    ] as const) {
      execFileSync(
        "node",
        [path.join(repository, "scripts", script), "--check"],
        { env: environment },
      );
      for (const checkRoot of checkRoots)
        expect(existsSync(checkRoot)).toBe(true);
    }

    const rolePath = path.join(
      targets.PYTHIA_AGENT_CODEX_AGENTS_ROOT,
      "reviewer.toml",
    );
    const parsed = JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          "import json,pathlib,sys,tomllib; print(json.dumps(tomllib.loads(pathlib.Path(sys.argv[1]).read_text())))",
          rolePath,
        ],
        { encoding: "utf8" },
      ),
    ) as Record<string, unknown>;
    expect(parsed.name).toBe("reviewer");
    expect(parsed.description).toBe(
      "Independently reviews frozen changes for correctness, scope, boundaries, and missing evidence.",
    );
    expect(parsed.sandbox_mode).toBe("read-only");
    const canonicalRole = readFileSync(
      path.join(repository, ".agents/agents/reviewer.md"),
      "utf8",
    ).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "");
    expect(parsed.developer_instructions).toBe(`${canonicalRole.trim()}\n`);
  });

  test("every adapter refuses a same-name unowned destination before writing", () => {
    const cases = [
      {
        script: "ai-sync.mjs",
        collisionRoot: "PYTHIA_AGENT_CLAUDE_SKILLS_ROOT",
        relative: path.join("commit", "SKILL.md"),
      },
      {
        script: "sync-agents.mjs",
        collisionRoot: "PYTHIA_AGENT_CLAUDE_AGENTS_ROOT",
        relative: "implementer.md",
      },
      {
        script: "sync-rules.mjs",
        collisionRoot: "PYTHIA_AGENT_CLAUDE_RULES_ROOT",
        relative: "agent-instruction-design.md",
      },
    ] as const;

    for (const [index, fixture] of cases.entries()) {
      const root = temporaryRoot(`collision-${index}`);
      const targets = {
        PYTHIA_AGENT_CLAUDE_SKILLS_ROOT: path.join(root, "claude-skills"),
        PYTHIA_AGENT_CLAUDE_AGENTS_ROOT: path.join(root, "claude-agents"),
        PYTHIA_AGENT_CODEX_AGENTS_ROOT: path.join(root, "codex-agents"),
        PYTHIA_AGENT_CLAUDE_RULES_ROOT: path.join(root, "claude-rules"),
        PYTHIA_AGENT_CURSOR_RULES_ROOT: path.join(root, "cursor-rules"),
      };
      const collision = path.join(
        targets[fixture.collisionRoot],
        fixture.relative,
      );
      mkdirSync(path.dirname(collision), { recursive: true });
      writeFileSync(collision, "user-owned\n");

      expect(() =>
        execFileSync(
          "node",
          [path.join(repository, "scripts", fixture.script)],
          {
            env: { ...process.env, ...targets },
            stdio: "pipe",
          },
        ),
      ).toThrow();
      expect(readFileSync(collision, "utf8")).toBe("user-owned\n");
      expect(
        existsSync(
          path.join(path.dirname(collision), ".pythia-agent-generated.json"),
        ),
      ).toBe(false);
    }
  });

  test("the skill adapter refuses symlinked tool roots and destinations", () => {
    const root = temporaryRoot("symlink");
    const outsideTool = path.join(root, "outside-tool");
    const toolRoot = path.join(root, ".claude");
    mkdirSync(outsideTool, { recursive: true });
    symlinkSync(outsideTool, toolRoot, "dir");

    expect(() =>
      execFileSync("node", [path.join(repository, "scripts", "ai-sync.mjs")], {
        env: {
          ...process.env,
          PYTHIA_AGENT_CLAUDE_SKILLS_ROOT: path.join(toolRoot, "skills"),
        },
        stdio: "pipe",
      }),
    ).toThrow();
    expect(existsSync(path.join(outsideTool, "skills"))).toBe(false);

    const targetRoot = path.join(root, "plain-target");
    const outsideDestination = path.join(root, "outside-destination");
    mkdirSync(targetRoot, { recursive: true });
    mkdirSync(outsideDestination, { recursive: true });
    symlinkSync(outsideDestination, path.join(targetRoot, "commit"), "dir");

    expect(() =>
      execFileSync("node", [path.join(repository, "scripts", "ai-sync.mjs")], {
        env: {
          ...process.env,
          PYTHIA_AGENT_CLAUDE_SKILLS_ROOT: targetRoot,
        },
        stdio: "pipe",
      }),
    ).toThrow();
    expect(existsSync(path.join(outsideDestination, "SKILL.md"))).toBe(false);
  });

  test("an ignored private record is paired with a self-contained public decision", () => {
    const root = temporaryRoot("decision");
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    copyFileSync(
      path.join(repository, ".gitignore"),
      path.join(root, ".gitignore"),
    );
    const privateRecord = path.join(
      root,
      ".private",
      "plans",
      "feature",
      "grilling-feature.md",
    );
    mkdirSync(path.dirname(privateRecord), { recursive: true });
    writeFileSync(
      privateRecord,
      "# Working record\n\nQ1: keep one public repository.\n",
    );

    const decision = `# 0001: One public source\n\n## Context\nContributors need ordinary workflows without an internal archive.\n\n## Ruling\nThe public monorepo is implementation authority; raw working records remain ignored.\n\n## Rationale\nOne source avoids synchronized repositories and exposes the reasons contributors need.\n\n## Consequences\nAccepted decisions are distilled into public documentation before material completion.\n\n## Rejected alternatives\nPublishing raw records and depending on a private planning repository were rejected.\n`;
    const publicDecision = path.join(
      root,
      "docs",
      "decisions",
      "0001-public-source.md",
    );
    mkdirSync(path.dirname(publicDecision), { recursive: true });
    writeFileSync(publicDecision, decision);

    const ignored = execFileSync(
      "git",
      [
        "check-ignore",
        "--verbose",
        ".private/plans/feature/grilling-feature.md",
      ],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    expect(ignored).toContain("/.private/");
    expect(() =>
      assertPublicDecisionDocument(
        readFileSync(publicDecision, "utf8"),
        publicDecision,
      ),
    ).not.toThrow();
    expect(() => assertNoTrackedPrivate(root)).not.toThrow();

    execFileSync(
      "git",
      ["add", "--force", ".private/plans/feature/grilling-feature.md"],
      { cwd: root },
    );
    expect(() => assertNoTrackedPrivate(root)).toThrow(
      /private working records are tracked/,
    );
  });
});
