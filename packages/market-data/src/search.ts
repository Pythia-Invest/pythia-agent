/**
 * Provisional contract of the core local `search` operation, and the only place
 * its request and response types live.
 *
 * Search is one read of the device's directory index: no connector is called
 * while typing, nothing is reconciled and rows carry no prices. The core ranks
 * groups (a company, a fund, a crypto asset) and orders each group's listings,
 * relevant ones first; clients keep both orders. The directory-search backend
 * implements this shape; change it here first.
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

/** One listing of a search group, or a crypto asset. */
export const searchRowSchema = z.object({
  /** Subject id of the listing (crypto: of the asset). The instrument page
   * shows its price; it is never a provider symbol. */
  id: text(256),
  /** Subject id of the instrument the listing belongs to (a receipt's is the
   * share it folds into), which the instrument page is; absent when unknown,
   * as for an explicit lookup's answer. */
  instrument: text(256).nullish(),
  ticker: text(64),
  /** The listed security's own name (a share class, registry shares). */
  name: text(512),
  /** The listed security's kind: registry shares read as a receipt. */
  kind: z.enum(INSTRUMENT_KINDS),
  mic: text(16).nullable(),
  /** Short venue label, such as "Euronext Amsterdam". */
  venue: text(128).nullable(),
  /** ISO 3166 country of the venue. */
  country: z.string().length(2).nullable(),
  currency: text(16).nullable(),
});
export type SearchRow = z.infer<typeof searchRowSchema>;

/** Where a chosen row leads: the instrument's page, showing that listing. */
export function rowTarget(row: SearchRow) {
  return { subjectId: row.instrument ?? row.id, listingId: row.id };
}

/** One of core's search groups (ADR 0037): a company (its share classes,
 * receipts and registry lines), a fund, ETF or ETN, or a crypto asset. A
 * search answer carries its relevant listings (a listing the query names, the
 * preferred market, the primary listing, other classes and receipts) and
 * `listings`, how many it has in all; a group read (`SearchRequest.group`)
 * carries all of them. */
export const searchGroupSchema = z.object({
  /** Issuer, fund or crypto-asset subject id. */
  id: text(256),
  name: text(512),
  /** The company's main instrument kind, for type labels. */
  kind: z.enum(INSTRUMENT_KINDS),
  listings: z.number().int().min(1),
  rows: z.array(searchRowSchema).min(1).max(500),
});
export type SearchGroup = z.infer<typeof searchGroupSchema>;

export const searchResponseSchema = z.object({
  groups: z.array(searchGroupSchema).max(50),
  /** Enabled plugins offering an explicit single-provider lookup. */
  lookup: z.array(z.object({ plugin: text(64), label: text(128) })).max(8),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type LookupOffer = SearchResponse["lookup"][number];

export type SearchRequest = {
  query: string;
  /** A group id from an earlier answer: read all of that group's listings
   * instead of searching. */
  group?: string;
  /** Type filter; omitted means every kind. */
  kinds?: InstrumentKind[];
  /** Maximum number of groups. */
  limit: number;
};

/** One explicit lookup, in exactly one plugin, of a query the directory does
 * not hold. It is never issued while typing or to several plugins at once, and
 * answers with groups whose row ids are subject ids. */
export type LookupRequest = { plugin: string; query: string };
