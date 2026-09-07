#!/bin/sh
# Run the repository's builder adapters without failing the Git operation.
# Activated per clone with `just setup-hooks`; see docs/development.md.
command -v node >/dev/null 2>&1 || exit 0
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
for script in ai-sync sync-agents sync-rules; do
  [ -f "$root/scripts/$script.mjs" ] || continue
  node "$root/scripts/$script.mjs" || echo "builder hooks: $script failed; run just builder-sync" >&2
done
exit 0
