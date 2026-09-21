type ErrorBody = { error?: { code?: unknown; message?: unknown } };

export class DeskApiError extends Error {
  readonly code: string | undefined;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "DeskApiError";
    this.status = status;
    this.code = code;
  }
}

export async function bodyError(response: Response) {
  try {
    const body = (await response.json()) as ErrorBody;
    return {
      code: typeof body.error?.code === "string" ? body.error.code : undefined,
      message:
        typeof body.error?.message === "string"
          ? body.error.message
          : "Pythia Desk could not complete the request.",
    };
  } catch {
    return { message: "Pythia Desk could not complete the request." };
  }
}

async function requireJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  const error = await bodyError(response);
  throw new DeskApiError(error.message, response.status, error.code);
}

/** One browser admission session, shared by concurrent reads and streams. */
export class BrowserRequest {
  protected csrfToken = "";
  #initializing: Promise<void> | undefined;

  async initialize() {
    if (!this.#initializing) {
      this.#initializing = (async () => {
        const response = await requireJson<{ csrf_token: string }>(
          await fetch("/api/browser-session", { cache: "no-store" }),
        );
        this.csrfToken = response.csrf_token;
      })().finally(() => {
        this.#initializing = undefined;
      });
    }
    return this.#initializing;
  }

  protected async json<T>(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) {
      // Mutations need the browser-session token; reads do not.
      if (!this.csrfToken) await this.initialize();
      headers.set("Content-Type", "application/json");
      headers.set("X-Pythia-CSRF", this.csrfToken);
    }
    return requireJson<T>(
      await fetch(path, {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
        headers,
      }),
    );
  }
}
