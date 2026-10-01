import { z } from "zod";

export const TOP_BAR_CONFIG_PATH = "desk/top-bar.json";
export const TOP_BAR_INPUT_CONTRACT = "pythia.desk-topbar.v1";
const rendererSchema = z
  .object({
    plugin: z
      .string()
      .max(129)
      .regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/u),
    presentation: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
  })
  .strict();
export type TopBarRenderer = z.infer<typeof rendererSchema>;
/** Product default when the workspace has no selection: the market-data
 * feature's investment-search bar. A user's explicit null always selects the
 * core bar; an unavailable default falls back to it without a warning. */
export const DEFAULT_TOP_BAR: TopBarRenderer | null = {
  plugin: "pythia-market-data",
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
