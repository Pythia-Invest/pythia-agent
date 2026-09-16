import type { DraftAttachment } from "@/components/chat/use-attachments";
import {
  MAX_REFERENCES,
  type FileReference,
  type WorkspaceContext,
} from "@/workspace/references";
export type DeskDraft = {
  text: string;
  attachments: DraftAttachment[];
  context: WorkspaceContext;
};
const EMPTY: DeskDraft = {
  text: "",
  attachments: [],
  context: { references: [] },
};
/** Unsaved browser-page UI state; Hermes remains the durable session owner. */
export class DeskDrafts {
  #drafts = new Map<string, DeskDraft>();
  #listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  get = (target: string) => this.#drafts.get(target) ?? EMPTY;
  update(target: string, patch: Partial<DeskDraft>) {
    this.#drafts.set(target, { ...this.get(target), ...patch });
    for (const listener of this.#listeners) listener();
  }
  clear(target: string) {
    this.update(target, EMPTY);
  }
  addReference(target: string, reference: FileReference) {
    const current = this.get(target).context;
    const references = current.references.filter(
      (file) =>
        file.path !== reference.path ||
        file.heading !== reference.heading ||
        file.selection !== reference.selection,
    );
    if (references.length >= MAX_REFERENCES)
      throw new Error("Reference up to 10 files per message.");
    this.update(target, {
      context: { ...current, references: [...references, reference] },
    });
  }
  stageNewChat(context: WorkspaceContext) {
    const current = this.get("new");
    const references = [
      ...current.context.references,
      ...context.references,
    ].filter(
      (file, index, all) =>
        all.findIndex(
          (other) => JSON.stringify(other) === JSON.stringify(file),
        ) === index,
    );
    if (references.length > MAX_REFERENCES)
      throw new Error(
        "The new chat draft already has references. Remove some before continuing here.",
      );
    this.update("new", { context: { ...context, references } });
  }
}
