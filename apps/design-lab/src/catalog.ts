import { primaryCatalog } from "./catalog-primary";
import { secondaryCatalog } from "./catalog-secondary";

export {
  catalogCategories,
  catalogProfiles,
  type CatalogCategory,
  type CatalogEntry,
  type CatalogProfile,
  type CatalogRoute,
} from "./catalog-schema";
import type { CatalogEntry } from "./catalog-schema";

export const componentCatalog = [
  ...primaryCatalog,
  ...secondaryCatalog,
] as const satisfies readonly CatalogEntry[];

export const catalogEntryByRoute = new Map(
  componentCatalog.map((entry) => [entry.route, entry]),
);
