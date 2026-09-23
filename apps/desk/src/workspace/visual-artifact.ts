import { z } from "zod";
import { resolveWorkspaceLink } from "./paths";
import { compoundFileType } from "./file-types";

export const VISUAL_ARTIFACT_BYTES = 262_144;
export const isVisualArtifact = (path: string) =>
  compoundFileType(path)?.preview === "visual";

// Desk owns only the file envelope and native presentation selection. The
// supplying feature validates its data; no file can supply executable code.
const envelope = z.strictObject({
  format: z.literal("pythia-visual"),
  version: z.literal(1),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(2000),
  presentation: z.strictObject({
    plugin: z
      .string()
      .max(129)
      .regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/u),
    widget: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
    input_contract: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u),
  }),
  data: z.record(z.string(), z.unknown()),
});
export type VisualArtifact = z.infer<typeof envelope>;

export function parseVisualArtifact(text: string): VisualArtifact {
  if (new TextEncoder().encode(text).byteLength > VISUAL_ARTIFACT_BYTES)
    throw new Error("This visual exceeds the 256 KiB preview limit.");
  try {
    return envelope.parse(JSON.parse(text));
  } catch {
    throw new Error(
      "This file is not a supported research visual. Its source is still available.",
    );
  }
}

export type VisualPresentation = {
  version: 1;
  widgets: { id: string; asset: string; input_contract: string }[];
  assets: { id: string; sha256: string; bytes: number; moduleUrl: string }[];
};

export function visualModule(
  artifact: VisualArtifact,
  native: VisualPresentation,
) {
  const widget = native.widgets.find(
    (item) =>
      item.id === artifact.presentation.widget &&
      item.input_contract === artifact.presentation.input_contract,
  );
  const asset =
    widget && native.assets.find((item) => item.id === widget.asset);
  if (!asset)
    throw new Error(
      "The enabled plugin does not provide this visual's renderer.",
    );
  return asset.moduleUrl;
}

/** Only explicit Workspace URLs in standalone Markdown paragraphs embed a
 * visual. Absolute host paths, external links and ordinary JSON stay links. */
export function visualLinkPath(href: string) {
  if (
    !href.startsWith("/workspace/") ||
    href.includes("#") ||
    href.includes("?")
  )
    return null;
  const location = resolveWorkspaceLink(href.slice("/workspace".length));
  return location && isVisualArtifact(location.path) ? location.path : null;
}
