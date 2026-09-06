export const catalogCategories = [
  "actions",
  "forms",
  "calendar",
  "selection",
  "navigation",
  "overlays",
  "disclosure",
  "feedback",
  "data-display",
  "layout",
  "semantics",
] as const;

export type CatalogCategory = (typeof catalogCategories)[number];

export const catalogProfiles = ["public", "product"] as const;

export type CatalogProfile = (typeof catalogProfiles)[number];

export type CatalogRoute = `/components/${string}`;

export interface CatalogEntry {
  readonly category: CatalogCategory;
  readonly name: string;
  readonly profiles: readonly CatalogProfile[];
  readonly route: CatalogRoute;
  readonly search: readonly string[];
}
