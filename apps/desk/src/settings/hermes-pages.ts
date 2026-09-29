/*
 * Which Hermes config fields each Settings page shows. The pages and their
 * curated fields follow Hermes Desktop (apps/desktop/src/app/settings/
 * constants.ts SECTIONS and config-subpages.ts in NousResearch/hermes-agent,
 * MIT). Desk renders these fields from Hermes's config schema, and its server
 * accepts changes only to them, so this list is both the layout and the write
 * allowlist.
 */

export type HermesPage = {
  /** `section/page`, as addressed in the Settings URL. */
  id: string;
  /** Config keys, in display order. */
  fields?: readonly string[];
  /** Schema keys matching this, in schema order, after `fields`. */
  match?: RegExp;
};

export const hermesPages: readonly HermesPage[] = [
  {
    id: "model/main",
    fields: [
      "model_context_length",
      "agent.reasoning_effort",
      "agent.service_tier",
    ],
  },
  { id: "model/fallbacks", fields: ["fallback_providers"] },
  // One provider and model per auxiliary task; endpoints and keys for a task
  // stay in config.yaml.
  { id: "model/auxiliary", match: /^auxiliary\.[a-z_]+\.(?:provider|model)$/u },
  {
    id: "chat/behavior",
    fields: ["display.personality", "timezone", "display.show_reasoning"],
  },
  { id: "chat/attachments", fields: ["agent.image_input_mode"] },
  // Not `terminal.env_passthrough`: it would let a browser hand a stored
  // provider key to the agent's shell, where a chat can print it. It stays a
  // host-side setting, like the credentials it would expose.
  {
    id: "workspace/shell",
    fields: ["terminal.persistent_shell"],
  },
  {
    id: "workspace/files",
    fields: ["code_execution.mode", "file_read_max_chars"],
  },
  {
    id: "safety/approvals",
    fields: [
      "approvals.mode",
      "approvals.timeout",
      "approvals.mcp_reload_confirm",
      "command_allowlist",
    ],
  },
  {
    id: "safety/privacy",
    fields: ["security.redact_secrets", "security.allow_private_urls"],
  },
  { id: "safety/checkpoints", fields: ["checkpoints.enabled"] },
  {
    id: "memory/persistent",
    fields: [
      "memory.memory_enabled",
      "memory.user_profile_enabled",
      "memory.memory_char_limit",
      "memory.user_char_limit",
      "memory.provider",
    ],
  },
  {
    id: "memory/context",
    fields: [
      "context.engine",
      "compression.enabled",
      "compression.threshold",
      "compression.codex_gpt55_autoraise",
      "compression.target_ratio",
      "compression.protect_last_n",
      "auxiliary.compression.timeout",
    ],
  },
  {
    id: "advanced/runtime",
    fields: ["agent.max_turns", "agent.api_max_retries"],
  },
  { id: "advanced/tools", fields: ["agent.tool_use_enforcement"] },
  {
    id: "advanced/terminal",
    fields: [
      "terminal.backend",
      "terminal.timeout",
      "terminal.docker_image",
      "terminal.singularity_image",
      "terminal.modal_image",
      "terminal.daytona_image",
    ],
  },
  {
    id: "advanced/delegation",
    fields: [
      "delegation.model",
      "delegation.provider",
      "delegation.max_iterations",
      "delegation.max_concurrent_children",
      "delegation.child_timeout_seconds",
      "delegation.reasoning_effort",
    ],
  },
  {
    id: "advanced/output",
    fields: [
      "tool_output.max_bytes",
      "tool_output.max_lines",
      "tool_output.max_line_length",
      "checkpoints.max_snapshots",
    ],
  },
];

/**
 * Config that Pythia manages itself: the agent's working folder, which
 * toolsets, plugins and MCP servers make up Pythia, the main model (changed
 * through Hermes's model assignment, not a raw write), and Hermes's own
 * update flow, since Pythia updates Hermes as part of its releases. No page
 * shows them and Desk refuses to write them.
 */
const pythiaOwned = [
  "terminal.cwd",
  "toolsets",
  "platform_toolsets",
  "plugins",
  "mcp_servers",
  "updates",
  "model",
  "providers",
  "custom_providers",
  "dashboard",
];

/** Keys whose values are credentials: never shown, never written here. */
export const SECRET_KEY =
  /(?:^|[._-])(?:api_?key|token|secret|password|passwd|credentials?|authorization|bearer|private_key)$/iu;

export function isPythiaOwned(key: string) {
  return pythiaOwned.some(
    (owned) => key === owned || key.startsWith(`${owned}.`),
  );
}

/** Whether `key` belongs on `page`. */
export function pageShows(page: HermesPage, key: string) {
  if (isPythiaOwned(key) || SECRET_KEY.test(key)) return false;
  return Boolean(page.fields?.includes(key) || page.match?.test(key));
}

/** Whether Settings may change `key`: a page shows it. */
export function isEditableHermesKey(key: string) {
  return hermesPages.some((page) => pageShows(page, key));
}

/**
 * The fields a page shows, in order: its listed fields that Hermes knows,
 * then the schema keys it matches.
 */
export function pageFields(page: HermesPage, schemaKeys: readonly string[]) {
  const known = new Set(schemaKeys);
  const listed = (page.fields ?? []).filter((key) => known.has(key));
  const matched = schemaKeys.filter(
    (key) => !listed.includes(key) && page.match?.test(key),
  );
  return [...listed, ...matched].filter((key) => pageShows(page, key));
}
