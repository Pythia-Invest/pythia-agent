/**
 * Provisional wire shape of the core local directory `search` operation.
 *
 * Search is a read of the device's directory index; no connector is called while
 * typing. This file mirrors the shape agreed for the identity-backbone work until
 * the contracts change (ADR 0038 with the directory row and search response types)
 * lands; align it with that contract then. Every other search-ui module imports
 * its types from here.
 */
import { z } from "zod";

export const ROW_KINDS = [
  "equity",
  "etf",
  "fund",
  "bond",
  "index",
  "fx",
  "crypto",
] as const;
export type RowKind = (typeof ROW_KINDS)[number];

const text = (max: number) => z.string().min(1).max(max);
const optionalText = (max: number) => z.string().max(max).nullish();

/** One venue listing or one crypto asset. Provider symbols are bindings on the
 * row, never its identity. */
export const searchRowSchema = z.object({
  /** Directory subject id of the listing or crypto asset; pages address it. */
  row_id: text(256),
  kind: z.enum(ROW_KINDS),
  name: text(512),
  ticker: optionalText(64),
  mic: optionalText(16),
  venue_label: optionalText(128),
  country: optionalText(8),
  currency: optionalText(16),
  /** ISIN or crypto asset id. Rows sharing it are listings of one security. */
  security_id: optionalText(128),
  /** LEI or CIK of the issuer. */
  issuer_id: optionalText(128),
  is_primary: z.boolean(),
  bindings: z.array(z.object({ plugin: text(128), ref: text(512) })).max(32),
  /** Short display markers such as `ADR` or `OTC`. */
  badges: z.array(text(32)).max(8).optional(),
});
export type SearchRow = z.infer<typeof searchRowSchema>;
export type SearchBinding = SearchRow["bindings"][number];

/** Optional server grouping. The first row id is the listing shown; the others
 * are expandable. Without it, clients group rows by `security_id`. */
export const searchGroupSchema = z.object({
  key: text(256),
  row_ids: z.array(text(256)).min(1).max(64),
});
export type SearchGroupHint = z.infer<typeof searchGroupSchema>;

export const searchResponseSchema = z.object({
  query: z.string().max(512),
  /** Ranked by the core ranking policy; clients keep this order. */
  results: z.array(searchRowSchema).max(200),
  groups: z.array(searchGroupSchema).max(200).optional(),
  /** Directory snapshot the rows were read from. */
  snapshot: z.object({ version: text(128), as_of: text(64) }),
  took_ms: z.number().nonnegative(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/** Arguments of the provisional request. A backend that ignores `kinds` stays
 * correct: clients also filter the returned rows by kind. */
export type SearchRequest = {
  query: string;
  kinds?: RowKind[];
  limit: number;
};

/** One explicit, single-provider lookup of a query that is not in the index.
 * Never issued while typing and never to several providers at once. */
export type LookupRequest = { provider: string; query: string };
