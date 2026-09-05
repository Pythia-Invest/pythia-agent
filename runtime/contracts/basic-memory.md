# Basic Memory contract

Pythia uses Basic Memory 0.23.2, unmodified, as a separately supervised AGPL
process on loopback. It does not copy its code, load its Hermes memory-provider
integration, install the official Hermes memory-provider plugin, or treat its SQLite database as authority. User-owned Markdown is
authoritative; the database and search index are disposable and rebuildable.

## Configuration and launch

The service receives a unique absolute `BASIC_MEMORY_CONFIG_DIR` for its stack.
That variable has precedence over XDG/default configuration paths. Before
launch, use the native commands:

```text
BASIC_MEMORY_CONFIG_DIR=<dir> BASIC_MEMORY_NO_PROMOS=true \
  BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED=false \
  basic-memory config set auto_update false

BASIC_MEMORY_CONFIG_DIR=<dir> BASIC_MEMORY_NO_PROMOS=true \
  BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED=false \
  basic-memory project add <project> <absolute-markdown-directory> --local --default
```

Then supervise exactly:

```text
BASIC_MEMORY_CONFIG_DIR=<dir> BASIC_MEMORY_NO_PROMOS=true \
  BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED=false \
  basic-memory mcp --transport streamable-http --host 127.0.0.1 \
  --port <owned-port> --path /mcp --project <project>
```

The MCP URL is `http://127.0.0.1:<owned-port>/mcp`. It must never bind a
non-loopback address. The process and project are unique per stack. Config
changes require a service restart and a readiness call through MCP; direct
config-file edits are not supported.

`auto_update: false` disables the package's updater.
`BASIC_MEMORY_NO_PROMOS=true` disables its promotional and telemetry path.
`BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED=false` is the explicit supported 0.23.2
semantic-search gate: it prevents vector search/provider construction even
when optional vector dependencies are installed. Pythia's first slice calls
`search_notes` only with `search_type: "text"`; a semantic request must fail as
disabled rather than download a model. Cache roots are also isolated for
detecting accidental writes, but cache relocation is not the disable switch.

An exact-wheel provider-free probe created a synthetic Markdown note, started
the command above, initialized Streamable HTTP MCP, listed tools, and found the
note through FTS. After shutdown, no Hugging Face or FastEmbed model/cache
directory existed. This proves a supported no-model first slice; no decision
exception or fork is needed.

The upstream evidence is
[configuration models](https://github.com/basicmachines-co/basic-memory/blob/c0bd87c6d5a4a58034b1d6c8c5018e443b0bd048/src/basic_memory/config_models.py),
[MCP command](https://github.com/basicmachines-co/basic-memory/blob/c0bd87c6d5a4a58034b1d6c8c5018e443b0bd048/src/basic_memory/cli/commands/mcp.py),
[search gate](https://github.com/basicmachines-co/basic-memory/blob/c0bd87c6d5a4a58034b1d6c8c5018e443b0bd048/src/basic_memory/mcp/tools/search.py), and
[semantic-search documentation](https://github.com/basicmachines-co/basic-memory/blob/c0bd87c6d5a4a58034b1d6c8c5018e443b0bd048/docs/semantic-search.md).

## Data and failure boundary

Pythia consumes MCP initialization, tool listing, text `search_notes`, and the
smallest Markdown read/write operations required by the managed investment
skill. Results are bounded before reaching Hermes. Missing project/config,
invalid Markdown paths, MCP errors, timeout, process exit, or a semantic-search
disabled error remain explicit failures; they never fall back to cloud memory
or silently enable a model. Cancellation closes the Pythia request and, when
needed, restarts only this owned process. Deleting the derived database followed
by the native rebuild path must recover from unchanged Markdown.

Package startup currently resolves the exact prerelease dependency
`fastmcp==4.0.0b1`; dependency installation therefore must use the committed
lock generated for this exact release rather than ambient resolver policy.
