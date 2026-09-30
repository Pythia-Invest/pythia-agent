import { z } from "zod";

/**
 * A fact the page leaves out while an open question about it is unanswered
 * (ADR 0037, amendment "open data conflicts on the page"): an identifier
 * scheme, or `issuer`, `security`, `underlying` (the share a receipt
 * represents) or `kind` (share or receipt). `question` is its queue item,
 * `options` how many answers it offers. The page says "open data conflict"
 * there and links to the repair, never a blank.
 */
export const withheldFactSchema = z.object({
  fact: z.string().min(1),
  question: z.string().min(1),
  options: z.number().default(0),
});
export type WithheldFact = z.infer<typeof withheldFactSchema>;
