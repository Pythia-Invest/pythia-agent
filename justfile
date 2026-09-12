set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
export NEXT_TELEMETRY_DISABLED := "1"

default:
    @just --list

# Create or attach a managed sibling worktree for an existing branch.
worktree branch:
    node scripts/worktree.mjs create {{branch}}

# List this repository's registered Git worktrees.
worktree-list:
    node scripts/worktree.mjs list

# Remove a clean managed sibling worktree for a branch.
worktree-remove branch:
    node scripts/worktree.mjs remove {{branch}}

# Find clean managed worktrees whose remote branch is gone and offer to remove them.
worktree-prune:
    node scripts/worktree.mjs prune

# Hydrate exactly the committed JavaScript development dependency graph.
bootstrap:
    pnpm install --frozen-lockfile

# Deterministic local checks only: never tests or contacts a package registry.
check:
    node tooling/run-biome.mjs
    PYTHONPYCACHEPREFIX=.local/pycache python3 -m compileall -q runtime/managed tooling
    bash -n install.sh scripts/install/platform.sh scripts/install/preflight.sh
    node tooling/check-structure.mjs
    node tooling/check-boundaries.mjs
    pnpm run check:types
    pnpm run check
    pnpm run build:runtime
    env -i HOME="$HOME" PATH="$PATH" LANG="${LANG:-C.UTF-8}" TMPDIR="${TMPDIR:-/tmp}" NEXT_TELEMETRY_DISABLED=1 node tooling/run-turbo.mjs build --env-mode=loose
    node tooling/check-public-source.mjs
    node tooling/check-runtime-closure.mjs
    just check-ai-workspace
    node tooling/check-workflows.mjs

# Ordinary pull-request tests: focused behavior plus the platform lifecycle smoke.
test:
    pnpm run test

# Deterministic behavior and contract tests without the platform smoke.
test-fast:
    pnpm run test:fast

# Real-process lifecycle behavior selected for macOS and Ubuntu.
test-system:
    pnpm run test:system

# Broad assembled, installation and update evidence outside the ordinary PR loop.
qualify:
    pnpm run test:qualification

# Desk browser smoke tests against a Desk that is already running (see `just dev-paths`).
test-e2e desk_url:
    PYTHIA_DESK_URL="{{desk_url}}" pnpm --filter @pythia/desk test:e2e

# The only registry/network dependency check.
audit:
    pnpm audit --prod --audit-level high

# Run the repository's focused Biome check.
lint:
    node tooling/run-biome.mjs

# Prepare the exact pinned runtimes and this worktree's isolated native state.
dev-init:
    node scripts/dev/cli.mjs init

# Recover only a transaction-owned profile left by interrupted first initialization.
dev-init-recover:
    node scripts/dev/cli.mjs init-recover

# Run Hermes, Basic Memory, and Desk under one foreground owner.
dev:
    node scripts/dev/cli.mjs dev

# Reprepare managed inputs and replace this worktree's selected foreground stack.
dev-refresh:
    node scripts/dev/cli.mjs refresh

# Inspect only the development stack derived from this worktree.
status:
    node scripts/dev/cli.mjs status

# Gracefully stop only this worktree's owner-verified foreground stack.
stop:
    node scripts/dev/cli.mjs stop

# Remove only this worktree's disposable derived state and fetch caches.
dev-reset:
    node scripts/dev/cli.mjs reset

# Add native OAuth or API-key credentials in Hermes's shared development store.
auth provider type="oauth":
    node scripts/dev/cli.mjs auth "{{provider}}" "{{type}}"

# Choose shared development model defaults through native Hermes.
model:
    node scripts/dev/cli.mjs model

# Show Hermes's redacted native readiness for the selected provider.
auth-status provider:
    node scripts/dev/cli.mjs auth-status "{{provider}}"

# Print this worktree's deterministic paths and loopback ports (never secrets).
dev-paths:
    node scripts/dev/cli.mjs paths

# Project canonical builder skills for Claude Code into ignored local files.
ai-sync:
    node scripts/ai-sync.mjs

# Check the installed Claude skill projection without changing it.
check-skills:
    node scripts/ai-sync.mjs --check

# Project canonical builder roles into ignored Claude Code and Codex files.
sync-agents:
    node scripts/sync-agents.mjs

# Check the installed Claude and Codex role projections without changing them.
check-agents:
    node scripts/sync-agents.mjs --check

# Project canonical builder rules into ignored Claude Code and Cursor files.
sync-rules:
    node scripts/sync-rules.mjs

# Check the installed Claude and Cursor rule projections without changing them.
check-rules:
    node scripts/sync-rules.mjs --check

# Project every adapter needed by locally installed builder tools.
builder-sync: ai-sync sync-agents sync-rules

# Opt in to repository Git hooks that re-run builder-sync after checkout and merge.
setup-hooks:
    git config core.hooksPath .githooks
    just builder-sync

# Check canonical builder source and exercise every adapter in a disposable root.
check-ai-workspace:
    node tooling/check-ai-workspace.mjs
    root="$(mktemp -d)"; trap 'rm -rf "$root"' EXIT; env PYTHIA_AGENT_CLAUDE_SKILLS_ROOT="$root/claude/skills" PYTHIA_AGENT_CLAUDE_AGENTS_ROOT="$root/claude/agents" PYTHIA_AGENT_CODEX_AGENTS_ROOT="$root/codex/agents" PYTHIA_AGENT_CLAUDE_RULES_ROOT="$root/claude/rules" PYTHIA_AGENT_CURSOR_RULES_ROOT="$root/cursor/rules" node scripts/ai-sync.mjs; env PYTHIA_AGENT_CLAUDE_SKILLS_ROOT="$root/claude/skills" node scripts/ai-sync.mjs --check; env PYTHIA_AGENT_CLAUDE_AGENTS_ROOT="$root/claude/agents" PYTHIA_AGENT_CODEX_AGENTS_ROOT="$root/codex/agents" node scripts/sync-agents.mjs; env PYTHIA_AGENT_CLAUDE_AGENTS_ROOT="$root/claude/agents" PYTHIA_AGENT_CODEX_AGENTS_ROOT="$root/codex/agents" node scripts/sync-agents.mjs --check; env PYTHIA_AGENT_CLAUDE_RULES_ROOT="$root/claude/rules" PYTHIA_AGENT_CURSOR_RULES_ROOT="$root/cursor/rules" node scripts/sync-rules.mjs; env PYTHIA_AGENT_CLAUDE_RULES_ROOT="$root/claude/rules" PYTHIA_AGENT_CURSOR_RULES_ROOT="$root/cursor/rules" node scripts/sync-rules.mjs --check
