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

/** Core marks a source that has not signed off (ADR 0042): "not yet audited". */
const unaudited = z.boolean().optional();

/** A source as core names it on sections and in agent results. */
const sourceSchema = z.object({
  source: text,
  provider: text,
  plugin: text,
  unaudited,
});

/** Another source that could serve the section now: one click reads it
 * instead, for this view only. */
export const sectionAlternativeSchema = z.object({
  plugin: text,
  label: text,
  status: text,
  binding: providerRefSchema.nullish(),
  request: pluginRequestSchema.nullish(),
  unaudited,
});
export type SectionAlternative = z.infer<typeof sectionAlternativeSchema>;

/** A source that declares the concept but does not serve this subject, with
 * core's plain reason (code: not_covering, not_addressable, disabled, ...). */
export const sectionSkipSchema = sourceSchema.extend({
  code: text,
  reason: text,
});
export type SectionSkip = z.infer<typeof sectionSkipSchema>;

export const subjectSectionSchema = z.object({
  /** "quote" | "chart" | "profile" | "filings"; later types render as placeholders. */
  section: text,
  /** The level the plugin addresses this section through ("issuer" for a
   * company profile or filings, "listing" for a quote). */
  via: text.nullish(),
  plugin: text,
  label: text,
  status: text,
  unaudited,
  binding: providerRefSchema.nullish(),
  /** The read that fills a profile or filings section; null for quote/chart. */
  request: pluginRequestSchema.nullish(),
  /** Eligible sources not chosen; the investor can use one once. */
  alternatives: z.array(sectionAlternativeSchema).default([]),
  reason: optionalText,
  /** When a read of the serving address last agreed with the reference
   * (core's read check), or why it did not ("currency differs"); it still serves. */
  verified_at: text.nullish(),
  unverified: text.nullish(),
  source: sourceSchema.nullish(),
  skipped: z.array(sectionSkipSchema).default([]),
  /** Filings: the sources combined, one per filing authority. */
  sources: z
    .array(sourceSchema.extend({ authorities: z.array(text).default([]) }))
    .nullish(),
  /** Set only when a source ranked ahead of the chosen one could have served
   * and did not (named by the investor, contradicted, not found): amber. */
  notice: sectionSkipSchema.nullish(),
});
export type SubjectSection = z.infer<typeof subjectSectionSchema>;

export const subjectListingSchema = z.object({
  id: text,
  ticker: optionalText,
  mic: optionalText,
  venue: optionalText,
  currency: optionalText,
  primary: z.boolean().default(false),
  /** No primary is known, and this line is on FIRDS' most liquid EU market:
   * the one priced, labelled as such and never as the primary. */
  most_liquid: z.boolean().default(false),
  /** The listed security's kind: a folded receipt is labelled as one. */
  kind: z.enum(INSTRUMENT_KINDS).nullish().catch(null),
  /** A line of a security that folds into the instrument (a receipt), not
   * of the instrument's own security. */
  folded: z.boolean().default(false),
});
export type SubjectListing = z.infer<typeof subjectListingSchema>;

/** A subject linked to this one by a `related` relation (a wrapped token, the
 * index a fund tracks, a successor): its own subject, never folded into the
 * page. `kind` is the subject's kind (the ID's first segment), passed through
 * as text so kinds this client does not know still render. */
export const relatedSubjectSchema = z.object({
  id: text,
  type: text,
  /** "to": this subject is the relation's source (a wrapped token's page, "to" the asset it wraps). */
  direction: z.enum(["to", "from"]).nullish().catch(null),
  kind: text,
  name: optionalText,
});
export type RelatedSubject = z.infer<typeof relatedSubjectSchema>;

export const subjectPageSchema = z.object({
  subject: z.object({
    id: text,
    /** The subject's kind: an instrument level or any other kind, opaque. */
    level: text,
    name: text,
    kind: z.enum(INSTRUMENT_KINDS).nullish().catch(null),
    /** The listing whose quote and chart this composition shows (a
     * security's or issuer's page shows one of its listings). */
    listing: text.nullish(),
    /** A market subject's line of context from core's catalogue ("US large
     * caps", "WTI, front month (NYMEX)"). */
    description: optionalText,
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
  related: z.array(relatedSubjectSchema).default([]),
  /** The company's other instruments (share classes, preferreds): its search
   * group less this instrument, each with its representative listing. Empty
   * for a fund, note or crypto asset. */
  other_securities: z
    .array(
      z.object({
        id: text,
        name: optionalText,
        kind: z.enum(INSTRUMENT_KINDS).nullish().catch(null),
        listing: optionalText,
        ticker: optionalText,
        mic: optionalText,
        venue: optionalText,
        currency: optionalText,
      }),
    )
    .default([]),
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

/** Output of a filings section read: one source's list, or core's combined
 * list where each item names its source and filing authority. */
export const filingsSchema = z.object({
  filings: z
    .array(
      z.object({
        id: optionalText,
        /** annual, half_year, quarterly, earnings_release, event,
         * ownership, prospectus or other. */
        kind: optionalText,
        title: optionalText,
        period_end: optionalText,
        filed_at: optionalText,
        /** The exact UTC time of filing, where the source has it. */
        filed_time: optionalText,
        form: optionalText,
        format: optionalText,
        /** A periodic report's identity (issuer, kind, period end,
         * authority): items sharing it are versions of one report (format,
         * language, amendment), shown as one row and never merged. */
        report_key: optionalText,
        url: z.string().nullish(),
        language: optionalText,
        source: optionalText,
        authority: optionalText,
        /** The date that orders the list and its basis: "filed", "indexed"
         * (the day the source indexed a report without a filing date) or
         * "period_end". */
        date: optionalText,
        date_basis: optionalText,
      }),
    )
    .default([]),
  source: z.object({ label: text, url: z.string().nullish() }).nullish(),
  /** Combined reads: the sources read and those that failed. */
  sources: z
    .array(
      z.object({
        source: text,
        plugin: text,
        authorities: z.array(text).default([]),
        url: z.string().nullish(),
      }),
    )
    .default([]),
  skipped: z.array(sectionSkipSchema).default([]),
  partial: z.boolean().default(false),
  /** The subject the combined list was read for; its documents are read
   * through it. */
  subject_id: optionalText,
});
export type Filings = z.infer<typeof filingsSchema>;

const documentPart = z.object({ id: text, title: text, chars: z.number() });
const citationSchema = z.object({
  section: text,
  section_title: optionalText,
  offsets: z.array(z.number()).default([]),
  /** The document's URL, at the section's anchor where it has one. */
  url: z.string().nullish(),
});
/** Core's document read (`filings-read`): an outline, one bounded part of a
 * section, or search passages, each part cited. */
export const filingDocumentSchema = z.object({
  document: z.object({
    id: text,
    form: optionalText,
    title: optionalText,
    url: z.string().nullish(),
  }),
  sections: z.array(documentPart).optional(),
  section: documentPart.optional(),
  text: z.string().optional(),
  /** Where the rest of a long section starts; null at its end. */
  continue_from: z.number().nullish(),
  citation: citationSchema.optional(),
  passages: z
    .array(z.object({ text: z.string(), citation: citationSchema }))
    .optional(),
});
export type FilingDocument = z.infer<typeof filingDocumentSchema>;

/** A read of one filing's document: its outline, a section from `start`, or
 * a search; the filing is named by its version's id. */
export function filingDocumentRequest(
  subjectId: string,
  id: string,
  read: {
    section?: string;
    start?: number | undefined;
    query?: string;
  } = {},
) {
  return {
    plugin: SUBJECT_PLUGIN,
    operation: "filings-read",
    arguments: { subject_id: subjectId, id, ...read },
  };
}

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
export function parseFilingDocument(value: unknown): FilingDocument {
  return coreData(value, filingDocumentSchema);
}
