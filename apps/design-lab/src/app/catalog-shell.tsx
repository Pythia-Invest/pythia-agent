"use client";

import { PythiaLockup, PythiaToastProvider } from "@pythia/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { catalogCategories, componentCatalog } from "../catalog";
import { catalogEntryFromPathname, searchCatalog } from "../catalog-routing";
import {
  compositionDemoEntryFromPathname,
  compositionDemoManifest,
} from "../composition-demos";
import { LabControls, type LabViewport } from "./lab-controls";

function categoryLabel(category: string) {
  return category
    .split("-")
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function CatalogShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const entry = catalogEntryFromPathname(pathname);
  const compositionEntry = compositionDemoEntryFromPathname(pathname);
  const [query, setQuery] = useState("");
  const [viewport, setViewport] = useState<LabViewport>("wide");
  const results = searchCatalog(query);
  const navigationPanel = (
    <div className="catalog-navigation-panel">
      <label className="catalog-search">
        <span>Search components</span>
        <input
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name or state…"
          type="search"
          value={query}
        />
      </label>
      <nav
        aria-label="Composition demonstrations"
        className="catalog-nav-group catalog-composition-navigation"
      >
        <h2>Composition demonstrations</h2>
        <p>Component compositions, never product screens.</p>
        <ul>
          {compositionDemoManifest.map((demo) => (
            <li key={demo.route}>
              <Link
                aria-current={
                  demo.route === compositionEntry?.route ? "page" : undefined
                }
                href={demo.route}
                scroll={false}
              >
                {demo.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="Catalog destinations" className="catalog-destinations">
        {results.length === 0 ? (
          <p className="catalog-no-results" role="status">
            No matching components.
          </p>
        ) : (
          catalogCategories.map((category) => {
            const entries = results.filter(
              (candidate) => candidate.category === category,
            );
            if (entries.length === 0) return null;
            return (
              <section className="catalog-nav-group" key={category}>
                <h2>{categoryLabel(category)}</h2>
                <ul>
                  {entries.map((candidate) => (
                    <li key={candidate.route}>
                      <Link
                        aria-current={
                          candidate.route === entry?.route ? "page" : undefined
                        }
                        href={candidate.route}
                        scroll={false}
                      >
                        {candidate.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </nav>
      <Link className="catalog-foundation-link" href="/foundation">
        Foundation surface
      </Link>
    </div>
  );

  return (
    <PythiaToastProvider limit={4} timeout={7000}>
      <div className="catalog-shell">
        <header className="catalog-toolbar">
          <Link
            aria-label="Design Lab component catalog"
            className="catalog-brand"
            href="/components/button"
          >
            <PythiaLockup label="Pythia" variant="compact" />
            <span className="catalog-brand-label">Design Lab</span>
          </Link>
          <LabControls onViewportChange={setViewport} viewport={viewport} />
        </header>

        <div className="catalog-body">
          <aside aria-label="Component catalog" className="catalog-navigation">
            <div className="catalog-navigation-desktop">{navigationPanel}</div>
            <details className="catalog-navigation-disclosure">
              <summary>
                <span>Components</span>
                <span aria-hidden="true">{componentCatalog.length}</span>
              </summary>
              {navigationPanel}
            </details>
          </aside>

          <main className="catalog-main">
            <div className="catalog-page-heading">
              <div>
                <span className="catalog-category">
                  {compositionEntry
                    ? "Composition demonstration"
                    : entry
                      ? categoryLabel(entry.category)
                      : "Components"}
                </span>
                <h1>{compositionEntry?.name ?? entry?.name ?? "Component"}</h1>
              </div>
              <span className="catalog-synthetic-label">
                {compositionEntry
                  ? "Component composition demonstration · Labelled synthetic fixture"
                  : "Labelled synthetic specimen"}
              </span>
            </div>
            <div className="catalog-preview-frame" data-lab-viewport={viewport}>
              <div className="catalog-preview-canvas">{children}</div>
            </div>
          </main>
        </div>
      </div>
    </PythiaToastProvider>
  );
}
