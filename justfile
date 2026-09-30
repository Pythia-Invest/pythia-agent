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
check: check-static check-types check-build

# Seconds-fast policy checks: format, lint, structure, boundaries, public source, workflows.
check-static:
    node tooling/run-biome.mjs
    PYTHONPYCACHEPREFIX=.local/pycache python3 -m compileall -q runtime/managed tooling
    bash -n install.sh scripts/install/platform.sh scripts/install/preflight.sh
    node tooling/check-structure.mjs
    node tooling/check-boundaries.mjs
    python3 tooling/reference-builder/check_names.py
    node tooling/check-public-source.mjs
    node tooling/check-tests.mjs
    just check-ai-workspace
    node tooling/check-workflows.mjs

# Production and test type surfaces of every workspace.
check-types:
    pnpm run check:types
    pnpm run check

# Production builds and the installed-runtime closure that reads them.
check-build:
    pnpm run build:runtime
    env -i HOME="$HOME" PATH="$PATH" LANG="${LANG:-C.UTF-8}" TMPDIR="${TMPDIR:-/tmp}" NEXT_TELEMETRY_DISABLED=1 node tooling/run-turbo.mjs build --env-mode=loose
    node tooling/check-runtime-closure.mjs

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
# Both halves always run, so a red test file cannot hide the assembled run.
qualify:
    pnpm run build
    status=0; just qualify-tests || status=1; just qualify-assembled || status=1; exit "$status"

# Qualification test files (after a build).
qualify-tests:
    pnpm run test:qualification

# Fetch the pinned, verified Hermes archive into the qualification archive cache.
qualify-archive directory:
    node tooling/qualification/fetch-hermes-archive.mjs "{{directory}}"

# Assembled cross-workspace qualification (after a build).
qualify-assembled:
    pnpm run test:qualification:assembled

# Regenerate Desk's Hermes goldens from the pinned Hermes, provider-free (ADR 0020).
capture-hermes:
    pnpm run capture:hermes

# Fail when committed Hermes goldens differ from a fresh pinned capture.
check-hermes-capture:
    pnpm run check:hermes-capture

# Desk browser tests against this checkout's built Desk with no Hermes (run check-build first).
test-e2e-hermetic *args:
    node apps/desk/e2e/hermetic.mjs {{args}}

# Build Desk and the workspaces it depends on (what the hermetic browser tests need).
build-desk:
    env -i HOME="$HOME" PATH="$PATH" LANG="${LANG:-C.UTF-8}" TMPDIR="${TMPDIR:-/tmp}" NEXT_TELEMETRY_DISABLED=1 pnpm exec turbo run build --filter=@pythia/desk... --env-mode=loose

# Every Desk browser test, including e2e/live, against a Desk that is already running (see `just dev-paths`).
test-e2e desk_url:
    PYTHIA_DESK_URL="{{desk_url}}" pnpm --filter @pythia/desk test:e2e

# Opt-in live agent eval against a running Desk: it uses the investor's model and sources, so never in CI.
agent-eval desk_url *ids:
    python3 tooling/agent-eval/run.py "{{desk_url}}" {{ids}}

# Build the open reference snapshot from public sources (network; see tooling/reference-builder/README.md).
reference-snapshot *args:
    python3 tooling/reference-builder/run.py {{args}}

# Verify a reference package (directory or package.json) and install it for this worktree's stack.
reference-install package:
    node scripts/dev/cli.mjs reference-install "{{package}}"

# Show the reference package installed for this worktree's stack.
reference-status:
    node scripts/dev/cli.mjs reference-status

# Set this worktree's installed reference package aside: search and pages read the device's subjects alone.
reference-remove:
    node scripts/dev/cli.mjs reference-remove

# Score a reference snapshot against the identity truth set; fails on regressions against the committed baseline.
reference-audit *args:
    python3 tooling/reference-builder/audit.py {{args}}

# Fingerprint SEC submissions and companyfacts for the frozen audit sample (network; fails on drift).
reference-sec-probe *args:
    PYTHONPATH=tooling/reference-builder python3 -m reference_builder.sec_probe {{args}}

# Re-run the SEC onboarding audit: fetch (network) fills the cache; draw and label read only the cache.
reference-sec-audit step *args:
    PYTHONPATH=tooling/reference-builder python3 -m reference_builder.sec_audit {{step}} {{args}}

# Check core's curated crypto assets against CoinGecko and CoinMarketCap (network; fails on drift).
canonical-assets-drift *args:
    PYTHONPATH=tooling/reference-builder python3 -m reference_builder.drift {{args}}

# Production dependency advisories (needs the registry).
audit:
    pnpm audit --prod --audit-level high

# Every dependency's advisories, including development tools (needs the registry).
audit-all:
    pnpm audit --audit-level high

# Run the repository's focused Biome check.
lint:
    node tooling/run-biome.mjs

# Prepare the exact pinned runtimes and this worktree's isolated native state.
dev-init:
    node scripts/dev/cli.mjs init

# Recover only a transaction-owned profile left by interrupted first initialization.
dev-init-recover:
    node scripts/dev/cli.mjs init-recover

# Run Hermes and Desk under one foreground owner.
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
