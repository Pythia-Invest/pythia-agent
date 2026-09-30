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
import { contributorSchema } from "./contributors";
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

const pluginRequestSchema = z.object({
  plugin: text,
  operation: text,
  arguments: z.record(z.string(), z.unknown()),
});

/** A source as core names it on sections and in agent results. */
const sourceSchema = z.object({
  source: text,
  provider: text,
  plugin: text,
});

/** Another source that could serve the section now: one click reads it
 * instead, for this view only. */
export const sectionAlternativeSchema = z.object({
  plugin: text,
  label: text,
  status: text,
  binding: providerRefSchema.nullish(),
  request: pluginRequestSchema.nullish(),
  authorities: z.array(text).default([]), // a filings source's authorities
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
  binding: providerRefSchema.nullish(),
  /** The read that fills a profile or filings section; null for quote/chart. */
  request: pluginRequestSchema.nullish(),
  /** Eligible sources not chosen; the investor can use one once. */
  alternatives: z.array(sectionAlternativeSchema).default([]),
  reason: optionalText,
  /** Set on an `unresolved` section whose source's match waits in the
   * resolution queue (the review reason: ambiguous, no_key,
   * underlying_identifier);
   * absent when the source found no match. */
  queued: text.nullish(),
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

const contestedValue = z.object({ value: text, sources: z.array(text) });

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
  /** Identifiers whose sources disagree, by scheme: core
   * applies neither value, so each is listed with the sources stating it. */
  contested: z.record(z.string(), z.array(contestedValue)).default({}),
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
  /** The plugins behind the subject: a device subject's names the one that
   * introduced it, whose status its page shows. */
  contributors: z.array(contributorSchema).default([]),
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
  /** The accounting parent; GLEIF may know its LEI but not its name. */
  parent: z.object({ name: optionalText, lei: optionalText }).nullish(),
  /** Typed names: a Latin one is shown beside a legal name in another script. */
  names: z
    .array(z.object({ name: text, kind: optionalText, type: optionalText }))
    .catch([]),
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
        /** Shared by parallel reports: issuer, kind and period end. */
        report_period: optionalText,
        basis: optionalText, // us_gaap or ifrs, where the source states it
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
  /** Combined reads: the sources that supplied the rows, and those that failed. */
  sources: z
    .array(
      sourceSchema.extend({
        provider: optionalText,
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

/** Query key of one subject's page, shared by the instrument route and markets
 * rows so a row opens on cached data. Search never reads it: a read queues. */
export function subjectQueryKey(subjectId: string) {
  return ["plugin", SUBJECT_PLUGIN, "identity-subject", subjectId] as const;
}
export const SUBJECT_STALE_MS = 30_000;

const answer = z.object({
  outcome: z.string().optional(),
  data: z.unknown(),
  issues: z
    .array(z.object({ code: z.string().optional(), message: z.string() }))
    .optional(),
});

/** Pythia envelopes answer "empty" with null data and an issue; an "error"
 * may carry what was tried as data, and is still a failure (D1). The error
 * carries core's issue `code` (`unknown_subject`: a retry cannot help). */
export function coreData<T extends z.ZodType>(
  value: unknown,
  data: T,
): z.infer<T> {
  const parsed = answer.parse(value);
  if (
    parsed.outcome === "error" ||
    parsed.data === null ||
    parsed.data === undefined
  )
    throw Object.assign(
      Error(
        parsed.issues?.[0]?.message ?? "Nothing is known about this subject.",
      ),
      { code: parsed.issues?.[0]?.code ?? null },
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
