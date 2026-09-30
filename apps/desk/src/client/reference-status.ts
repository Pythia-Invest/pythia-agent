"use client";
import { SUBJECT_PLUGIN } from "@pythia/market-data/subject";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useDeskApi } from "./providers";

/*
 * Core's `reference-status`: the reference package installed on this device,
 * with its build, dates and the notices its sources require. Installing one
 * is a lifecycle step, never a Desk action.
 */

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value || null);

export const referenceStatusSchema = z.object({
  data: z
    .object({
      installed: z
        .object({
          build_id: z.string().min(1),
          as_of: z.string().min(1),
          built_at: z.string().min(1),
          format_version: z.number().int(),
          installed_at: optionalText,
          compatible: z.boolean(),
          /** Why this Pythia cannot read it (too old: rebuild it; newer: update Pythia), in core's words. */
          problem: optionalText,
          sources: z
            .array(
              z.object({
                source: z.string().min(1),
                as_of: optionalText,
                licence: optionalText,
              }),
            )
            .default([]),
          notices: z.array(z.string().min(1)).default([]),
        })
        .nullish(),
      /** An earlier copy of Pythia's store still beside the current one, until deleted by hand. */
      both_present: z.string().nullish(),
      /** The last package the installer refused; cleared once one installs. */
      refused: z
        .object({
          at: optionalText,
          package: optionalText,
          message: z.string().min(1),
        })
        .nullish(),
    })
    .nullish(),
  issues: z.array(z.object({ message: z.string() })).default([]),
});
export type ReferenceStatus = NonNullable<
  z.infer<typeof referenceStatusSchema>["data"]
>;

export function useReferenceStatus() {
  const api = useDeskApi();
  return useQuery({
    queryKey: ["plugin", SUBJECT_PLUGIN, "reference-status"],
    queryFn: async () =>
      referenceStatusSchema.parse(
        await api.pluginRead({
          plugin: SUBJECT_PLUGIN,
          operation: "reference-status",
          arguments: {},
        }),
      ),
  });
}
