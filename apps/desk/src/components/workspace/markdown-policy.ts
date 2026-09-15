import { defaultRehypePlugins } from "streamdown";

function installedSanitizer() {
  const sanitizer = defaultRehypePlugins.sanitize;
  if (!sanitizer)
    throw new Error("The installed Markdown sanitizer is unavailable.");
  return sanitizer;
}

/** The default hardener normalizes relative href/src before custom components.
 * Preserve the original locator while retaining the installed HTML sanitizer;
 * URL transforms and explicit link/image components enforce each view's policy. */
export const MARKDOWN_SANITIZER = installedSanitizer();

/** Chat handles file hrefs as host locators, never as browser file navigation.
 * Preserve only href's file protocol for that handler; image policy is unchanged. */
function chatSanitizer() {
  if (!Array.isArray(MARKDOWN_SANITIZER) || !MARKDOWN_SANITIZER[1])
    throw new Error("The installed Markdown sanitizer schema is unavailable.");
  const schema = MARKDOWN_SANITIZER[1] as {
    protocols?: Record<string, string[]>;
  };
  return [
    MARKDOWN_SANITIZER[0],
    {
      ...schema,
      protocols: {
        ...schema.protocols,
        href: [...(schema.protocols?.href ?? []), "file"],
      },
    },
  ] as typeof MARKDOWN_SANITIZER;
}

export const CHAT_MARKDOWN_SANITIZER = chatSanitizer();
