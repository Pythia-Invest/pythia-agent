export type BackendError = {
  message: string;
  status?: string;
};

const identifierWords: Record<string, string> = {
  api: "API",
  codex: "Codex",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  glm: "GLM",
  gpt: "GPT",
  kimi: "Kimi",
  opencode: "OpenCode",
  openai: "OpenAI",
  xai: "xAI",
};

/** Human-readable label for a provider slug or model identifier. */
export function backendIdentifierLabel(value: string) {
  return value
    .split(/[-_]+/u)
    .filter(Boolean)
    .map(
      (word) =>
        identifierWords[word.toLocaleLowerCase()] ??
        `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`,
    )
    .join(" ");
}

function quotedMessage(value: string) {
  const patterns = [
    /["']message["']\s*:\s*"((?:\\.|[^"\\])*)"/gu,
    /["']message["']\s*:\s*'((?:\\.|[^'\\])*)'/gu,
  ];
  for (const pattern of patterns) {
    const matches = [...value.matchAll(pattern)];
    const last = matches.at(-1)?.[1];
    if (last) return last.replaceAll("\\'", "'").replaceAll('\\"', '"');
  }
  return null;
}

/**
 * Removes serialization and relay wrappers while retaining the backend's
 * innermost message. This formats an error; it does not classify its cause.
 */
export function formatBackendError(value: string): BackendError {
  const clean = value.trim();
  const status = clean.match(/^(?:Error code:\s*|HTTP\s+)(\d+)/iu)?.[1];
  let message = quotedMessage(clean) ?? clean;
  message = message.replace(
    /^(?:Error code:\s*\d+\s*-\s*|HTTP\s+\d+\s*:\s*)/iu,
    "",
  );
  const wrapper =
    /^(?:Error from provider(?:\s*\([^)]+\))?|Upstream request failed)\s*:\s*/iu;
  while (wrapper.test(message)) {
    message = message.replace(wrapper, "");
  }
  return {
    message: message.trim() || clean || "Run failed.",
    ...(status ? { status } : {}),
  };
}
