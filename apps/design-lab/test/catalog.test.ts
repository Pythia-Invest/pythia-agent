import { describe, expect, it } from "vitest";
import { componentCatalog } from "../src/catalog";
import {
  catalogEntryFromPathname,
  catalogEntryFromSlug,
  searchCatalog,
} from "../src/catalog-routing";

describe("Design Lab catalog behavior", () => {
  it("uses unique stable routes and distinct profiles", () => {
    const routes = componentCatalog.map((entry) => entry.route);
    expect(new Set(routes).size).toBe(routes.length);

    for (const entry of componentCatalog) {
      expect(entry.route).toMatch(/^\/components\/[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      expect(entry.profiles.length).toBeGreaterThan(0);
      expect(new Set(entry.profiles).size).toBe(entry.profiles.length);
    }
  });

  it("resolves only exact component routes", () => {
    const entry = componentCatalog[0];
    if (!entry) throw new Error("Catalog unexpectedly empty");
    const slug = entry.route.slice("/components/".length);
    expect(catalogEntryFromSlug(slug)).toBe(entry);
    expect(catalogEntryFromPathname(entry.route)).toBe(entry);
    expect(catalogEntryFromSlug(`${slug}/nested`)).toBeUndefined();
    expect(catalogEntryFromPathname(`${entry.route}/nested`)).toBeUndefined();
  });

  it("matches all normalized search terms against owned metadata", () => {
    const entry = componentCatalog.find(
      (candidate) => candidate.search.length > 0,
    );
    if (!entry) throw new Error("Catalog has no searchable entry");
    expect(searchCatalog(`  ${entry.category} ${entry.search[0]}  `)).toContain(
      entry,
    );
    expect(searchCatalog("impossible synthetic query")).toEqual([]);
    expect(searchCatalog(" ")).toBe(componentCatalog);
  });
});
