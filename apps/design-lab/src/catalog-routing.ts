import {
  componentCatalog,
  type CatalogEntry,
  type CatalogRoute,
} from "./catalog";

export function catalogRouteFromSlug(slug: string): CatalogRoute {
  return `/components/${slug}`;
}

export function catalogEntryFromSlug(slug: string): CatalogEntry | undefined {
  const route = catalogRouteFromSlug(slug);
  return componentCatalog.find((entry) => entry.route === route);
}

export function catalogEntryFromPathname(
  pathname: string,
): CatalogEntry | undefined {
  return componentCatalog.find((entry) => entry.route === pathname);
}

export function searchCatalog(query: string): readonly CatalogEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0) return componentCatalog;

  return componentCatalog.filter((entry) => {
    const haystack = [entry.name, entry.category, ...entry.search]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
