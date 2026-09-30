import { resolveInstallPaths } from "../../scripts/install/paths.mjs";

// The installer resolves `checkout` to null when PYTHIA_CHECKOUT is unset.
// Fixtures always name a checkout, so they get it as a string.
export function resolveCheckoutInstallPaths(
  environment: NodeJS.ProcessEnv & { PYTHIA_CHECKOUT: string },
) {
  const paths = resolveInstallPaths(environment);
  const { checkout } = paths;
  if (checkout === null) {
    throw new Error("Install paths did not resolve the fixture checkout");
  }
  return { ...paths, checkout };
}
