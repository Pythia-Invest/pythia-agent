import { primaryCatalog } from "./catalog-primary";
import { secondaryCatalog } from "./catalog-secondary";

export {
  catalogCategories,
  type CatalogEntry,
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
