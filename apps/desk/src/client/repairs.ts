"use client";
import { type IdentityQuestion, useIdentityQuestions } from "./identity-queue";

/*
 * Repairs (modelled on Home Assistant's): issues Pythia could not settle on
 * its own. Rules and the agent normally fix them, so the page sits under
 * Settings. An issue is generic; its `kind` picks the renderer of its context
 * and actions. Today the only source is core's identity queue; another kind
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
  resolved: string | null;
  status: RepairStatus;
  /** The agent's answer in two or three words: provisional for status
   * "agent", a suggestion waiting for the user on an open issue. */
  agentAnswer: string | null;
  /** Text the page's search matches. */
  search: string;
  /** Kind-specific payload for its renderer. */
  data: Data;
}

export type IdentityRepair = Repair<IdentityQuestion>;

const IDENTITY_TITLES: Record<string, string> = {
  residual: "Record not matched",
  conflict: "Record conflicts with reference",
};

function identityRepair(item: IdentityQuestion): IdentityRepair {
  const candidate = item.candidates[0];
  const status: RepairStatus =
    item.state === "open"
      ? "open"
      : item.agent_answer
        ? "agent"
        : item.state === "dismissed"
          ? "dismissed"
          : "resolved";
  const record = item.record;
  return {
    id: `identity:${item.id}`,
    kind: "identity",
    title: IDENTITY_TITLES[item.kind] ?? "Identity question",
    description: item.question,
    subject: candidate ? { id: candidate.id, name: candidate.name } : null,
    plugin: item.label,
    created: item.opened_at,
    resolved: status === "open" ? null : item.updated_at,
    status,
    agentAnswer: item.agent_answer
      ? item.agent_answer.chosen_id &&
        item.agent_answer.relation !== "unrelated"
        ? "match"
        : "not a match"
      : null,
    search: [
      item.question,
      item.label,
      candidate?.name,
      record?.name,
      record?.native_ref?.native_id,
      ...(record?.identifiers ?? []).map((entry) => entry.value),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    data: item,
  };
}

/** Every issue the sources report, open or settled; the page filters them. */
export function useRepairs() {
  const identity = useIdentityQuestions();
  const data = identity.data;
  const all = [
    ...(data?.items ?? []),
    ...(data?.answered ?? []),
    ...(data?.settled ?? []),
  ].map(identityRepair);
  return {
    all,
    open: all.filter((repair) => repair.status === "open"),
    notice: data?.notice ?? null,
    isPending: identity.isPending,
    isFetching: identity.isFetching,
    error: identity.error,
    refetch: () => void identity.refetch(),
  };
}
