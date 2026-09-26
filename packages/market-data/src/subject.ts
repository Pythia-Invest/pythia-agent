/**
 * Client side of the core instrument-page operations: `identity-subject`
 * composes one subject's page from local state only, and `identity-resolve`
 * asks one plugin for an address core could not derive. Core owns both shapes;
 * this file mirrors them and change it together with core.
 *
 * Parsing is deliberately tolerant: unknown section types and statuses render
 * as labelled placeholders instead of failing the whole page.
 */
import type { PluginTransport } from "@pythia/widget-sdk";
import { z } from "zod";
import { INSTRUMENT_KINDS } from "./search";
import { providerRefSchema } from "./widgets/contract";

/** Core plugin id; feature query keys start with the serving plugin (ADR 0036). */
export const SUBJECT_PLUGIN = "pythia";

const text = z.string().min(1);
/** Absent, null and empty text all mean "not known". */
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value || null);

export const SECTION_STATUSES = [
  "ready",
  "resolving",
  "needs_configuration",
  "unresolved",
  "conflict",
  "disabled",
] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];

const pluginRequestSchema = z.object({
  plugin: text,
  operation: text,
  arguments: z.record(z.string(), z.unknown()),
});

export const subjectSectionSchema = z.object({
  /** "quote" | "chart" | "profile" | "filings"; later types render as placeholders. */
  section: text,
  plugin: text,
  label: text,
  status: text,
  binding: providerRefSchema.nullish(),
  /** The read that fills a profile or filings section; null for quote/chart. */
  request: pluginRequestSchema.nullish(),
  alternatives: z
    .array(z.object({ plugin: text, label: text, status: text }))
    .default([]),
  reason: optionalText,
});
export type SubjectSection = z.infer<typeof subjectSectionSchema>;

export const subjectListingSchema = z.object({
  id: text,
  ticker: optionalText,
  mic: optionalText,
  venue: optionalText,
  currency: optionalText,
  primary: z.boolean().default(false),
  /** The listed security's kind: a folded receipt is labelled as one. */
  kind: z.enum(INSTRUMENT_KINDS).nullish().catch(null),
});
export type SubjectListing = z.infer<typeof subjectListingSchema>;

export const subjectPageSchema = z.object({
  subject: z.object({
    id: text,
    level: text,
    name: text,
    kind: z.enum(INSTRUMENT_KINDS).nullish().catch(null),
  }),
  identifiers: z.record(z.string(), optionalText).default({}),
  issuer: z
    .object({
      id: text,
      name: text,
      lei: optionalText,
      cik: optionalText,
    })
    .nullish(),
  security: z.object({ id: text, name: text, isin: optionalText }).nullish(),
  listings: z.array(subjectListingSchema).default([]),
  sections: z.array(subjectSectionSchema).default([]),
  /** Open conflict/residual items; the page only counts them. */
  queue: z.array(z.unknown()).default([]),
});
export type SubjectPage = z.infer<typeof subjectPageSchema>;

/** Postal address as core passes it through: display text or address fields. */
const addressSchema = z
  .union([z.string(), z.record(z.string(), z.unknown())])
  .nullish();

/** Normalized output of a profile section read (for example GLEIF). */
export const profileSchema = z.object({
  name: optionalText,
  legal_name: optionalText,
  identifiers: z.record(z.string(), optionalText).default({}),
  jurisdiction: optionalText,
  legal_address: addressSchema,
  headquarters: addressSchema,
  status: optionalText,
  category: optionalText,
  parent: z.object({ name: text, lei: optionalText }).nullish(),
  source: z.object({ label: text, url: z.string().nullish() }).nullish(),
});
export type Profile = z.infer<typeof profileSchema>;

/** Normalized output of a filings section read (XBRL filings, SEC). */
export const filingsSchema = z.object({
  filings: z
    .array(
      z.object({
        title: optionalText,
        period_end: optionalText,
        filed_at: optionalText,
        form: optionalText,
        url: z.string().nullish(),
        language: optionalText,
      }),
    )
    .default([]),
  source: z.object({ label: text, url: z.string().nullish() }).nullish(),
});
export type Filings = z.infer<typeof filingsSchema>;

/** Query key of one subject's page, shared by the search bar's prefetch and
 * the instrument route so a chosen row opens on cached data. */
export function subjectQueryKey(subjectId: string) {
  return ["plugin", SUBJECT_PLUGIN, "identity-subject", subjectId] as const;
}
export const SUBJECT_STALE_MS = 30_000;

const answer = z.object({
  outcome: z.string().optional(),
  data: z.unknown(),
  issues: z.array(z.object({ message: z.string() })).optional(),
});

/** Pythia envelopes answer "empty" or "error" with null data and an issue. */
function coreData<T extends z.ZodType>(value: unknown, data: T): z.infer<T> {
  const parsed = answer.parse(value);
  if (parsed.data === null || parsed.data === undefined)
    throw Error(
      parsed.issues?.[0]?.message ?? "Nothing is known about this subject.",
    );
  return data.parse(parsed.data);
}

export async function readSubject(
  transport: Pick<PluginTransport, "read">,
  subjectId: string,
  signal?: AbortSignal,
): Promise<SubjectPage> {
  const value = await transport.read(
    {
      plugin: SUBJECT_PLUGIN,
      operation: "identity-subject",
      arguments: { subject_id: subjectId },
    },
    signal,
  );
  return coreData(value, subjectPageSchema);
}

/** Asks one plugin to resolve the subject's address; answers with that
 * plugin's updated sections. Core stores the resulting binding or queue item,
 * so this is an invoke (the deliberate page open), never an automatic read. */
export async function resolveSections(
  transport: Pick<PluginTransport, "invoke">,
  subjectId: string,
  plugin: string,
  signal?: AbortSignal,
): Promise<SubjectSection[]> {
  const value = await transport.invoke(
    {
      plugin: SUBJECT_PLUGIN,
      operation: "identity-resolve",
      arguments: { subject_id: subjectId, plugin },
    },
    signal,
  );
  return coreData(value, z.object({ sections: z.array(subjectSectionSchema) }))
    .sections;
}

export function parseProfile(value: unknown): Profile {
  return coreData(value, profileSchema);
}
export function parseFilings(value: unknown): Filings {
  return coreData(value, filingsSchema);
}
