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
  {
    category: "semantics",
    name: "Market presentation",
    profiles: ["product"],
    route: "/components/market-presentation",
    search: ["instrument", "price", "sparkline", "session", "loading"],
  },
  {
    category: "semantics",
    name: "Instrument widgets",
    profiles: ["product"],
    route: "/components/instrument-widgets",
    search: ["instrument", "tile", "compact", "table", "watchlist"],
  },
] as const satisfies readonly CatalogEntry[];

export const catalogEntryByRoute = new Map(
  componentCatalog.map((entry) => [entry.route, entry]),
);
