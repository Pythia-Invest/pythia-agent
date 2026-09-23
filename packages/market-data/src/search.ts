import { z } from "zod";

const text = z.string().min(1).max(512);
const scope = z.enum(["company", "instrument", "listing", "crypto"]);
// Presentation classification is distinct from identity scope. A listing can
// represent an equity, ETF or another product; unknown remains unclassified.
export const investmentCategorySchema = z.enum([
  "equity",
  "etf",
  "fund",
  "index",
  "forex",
  "crypto",
  "future",
  "option",
  "bond",
  "commodity",
  "other",
]);
export type InvestmentCategory = z.infer<typeof investmentCategorySchema>;
const qualifiers = z
  .object({
    currency: text.optional(),
    venue: text.optional(),
    route: text.optional(),
    share_class: text.optional(),
    network: text.optional(),
  })
  .strict();
const nativeRef = z
  .object({
    provider: text,
    native_id: text,
    native_scope: text,
    qualifiers: qualifiers.optional(),
  })
  .strict();
const subject = z.object({ kind: scope, id: text }).strict();
const identityStatus = z.enum(["confirmed", "unresolved", "conflicting"]);
const issue = z
  .object({
    code: text,
    message: z.string().max(2048),
    severity: z.enum(["warning", "error"]),
  })
  .passthrough();
const metadata = z.record(
  text,
  z.union([z.string().max(512), z.boolean(), z.null()]),
);

export const investmentSearchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(512),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export const investmentSearchReferenceSchema = z
  .object({
    native_ref: nativeRef,
    name: text.nullable(),
    symbol: text.nullable(),
    kind: scope.nullable().optional(),
    currency: text.nullable().optional(),
    venue: text.nullable().optional(),
    subject: subject.nullable().optional(),
    status: identityStatus,
    available: z.boolean(),
    mapping_id: text.optional(),
    metadata: metadata.optional(),
  })
  .strict();
export const investmentSearchResultSchema = z
  .object({
    id: text,
    subject: subject.nullable(),
    name: text.nullable(),
    symbol: text.nullable(),
    kind: scope.nullable(),
    category: investmentCategorySchema.nullable().optional(),
    currency: text.nullable(),
    venue: text.nullable(),
    identity_status: identityStatus,
    references: z.array(investmentSearchReferenceSchema).min(1),
  })
  .strict();
export const investmentSearchDataSchema = z
  .object({
    results: z.array(investmentSearchResultSchema).max(100),
    coverage: z.array(
      z
        .object({
          provider: text,
          status: z.enum([
            "ok",
            "empty",
            "partial",
            "error",
            "unavailable",
            "unsupported",
          ]),
          issues: z.array(issue),
          truncated: z.boolean(),
        })
        .strict(),
    ),
    truncated: z.boolean(),
  })
  .strict();
export const investmentSearchResponseSchema = z
  .object({
    schema_version: z.literal(1),
    outcome: z.enum(["ok", "empty", "partial", "error"]),
    data: investmentSearchDataSchema,
    issues: z.array(issue),
  })
  .strict();
export const investmentAdoptRequestSchema = z
  .object({
    native_ref: nativeRef,
    scope,
    references: z.array(nativeRef).min(2).max(8).optional(),
    binding_mode: z.enum(["preferred", "source"]).optional(),
  })
  .strict();
export const investmentAdoptDataSchema = z
  .object({
    subject,
    binding: z.union([subject, nativeRef]),
    identity_status: identityStatus,
    mapping_id: text,
  })
  .strict();
export const investmentAdoptResponseSchema = z
  .object({
    schema_version: z.literal(1),
    outcome: z.enum(["ok", "partial"]),
    data: investmentAdoptDataSchema,
    issues: z.array(issue),
    effect: z.literal("local_write"),
  })
  .strict();
export type InvestmentSearchResult = z.infer<
  typeof investmentSearchResultSchema
>;
export type InvestmentSearchReference = z.infer<
  typeof investmentSearchReferenceSchema
>;
export type InvestmentSearchData = z.infer<typeof investmentSearchDataSchema>;
export type InvestmentSearchRequest = z.infer<
  typeof investmentSearchRequestSchema
>;
export type InvestmentAdoptRequest = z.infer<
  typeof investmentAdoptRequestSchema
>;
export type InvestmentAdoptData = z.infer<typeof investmentAdoptDataSchema>;
