/**
 * Provisional contract of the core local `search` operation, and the only place
 * its request and response types live.
 *
 * Search is one read of the device's directory index: no connector is called
 * while typing, nothing is reconciled and rows carry no prices. The core ranks
 * one row per instrument (a security, with its depositary receipts folded in,
 * or a crypto asset) and picks the listing that represents it; clients keep
 * that order. The directory-search backend implements this shape; change it
 * here first.
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

/** One instrument, shown through its representative listing: a listing the
 * query names (exact ticker, provider symbol, venue), else the investor's
 * listing preference (primary market, EU or US). */
export const searchRowSchema = z.object({
  /** Subject id of the representative listing (crypto: of the asset).
   * Instrument pages address it; it is never a provider symbol. */
  id: text(256),
  /** Subject id of the instrument's security (crypto: the asset). */
  security: text(256),
  ticker: text(64),
  name: text(512),
  kind: z.enum(INSTRUMENT_KINDS),
  mic: text(16).nullable(),
  /** Short venue label, such as "Euronext Amsterdam". */
  venue: text(128).nullable(),
  /** ISO 3166 country of the venue. */
  country: z.string().length(2).nullable(),
  /** The instrument's other listings, receipts included. */
  listings: z.number().int().min(0),
  /** Confirmed provider bindings only; candidates are never shown. */
  bindings: z.array(z.object({ plugin: text(64), ref: text(256) })).max(16),
});
export type SearchRow = z.infer<typeof searchRowSchema>;
export type SearchBinding = SearchRow["bindings"][number];

export const searchResponseSchema = z.object({
  rows: z.array(searchRowSchema).max(50),
  /** Enabled plugins offering an explicit single-provider lookup. */
  lookup: z.array(z.object({ plugin: text(64), label: text(128) })).max(8),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type LookupOffer = SearchResponse["lookup"][number];

export type SearchRequest = {
  query: string;
  /** Type filter; omitted means every kind. */
  kinds?: InstrumentKind[];
  /** Maximum number of rows. */
  limit: number;
};

/** One explicit lookup, in exactly one plugin, of a query the directory does
 * not hold. It is never issued while typing or to several plugins at once, and
 * answers with rows whose ids are subject ids. */
export type LookupRequest = { plugin: string; query: string };
