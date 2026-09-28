"use client";
import { type IdentityQuestion, useIdentityQuestions } from "./identity-queue";

/*
 * Repairs (modelled on Home Assistant's): issues Pythia could not settle on
 * its own. Rules and the agent normally fix them, so the page sits under
 * Settings. An issue is generic; its `kind` picks the renderer of its detail
 * and fix flow. Today the only source is core's identity queue; another kind
 * (a plugin needing configuration, a data package update, a broken binding)
 * adds a source here and a renderer beside the page.
 */

export type RepairStatus = "open" | "agent" | "resolved" | "dismissed";

export interface Repair<Data = unknown> {
  id: string;
  kind: string;
  title: string;
  /** Plain language: what is wrong and why it matters. */
  description: string;
  subject: { id: string; name: string | null } | null;
  /** The plugin (source) involved, by its label. */
  plugin: string | null;
  created: string;
  status: RepairStatus;
  /** Kind-specific payload for its renderer. */
  data: Data;
}

export type IdentityRepair = Repair<IdentityQuestion>;

const IDENTITY_TITLES: Record<string, string> = {
  residual: "A source record could not be matched",
  conflict: "A source record disagrees with the reference data",
};

function identityRepair(item: IdentityQuestion): IdentityRepair {
  const candidate = item.candidates[0];
  const settled = item.agent_answer
    ? "agent"
    : item.state === "open"
      ? "open"
      : item.state === "dismissed"
        ? "dismissed"
        : "resolved";
  return {
    id: `identity:${item.id}`,
    kind: "identity",
    title: IDENTITY_TITLES[item.kind] ?? "An identity question is open",
    description: item.question,
    subject: candidate ? { id: candidate.id, name: candidate.name } : null,
    plugin: item.label,
    created: item.opened_at,
    status: settled,
    data: item,
  };
}

/** Open issues, and apart from them the history of those the agent answered
 * (provisional until the user confirms or overrides them). */
export function useRepairs() {
  const identity = useIdentityQuestions();
  return {
    open: (identity.data?.items ?? []).map(identityRepair),
    history: (identity.data?.answered ?? []).map(identityRepair),
    notice: identity.data?.notice ?? null,
    isPending: identity.isPending,
    error: identity.error,
    refetch: () => void identity.refetch(),
  };
}
