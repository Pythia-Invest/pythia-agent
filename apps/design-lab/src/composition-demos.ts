type CompositionDemoRoute = `/demonstrations/${string}`;

export interface CompositionDemoEntry {
  readonly key:
    | "public-profile"
    | "product-shell-density"
    | "research-evidence-semantics";
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

/** The three fixed composition destinations are separate from the component catalog. */
export const compositionDemoManifest = [
  publicProfileCompositionDemo,
  productShellDensityCompositionDemo,
  researchEvidenceSemanticsCompositionDemo,
] as const satisfies readonly CompositionDemoEntry[];

export function compositionDemoEntryFromPathname(
  pathname: string,
): CompositionDemoEntry | undefined {
  return compositionDemoManifest.find((entry) => entry.route === pathname);
}
