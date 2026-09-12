import type { Attachment } from "@/attachments";
/**
 * Hands the first prompt from the new-chat surface to the session route that
 * replaces it. Session storage keeps it out of the URL and out of history.
 */
const PREFIX = "pythia-desk:pending-prompt:";

export function storePendingPrompt(
  sessionId: string,
  prompt: string,
  attachments: Attachment[] = [],
) {
  try {
    sessionStorage.setItem(
      `${PREFIX}${sessionId}`,
      JSON.stringify({ text: prompt, attachments }),
    );
  } catch {
    throw new Error(
      "This browser could not keep the draft. Enable session storage and try again.",
    );
  }
}

export function takePendingPrompt(
  sessionId: string,
): { text: string; attachments: Attachment[] } | null {
  try {
    const key = `${PREFIX}${sessionId}`;
    const value = sessionStorage.getItem(key);
    if (value !== null) sessionStorage.removeItem(key);
    if (value === null) return null;
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed.text === "string" && Array.isArray(parsed.attachments))
        return parsed;
    } catch {
      /* Drafts stored by older versions were plain text. */
    }
    return { text: value, attachments: [] };
  } catch {
    return null;
  }
}

/** A session title Hermes will accept, taken from the opening prompt. */
export function titleFromPrompt(prompt: string) {
  const line = prompt.trim().split(/\r?\n/u)[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}
