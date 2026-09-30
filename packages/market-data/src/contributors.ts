import { z } from "zod";

/**
 * A plugin behind a subject, as core's `identity-subject` lists it (ADR 0037,
 * amendment "device subjects"): its status now, whether it introduced the
 * subject, and since when a complete catalogue of it no longer offers the
 * subject. Tolerant like the rest of the page: an unknown status reads as
 * enabled rather than failing the page.
 */
export const contributorSchema = z.object({
  plugin: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["enabled", "disabled", "removed"]).catch("enabled"),
  introduced: z.boolean().default(false),
  not_offered_since: z
    .string()
    .nullish()
    .transform((value) => value || null),
});
export type Contributor = z.infer<typeof contributorSchema>;
