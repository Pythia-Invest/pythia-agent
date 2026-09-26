/**
 * Provisional contract of the core local `search` operation, and the only place
 * its request and response types live.
 *
 * Search is one read of the device's directory index: no connector is called
 * while typing, nothing is reconciled and rows carry no prices. The core ranks
 * securities and orders each one's listings, primary listing first; clients
 * keep both orders. The directory-search backend implements this shape; change
 * it here first.
 */
import { z } from "zod";

/** Instrument kinds of the identity vocabulary (ADR 0037). */
export const INSTRUMENT_KINDS = [
  "ordinary",
  "preferred",
  "depositary_receipt",
  "etf",
  "fund",
  "bond",
  "index",
  "fx",
  "coin",
  "token",
  "other",
] as const;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];

const text = (max: number) => z.string().min(1).max(max);

/** One venue listing, or a crypto asset, which has no venue. */
export const searchRowSchema = z.object({
  /** Subject id of the listing (crypto: of the asset). Instrument pages
   * address it; it is never a provider symbol. */
  id: text(256),
  ticker: text(64),
  mic: text(16).nullable(),
  /** Venue label, such as "Euronext Amsterdam". */
  venue: text(128).nullable(),
  currency: text(16).nullable(),
  /** The security's primary listing. */
  primary: z.boolean(),
  /** Confirmed provider bindings only; candidates are never shown. */
  bindings: z.array(z.object({ plugin: text(64), ref: text(256) })).max(16),
});
export type SearchRow = z.infer<typeof searchRowSchema>;
export type SearchBinding = SearchRow["bindings"][number];

/** One security and its listings. */
export const searchGroupSchema = z.object({
  /** Security subject id (crypto: the asset). */
  id: text(256),
  name: text(512),
  kind: z.enum(INSTRUMENT_KINDS),
  /** The underlying security of a depositary receipt. */
  depositary_of: z.object({ id: text(256), name: text(512) }).nullable(),
  rows: z.array(searchRowSchema).min(1).max(8),
});
export type SearchGroup = z.infer<typeof searchGroupSchema>;

export const searchResponseSchema = z.object({
  query: z.string().max(512),
  groups: z.array(searchGroupSchema).max(50),
  /** What the rows were read from: the reference snapshot build, if any, and
   * the instant of the newest directory change. */
  directory: z.object({ snapshot: text(128).nullable(), as_of: text(64) }),
  /** Enabled plugins offering an explicit single-provider lookup. */
  lookup: z.array(z.object({ plugin: text(64), label: text(128) })).max(8),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type LookupOffer = SearchResponse["lookup"][number];

export type SearchRequest = {
  query: string;
  /** Type filter; omitted means every kind. */
  kinds?: InstrumentKind[];
  /** Maximum number of groups. */
  limit: number;
};

/** One explicit lookup, in exactly one plugin, of a query the directory does
 * not hold. It is never issued while typing or to several plugins at once, and
 * answers with groups whose ids are subject ids. */
export type LookupRequest = { plugin: string; query: string };
