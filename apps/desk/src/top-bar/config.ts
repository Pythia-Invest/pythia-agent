import { z } from "zod";

export const TOP_BAR_CONFIG_PATH = "desk/top-bar.json";
export const TOP_BAR_INPUT_CONTRACT = "pythia.desk-topbar.v1";
const rendererSchema = z
  .object({
    plugin: z
      .string()
      .max(129)
      .regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/u),
    asset: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
    presentation: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
  })
  .strict();
export type TopBarRenderer = z.infer<typeof rendererSchema>;
/** Product default only; a user's explicit null always selects the core bar. */
export const DEFAULT_TOP_BAR: TopBarRenderer | null = {
  plugin: "pythia-market-data",
  asset: "top-bar",
  presentation: "top-bar",
};
export const topBarConfigSchema = z
  .object({
    version: z.literal(1),
    renderer: rendererSchema.nullable(),
    settings: z.record(z.string(), z.json()).default({}),
  })
  .strict();
export type TopBarSelection = {
  renderer: TopBarRenderer | null;
  settings: Record<string, unknown>;
  moduleUrl?: string;
  issue?: string;
};
