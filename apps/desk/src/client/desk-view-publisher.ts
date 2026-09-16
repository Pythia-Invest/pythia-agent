import { DESK_VIEW_HEARTBEAT_MS, type DeskView } from "@/view-context/types";
import type { WorkspaceTurn, DeskRunStart } from "@/workspace/references";
import type { DeskApi } from "./api";
/** Browser-page lifetime only. A reload never resumes references from history. */
export class DeskViewPublisher {
  #tab: string | undefined;
  #view: DeskView | undefined;
  #active = new Map<
    string,
    { runId: string; sequence: number; pending: Promise<void> }
  >();
  constructor(private api: DeskApi) {}
  snapshot = (): WorkspaceTurn["view"] => {
    if (
      !this.#view ||
      typeof document === "undefined" ||
      document.visibilityState !== "visible"
    )
      return undefined;
    this.#tab ??= crypto.randomUUID();
    return { tab_id: this.#tab, view: this.#view };
  };
  setView(view: DeskView) {
    this.#view = view;
    this.publish();
  }
  activate = (
    runId: string,
    reference: NonNullable<DeskRunStart["desk_view"]>,
  ) => {
    if (!this.#tab) return;
    this.#active.set(reference.view_reference, {
      runId,
      sequence: 0,
      pending: Promise.resolve(),
    });
    this.publish();
  };
  finish = (runId: string) => {
    for (const [reference, entry] of this.#active) {
      if (entry.runId !== runId) continue;
      this.#active.delete(reference);
      if (this.#tab)
        void this.api.terminateDeskView(this.#tab, reference).catch(() => {});
    }
  };
  publish = () => {
    const current = this.snapshot();
    if (!current) return;
    for (const [reference, entry] of this.#active) {
      entry.pending = entry.pending.then(async () => {
        if (!this.#active.has(reference)) return;
        const next = this.snapshot();
        if (!next) return;
        try {
          await this.api.publishDeskView({
            ...next,
            view_reference: reference,
            sequence: ++entry.sequence,
          });
        } catch {
          // Expired, rejected and disconnected references never adopt a new tab.
          this.#active.delete(reference);
        }
      });
    }
  };
  start() {
    const interval = setInterval(this.publish, DESK_VIEW_HEARTBEAT_MS);
    document.addEventListener("visibilitychange", this.publish);
    window.addEventListener("focus", this.publish);
    const close = () => {
      this.#active.clear();
      this.#view = undefined;
    };
    window.addEventListener("pagehide", close);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", this.publish);
      window.removeEventListener("focus", this.publish);
      window.removeEventListener("pagehide", close);
      close();
    };
  }
}
