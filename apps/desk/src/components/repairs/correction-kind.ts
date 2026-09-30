"use client";
import { type Correction, useCorrect } from "@/client/corrections";
import { type CorrectionRepair, correctionWhat } from "@/client/repairs";
import type { RepairAction, RepairKind } from "./kinds";

/** Ends a sentence once, even after a name such as "Nestlé S.A.". */
function sentence(text: string) {
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

function capital(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The rows describing a correction: what it does, for which instrument, and
 * who made it. */
export function correctionContext(item: Correction) {
  return [
    { label: "Correction", value: capital(correctionWhat(item)) },
    { label: "Instrument", value: item.name ?? item.subject_id },
    {
      label: "Made by",
      value:
        item.proposed_by === "agent" && item.state === "proposed"
          ? "The agent, as a proposal"
          : item.proposed_by === "agent"
            ? "The agent's proposal, confirmed by you"
            : "You",
    },
    ...(item.note ? [{ label: "Note", value: item.note }] : []),
  ];
}

/** Catalogue corrections: the agent's proposal waits for the investor to
 * confirm or decline it, and an applied correction can be undone, which makes
 * the data read as it did before. Nothing here applies without the investor. */
export function useCorrectionKind(): RepairKind<Correction> {
  const correct = useCorrect();
  const act =
    (item: Correction, action: "confirm" | "decline" | "undo") =>
    (note: string) =>
      correct({ action, id: item.id, ...(note ? { note } : {}) });
  return {
    label: "Correction",
    context: ({ data: item }: CorrectionRepair) => correctionContext(item),
    actions: ({ data: item }: CorrectionRepair) => {
      if (item.state === "active")
        return [
          {
            label: "Undo",
            hint: "Undo your correction: the data reads as it did before",
            emphasis: "secondary",
            dialog: {
              title: "Undo correction",
              description: `${sentence(capital(correctionWhat(item)))} Undoing it makes the data read as it did before.`,
              noteLabel: "Reason",
              notePlaceholder: "Why undo it…",
              confirmLabel: "Undo",
              tone: "danger",
            },
            run: act(item, "undo"),
          },
        ];
      if (item.state !== "proposed") return [];
      const actions: RepairAction[] = [
        {
          label: "Confirm",
          hint: "Make the agent's proposal your own correction",
          emphasis: "primary",
          dialog: {
            title: "Apply correction",
            description: `${sentence(capital(correctionWhat(item)))} It applies on this device until you undo it.`,
            noteLabel: "Note",
            notePlaceholder: "Why this is right…",
            confirmLabel: "Apply correction",
            tone: "primary",
          },
          run: act(item, "confirm"),
        },
        {
          label: "Decline",
          hint: "Decline the proposal: nothing changes",
          emphasis: "secondary",
          dialog: {
            title: "Decline proposal",
            description:
              "The proposal stays in the history and changes nothing.",
            noteLabel: "Reason",
            notePlaceholder: "Why decline it…",
            confirmLabel: "Decline",
            tone: "danger",
          },
          run: act(item, "decline"),
        },
      ];
      return actions;
    },
  };
}
