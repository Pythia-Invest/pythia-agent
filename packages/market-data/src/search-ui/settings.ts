import { z } from "zod";

/** Initial search participation; local pill choices remain component state. */
export const searchSettingsSchema = z
  .object({
    excludedProviders: z.array(z.string().min(1).max(512)).max(16).default([]),
  })
  .strict();
