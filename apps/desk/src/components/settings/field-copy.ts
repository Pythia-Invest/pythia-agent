/*
 * Labels, descriptions and choices for Hermes config fields, from Hermes
 * Desktop (apps/desktop/src/app/settings/constants.ts FIELD_LABELS,
 * FIELD_DESCRIPTIONS and ENUM_OPTIONS in NousResearch/hermes-agent, MIT
 * License, Copyright (c) 2025 Nous Research). Hermes's schema supplies the
 * rest; a field with no copy here uses its schema description.
 */

export const FIELD_LABELS: Record<string, string> = {
  model_context_length: "Main model context window (override)",
  fallback_providers: "Fallback models",
  timezone: "Time zone",
  "display.personality": "Personality",
  "display.show_reasoning": "Reasoning blocks",
  "agent.max_turns": "Max agent steps",
  "agent.image_input_mode": "Image attachments",
  "agent.api_max_retries": "API retries",
  "agent.service_tier": "Service tier",
  "agent.reasoning_effort": "Default reasoning effort",
  "agent.tool_use_enforcement": "Tool-use enforcement",
  "terminal.backend": "Execution backend",
  "terminal.timeout": "Command timeout",
  "terminal.persistent_shell": "Persistent shell",
  "terminal.env_passthrough": "Environment passthrough",
  "terminal.docker_image": "Docker image",
  "terminal.singularity_image": "Singularity image",
  "terminal.modal_image": "Modal image",
  "terminal.daytona_image": "Daytona image",
  file_read_max_chars: "File read limit",
  "tool_output.max_bytes": "Terminal output limit",
  "tool_output.max_lines": "File page limit",
  "tool_output.max_line_length": "Line length limit",
  "code_execution.mode": "Code execution mode",
  "approvals.mode": "Approval mode",
  "approvals.timeout": "Approval timeout",
  "approvals.mcp_reload_confirm": "Confirm MCP reloads",
  command_allowlist: "Command allowlist",
  "security.redact_secrets": "Redact secrets",
  "security.allow_private_urls": "Allow private URLs",
  "checkpoints.enabled": "File checkpoints",
  "checkpoints.max_snapshots": "Checkpoint limit",
  "memory.memory_enabled": "Persistent memory",
  "memory.user_profile_enabled": "User profile",
  "memory.memory_char_limit": "Memory budget",
  "memory.user_char_limit": "Profile budget",
  "memory.provider": "Memory provider",
  "context.engine": "Context engine",
  "compression.enabled": "Auto-compression",
  "compression.threshold": "Compression threshold",
  "compression.codex_gpt55_autoraise": "Codex compression auto-raise",
  "compression.target_ratio": "Compression target",
  "compression.protect_last_n": "Protected recent messages",
  "auxiliary.compression.timeout": "Compression model timeout (s)",
  "delegation.model": "Subagent model",
  "delegation.provider": "Subagent provider",
  "delegation.max_iterations": "Subagent turn limit",
  "delegation.max_concurrent_children": "Parallel subagents",
  "delegation.child_timeout_seconds": "Subagent timeout",
  "delegation.reasoning_effort": "Subagent reasoning effort",
};

export const FIELD_DESCRIPTIONS: Record<string, string> = {
  model_context_length:
    "Overrides the detected context window of the main chat model only, in tokens. Leave at 0 to use the model's detected value.",
  fallback_providers:
    "Backup provider and model pairs to try if the default model fails.",
  "display.personality": "Default assistant style for new chats.",
  "display.show_reasoning":
    "Show reasoning sections when the model provides them.",
  timezone: "Blank uses this device's time zone.",
  "agent.image_input_mode":
    "Controls how image attachments are sent to the model.",
  "agent.max_turns":
    "Upper bound for tool-calling turns before Hermes stops a run.",
  "terminal.persistent_shell":
    "Keep shell state between commands when the backend supports it.",
  "terminal.env_passthrough":
    "Environment variables to pass into tool execution.",
  "terminal.docker_image":
    "Container image used when the execution backend is Docker.",
  "terminal.singularity_image":
    "Image used when the execution backend is Singularity.",
  "terminal.modal_image": "Image used when the execution backend is Modal.",
  "terminal.daytona_image": "Image used when the execution backend is Daytona.",
  "code_execution.mode":
    "How strictly code execution is scoped to the current project.",
  file_read_max_chars:
    "Maximum characters Hermes can read from one file request.",
  "approvals.mode": "How Hermes handles commands that need your approval.",
  "approvals.timeout": "How long approval prompts wait before timing out.",
  "security.redact_secrets":
    "Hide detected secrets from model-visible content when possible.",
  "checkpoints.enabled": "Create rollback snapshots before file edits.",
  "memory.memory_enabled": "Save durable memories that can help future chats.",
  "memory.user_profile_enabled":
    "Maintain a compact profile of your preferences.",
  "context.engine":
    "Strategy for managing long conversations near the context limit.",
  "compression.enabled":
    "Summarize older context when conversations get large.",
  "compression.codex_gpt55_autoraise":
    "Raise compression to 85% for supported ChatGPT Codex models.",
  "auxiliary.compression.timeout":
    "Seconds to wait for the compression model per call. Raise it for slow local models.",
};

const REASONING = ["", "none", "minimal", "low", "medium", "high", "xhigh"];

/** Choices for fields whose schema only says `string`. */
export const ENUM_OPTIONS: Record<string, string[]> = {
  "agent.image_input_mode": ["auto", "native", "text"],
  "agent.reasoning_effort": REASONING,
  "approvals.mode": ["manual", "smart", "off"],
  "code_execution.mode": ["project", "strict"],
  "context.engine": ["compressor", "default", "custom"],
  "delegation.reasoning_effort": REASONING,
  "terminal.backend": [
    "local",
    "docker",
    "singularity",
    "modal",
    "daytona",
    "ssh",
  ],
};

/** Labels for choices, where the raw value isn't readable on its own. */
export const OPTION_LABELS: Record<string, string> = {
  "": "Default",
  xhigh: "Extra high",
};

const ACRONYMS = new Set(["mcp", "tts", "stt", "moa", "api", "url"]);

/** `title_generation` → "Title generation"; `mcp` → "MCP". */
export const words = (value: string) =>
  value
    .split("_")
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word))
    .join(" ")
    .replace(/^\w/u, (first) => first.toUpperCase());

/** A readable label: curated copy, then one built from the key. */
export function fieldLabel(key: string) {
  const curated = FIELD_LABELS[key];
  if (curated) return curated;
  // auxiliary.<task>.provider → "Vision provider"
  const auxiliary = /^auxiliary\.([a-z_]+)\.(provider|model)$/u.exec(key);
  if (auxiliary) return `${words(auxiliary[1] ?? "")} ${auxiliary[2]}`;
  return words(key.split(".").at(-1) ?? key);
}

/**
 * A description worth showing: curated copy, else the schema's, unless the
 * schema only restates the label ("Agent → Max Turns").
 */
export function fieldDescription(key: string, schema?: string) {
  const curated = FIELD_DESCRIPTIONS[key];
  if (curated) return curated;
  if (!schema || /→/u.test(schema)) return undefined;
  const plain = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return plain(schema) === plain(fieldLabel(key)) ? undefined : schema;
}

export function optionLabel(value: string) {
  return OPTION_LABELS[value] ?? words(value);
}
