/**
 * Provisional contract of the core local `search` operation, and the only place
 * its request and response types live.
 *
 * Search is one read of the device's directory index: no connector is called
 * while typing or by any search action, nothing is reconciled and rows carry no
 * prices. A plugin's own functions live on its own page. The core ranks
 * groups (a company, a fund, a crypto asset) and orders each group's listings,
 * relevant ones first; clients keep both orders. The directory-search backend
 * implements this shape; change it here first.
 */
import { z } from "zod";

/** Instrument kinds of the identity vocabulary (ADR 0037), and the subjects
 * outside the instrument hierarchy a plugin may introduce: a market (a
 * lending pool, a vault) and a DeFi protocol. */
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
  "market",
  "protocol",
] as const;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];

const text = (max: number) => z.string().min(1).max(max);

/** One listing of a search group, a crypto asset, or a subject a plugin
 * introduced (a pool or protocol is its own group). */
export const searchRowSchema = z.object({
  /** Subject id of the listing (crypto: of the asset). The instrument page
   * shows its price; it is never a provider symbol. */
  id: text(256),
  /** Subject id of the instrument the listing belongs to (a receipt's is the
   * share it folds into), which the instrument page is; absent when
   * unknown. */
  instrument: text(256).nullish(),
  /** Absent for a subject that has none, such as a pool or a protocol. */
  ticker: text(64).nullable(),
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
  /** The plugin that introduced the subject, as its label; absent for the
   * reference's own subjects. */
  source: text(128).nullish(),
  /** The line no longer trades (its source marks it inactive). Absent for a
   * live line. Core ranks delisted lines below live ones; the instrument
   * page still refuses a live price through them. */
  delisted: z.boolean().optional(),
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
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export type SearchRequest = {
  query: string;
  /** A group id from an earlier answer: read all of that group's listings
   * instead of searching. */
  group?: string;
  /** Type filter; omitted means every kind. */
  kinds?: InstrumentKind[];
  /** Maximum number of groups; a group read ignores it. */
  limit?: number;
  /** Delisted lines are included unless this is false. */
  include_delisted?: boolean;
};
