import type { DataTableContextItem } from "@pythia/ui";
import type { Repair } from "@/client/repairs";

/** One action on an issue: its row button and the dialog that confirms it. */
export interface RepairAction {
  /** Short row-button label; `hint` says it in full as a tooltip. */
  label: string;
  hint: string;
  /** The row button; destructive-looking only when the dialog confirms a withdrawal. */
  emphasis: "primary" | "secondary";
  dialog: {
    title: string;
    description: string;
    noteLabel: string;
    notePlaceholder: string;
    confirmLabel: string;
    tone: "primary" | "danger";
  };
  /** Runs the fix with the user's note; resolves to the message to show, or
   * throws with the reason it did not go through. */
  run: (note: string) => Promise<string>;
}

/** A kind renders its issue's context and offers its actions; nothing more. */
export interface RepairKind<Data = unknown> {
  label: string;
  context: (repair: Repair<Data>) => DataTableContextItem[];
  actions: (repair: Repair<Data>) => RepairAction[];
}
