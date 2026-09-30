export type ChatAttentionSnapshot = {
  workingIds: ReadonlySet<string>;
  unreadIds: ReadonlySet<string>;
};

const STORAGE_KEY = "pythia-desk:unread-chats";

/** Browser presentation only. Runs and messages remain owned by Hermes/Chat. */
export class ChatAttention {
  #snapshot: ChatAttentionSnapshot = {
    workingIds: new Set(),
    unreadIds: new Set(),
  };
  #listeners = new Set<() => void>();
  #readers = new Map<string, Set<() => boolean>>();

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  snapshot = () => this.#snapshot;

  restore() {
    try {
      const stored: unknown = JSON.parse(
        sessionStorage.getItem(STORAGE_KEY) ?? "[]",
      );
      if (!Array.isArray(stored)) return;
      const unreadIds = new Set(this.#snapshot.unreadIds);
      for (const id of stored) if (typeof id === "string") unreadIds.add(id);
      this.#update({ unreadIds });
      for (const id of unreadIds) this.read(id);
    } catch {
      // A disabled or stale browser store must not affect chat execution.
    }
  }

  working(sessionId: string, working: boolean) {
    if (this.#snapshot.workingIds.has(sessionId) === working) return;
    const workingIds = new Set(this.#snapshot.workingIds);
    if (working) workingIds.add(sessionId);
    else workingIds.delete(sessionId);
    this.#update({ workingIds });
  }

  reply(sessionId: string) {
    if (this.#reading(sessionId)) return;
    const unreadIds = new Set(this.#snapshot.unreadIds);
    unreadIds.add(sessionId);
    this.#update({ unreadIds });
  }

  read(sessionId: string) {
    if (!this.#reading(sessionId) || !this.#snapshot.unreadIds.has(sessionId))
      return;
    const unreadIds = new Set(this.#snapshot.unreadIds);
    unreadIds.delete(sessionId);
    this.#update({ unreadIds });
  }

  reader(sessionId: string, visible: () => boolean) {
    const readers = this.#readers.get(sessionId) ?? new Set();
    readers.add(visible);
    this.#readers.set(sessionId, readers);
    this.read(sessionId);
    return () => {
      readers.delete(visible);
      if (!readers.size) this.#readers.delete(sessionId);
    };
  }

  #reading(sessionId: string) {
    return [...(this.#readers.get(sessionId) ?? [])].some((visible) =>
      visible(),
    );
  }

  #update(patch: Partial<ChatAttentionSnapshot>) {
    this.#snapshot = { ...this.#snapshot, ...patch };
    if (patch.unreadIds) {
      try {
        // Only IDs, never transcript content; bounded browser convenience.
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify([...patch.unreadIds].slice(-500)),
        );
      } catch {
        // In-memory indicators remain usable if storage is unavailable.
      }
    }
    for (const listener of this.#listeners) listener();
  }
}
