"use client";
import { type Correction, useCorrections } from "./corrections";
import { type IdentityQuestion, useIdentityQuestions } from "./identity-queue";

/*
 * Repairs (modelled on Home Assistant's): issues Pythia could not settle on
 * its own. Rules fix most of them, so the page sits under
 * Settings. An issue is generic; its `kind` picks the renderer of its context
 * and actions. Today the sources are core's identity queue and the catalogue
 * corrections (the agent's proposals to confirm, the investor's own to undo);
 * another kind (a plugin needing configuration, a data package update, a
 * broken binding) adds a source here and a renderer beside the page.
 */

export type RepairStatus = "open" | "resolved" | "dismissed";

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
  /** On an open issue: the agent's suggestion in two or three words. */
  agentAnswer: string | null;
  /** Text the page's search matches. */
  search: string;
  /** Kind-specific payload for its renderer. */
  data: Data;
}

export type IdentityRepair = Repair<IdentityQuestion>;
export type CorrectionRepair = Repair<Correction>;

/** Core's tag for a question Pythia's reference build left open. It carries
 * no provider record and asks about its own subject. */
export const REFERENCE_BUILD = "reference";

export function isBuildQuestion(item: IdentityQuestion) {
  return item.plugins[0] === REFERENCE_BUILD && !item.record;
}

/** An answer's relation in two or three words; a receipt is never "a match". */
function agentAnswerWords({
  relation,
  chosen_id,
}: IdentityQuestion["answers"][number]) {
  if (!chosen_id || relation === "unrelated") return "not a match";
  return relation === "depositary_receipt_of" ? "depositary receipt" : "match";
}

/** The row key of an identity question, as `?question=` names it. */
export const identityRepairId = (questionId: string) =>
  `identity:${questionId}`;

export function identityRepair(item: IdentityQuestion): IdentityRepair {
  const built = isBuildQuestion(item);
  // A record's question is about the instrument it may be; a build
  // question about its own subject.
  const candidate = built ? item.subjects[0] : item.candidates[0];
  const status: RepairStatus =
    item.state === "open"
      ? "open"
      : item.state === "dismissed"
        ? "dismissed"
        : "resolved";
  const record = item.record;
  return {
    id: identityRepairId(item.id),
    kind: "identity",
    title: item.title,
    description: item.question,
    subject: candidate ? { id: candidate.id, name: candidate.name } : null,
    plugin: item.label,
    created: item.opened_at,
    resolved: status === "open" ? null : item.updated_at,
    status,
    agentAnswer: item.agent_answer ? agentAnswerWords(item.agent_answer) : null,
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

const SCHEME_NAMES: Record<string, string> = {
  isin: "ISIN",
  lei: "LEI",
  cik: "CIK",
  figi: "FIGI",
  share_class_figi: "share-class FIGI",
  composite_figi: "composite FIGI",
  caip19: "CAIP-19",
};

/** What a correction does, as a verb phrase: "set the ISIN of X to Y". */
export function correctionWhat(item: Correction) {
  const name = item.name ?? item.subject_id;
  if (item.kind === "price_source")
    return `use ${item.label ?? item.value} as the price source of ${name}`;
  const scheme = SCHEME_NAMES[item.scheme ?? ""] ?? item.scheme ?? "identifier";
  return item.value
    ? `set the ${scheme} of ${name} to ${item.value}`
    : `remove the ${scheme} of ${name}`;
}

/** The agent's proposal in two or three words, for the status badge. */
function proposalWords(item: Correction) {
  if (item.kind === "price_source") return `use ${item.label ?? item.value}`;
  const scheme = SCHEME_NAMES[item.scheme ?? ""] ?? "identifier";
  return item.value ? `set ${scheme}` : `remove ${scheme}`;
}

/** A correction as an issue: the agent's proposal is open until the investor
 * confirms or declines it, an applied correction is resolved (undoable), and
 * one undone, declined or replaced is dismissed. */
export function correctionRepair(item: Correction): CorrectionRepair {
  const status: RepairStatus =
    item.state === "proposed"
      ? "open"
      : item.state === "active"
        ? "resolved"
        : "dismissed";
  const what = correctionWhat(item);
  return {
    id: `correction:${item.id}`,
    kind: "correction",
    title:
      item.kind === "price_source" ? "Price source" : "Identifier correction",
    description:
      status === "open"
        ? `The agent proposes to ${what}. Nothing changes until you confirm it.`
        : status === "resolved"
          ? `You chose to ${what}.`
          : `Undone, declined or replaced: ${what}.`,
    subject: { id: item.subject_id, name: item.name },
    plugin: item.label,
    created: item.created_at,
    resolved: status === "open" ? null : (item.ended_at ?? item.decided_at),
    status,
    agentAnswer: status === "open" ? proposalWords(item) : null,
    search: [what, item.note, item.value, item.label]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    data: item,
  };
}

/** Every issue the sources report, open or settled; the page filters them. */
export function useRepairs() {
  const identity = useIdentityQuestions();
  const corrections = useCorrections();
  const data = identity.data;
  const all: Repair[] = [
    ...[...(data?.items ?? []), ...(data?.settled ?? [])].map(identityRepair),
    ...(corrections.data ?? []).map(correctionRepair),
  ];
  return {
    all,
    open: all.filter((repair) => repair.status === "open"),
    notice: data?.notice ?? null,
    isPending: identity.isPending || corrections.isPending,
    isFetching: identity.isFetching || corrections.isFetching,
    error: identity.error ?? corrections.error,
    refetch: () => {
      void identity.refetch();
      void corrections.refetch();
    },
  };
}
