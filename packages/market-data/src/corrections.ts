import { z } from "zod";

const text = z.string().min(1);
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value || null);

/** One of the investor's corrections that applies to this subject's family
 * (`active`), or an agent's proposal waiting for them (`proposed`). An
 * `identifier` correction has a scheme and a value (null removes it); a
 * `price_source` one names the pinned plugin in `value`. */
export const correctionViewSchema = z.object({
  id: text,
  kind: text,
  subject_id: text,
  scheme: optionalText,
  value: optionalText,
  state: text,
});
export type CorrectionView = z.infer<typeof correctionViewSchema>;
