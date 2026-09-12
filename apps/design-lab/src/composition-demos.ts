type CompositionDemoRoute = `/demonstrations/${string}`;

export interface CompositionDemoEntry {
  readonly key:
    | "public-profile"
    | "product-shell-density"
    | "research-evidence-semantics"
    | "chat-typography"
    | "reasoning-effort-selectors";
  readonly name: string;
  readonly route: CompositionDemoRoute;
  readonly scope: string;
}

export const publicProfileCompositionDemo = {
  key: "public-profile",
  name: "Public profile",
  route: "/demonstrations/public-profile",
  scope: "Shared components composed with the Public profile.",
} as const satisfies CompositionDemoEntry;

export const productShellDensityCompositionDemo = {
  key: "product-shell-density",
  name: "Product shell / density",
  route: "/demonstrations/product-shell-density",
  scope: "Shared components composed at Product profile density.",
} as const satisfies CompositionDemoEntry;

export const researchEvidenceSemanticsCompositionDemo = {
  key: "research-evidence-semantics",
  name: "Research / evidence semantics",
  route: "/demonstrations/research-evidence-semantics",
  scope: "Shared research and finance semantics composed together.",
} as const satisfies CompositionDemoEntry;

export const chatTypographyCompositionDemo = {
  key: "chat-typography",
  name: "Chat typography",
  route: "/demonstrations/chat-typography",
  scope: "One synthetic exchange set in candidate reading typefaces.",
} as const satisfies CompositionDemoEntry;

export const reasoningEffortSelectorsCompositionDemo = {
  key: "reasoning-effort-selectors",
  name: "Reasoning effort selectors",
  route: "/demonstrations/reasoning-effort-selectors",
  scope: "Three interactive compact selectors for Hermes reasoning effort.",
} as const satisfies CompositionDemoEntry;

/** The fixed composition destinations are separate from the component catalog. */
export const compositionDemoManifest = [
  publicProfileCompositionDemo,
  productShellDensityCompositionDemo,
  researchEvidenceSemanticsCompositionDemo,
  chatTypographyCompositionDemo,
  reasoningEffortSelectorsCompositionDemo,
] as const satisfies readonly CompositionDemoEntry[];

export function compositionDemoEntryFromPathname(
  pathname: string,
): CompositionDemoEntry | undefined {
  return compositionDemoManifest.find((entry) => entry.route === pathname);
}
