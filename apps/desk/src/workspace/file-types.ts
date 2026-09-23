/** A file extension includes its leading dot, including compound suffixes. */
export type FileExtension = `.${string}`;
export type CompoundFileType = {
  extension: FileExtension;
  preview: "visual";
  language: string;
  mediaType: string;
};

/** Immutable, typed filename matching only; declarations grant no execution authority.
 * Longest suffix wins regardless of declaration order. Paths must already be decoded. */
export function extensionMatcher<const T extends { extension: FileExtension }>(
  definitions: readonly T[],
): (path: string) => T | undefined {
  const seen = new Set<string>();
  const sorted = definitions
    .map((definition) => {
      const suffix = definition.extension;
      if (!/^\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/u.test(suffix) || seen.has(suffix))
        throw new Error(`Invalid or duplicate file extension: ${suffix}`);
      seen.add(suffix);
      return Object.freeze({ ...definition });
    })
    .sort((a, b) => b.extension.length - a.extension.length);
  return (path) => {
    const name = path.split("/").at(-1)?.toLowerCase() ?? "";
    return sorted.find(
      ({ extension }) =>
        name.length > extension.length && name.endsWith(extension),
    );
  };
}

// File-format declarations, not an inventory of installed/enabled plugins.
// Add future compound formats here; chat, Workspace and highlighting share this match.
export const compoundFileTypes = [
  {
    extension: ".vega-lite.json",
    preview: "visual",
    language: "json",
    mediaType: "application/json",
  },
] as const satisfies readonly CompoundFileType[];
export type KnownCompoundFileType = (typeof compoundFileTypes)[number];
export const compoundFileType = extensionMatcher(compoundFileTypes);

/** Ordinary final suffix, for container formats and unregistered file types. */
export function baseFileExtension(path: string): FileExtension | "" {
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1
    ? `.${name.slice(dot + 1).toLowerCase()}`
    : "";
}
export function fileExtension(path: string): FileExtension | "" {
  return compoundFileType(path)?.extension ?? baseFileExtension(path);
}
