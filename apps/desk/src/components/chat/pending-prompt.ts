/**
 * Hands the first prompt from the new-chat surface to the session route that
 * replaces it. Session storage keeps it out of the URL and out of history.
 */
const PREFIX = "pythia-desk:pending-prompt:";

export function storePendingPrompt(sessionId: string, prompt: string) {
  try {
    sessionStorage.setItem(`${PREFIX}${sessionId}`, prompt);
  } catch {
    // Without storage the user simply re-sends from the chat route.
  }
}

export function takePendingPrompt(sessionId: string): string | null {
  try {
    const key = `${PREFIX}${sessionId}`;
    const value = sessionStorage.getItem(key);
    if (value !== null) sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

/** A session title Hermes will accept, taken from the opening prompt. */
export function titleFromPrompt(prompt: string) {
  const line = prompt.trim().split(/\r?\n/u)[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}
