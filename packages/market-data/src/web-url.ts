import { z } from "zod";

/** A link target a source supplies: an http(s) address, normalised. Any
 * other scheme, and a relative or malformed value, reads as no link, so a
 * source cannot make the page link to something that is not a web page. */
export const webUrl = z
  .string()
  .nullish()
  .transform((value) => {
    try {
      const url = new URL(value ?? "");
      return url.protocol === "https:" || url.protocol === "http:"
        ? url.href
        : null;
    } catch {
      return null;
    }
  });
