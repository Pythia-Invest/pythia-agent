import { hermesPages, pageFields } from "@/settings/hermes-pages";
import { fieldLabel } from "./field-copy";
import { settingsPages } from "./sections";
import { pythiaSchema } from "./use-pythia-fields";

/** A search hit: a page, or one setting on a page. */
export type SearchResult =
  | { kind: "page"; page: string; title: string; context: string }
  | {
      kind: "setting";
      page: string;
      key: string;
      title: string;
      context: string;
    };

const normalize = (value: string) =>
  value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/gu, "");

export function searchTerms(query: string) {
  return normalize(query).split(/\s+/u).filter(Boolean);
}

const matches = (terms: readonly string[], text: string) => {
  const haystack = normalize(text);
  return terms.every((term) => haystack.includes(term));
};

/**
 * Pages and settings matching every word, pages first. Hermes settings are
 * searchable once their schema is known; Pythia's always are.
 */
export function searchSettings(
  query: string,
  hermesKeys: readonly string[],
): SearchResult[] {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const pages: SearchResult[] = [];
  const settings: SearchResult[] = [];
  for (const page of settingsPages) {
    const context =
      page.section.pages.length > 1
        ? `${page.section.title} › ${page.title}`
        : page.section.title;
    if (
      matches(
        terms,
        `${page.title} ${page.section.title} ${page.keywords ?? ""}`,
      )
    )
      pages.push({ kind: "page", page: page.id, title: page.title, context });
    const keys =
      page.view.kind === "pythia"
        ? page.view.fields
        : page.view.kind === "hermes" || page.view.kind === "main-model"
          ? pageFields(
              hermesPages.find((item) => item.id === page.id) ?? {
                id: page.id,
              },
              hermesKeys,
            )
          : [];
    for (const key of keys) {
      const title = pythiaSchema[key]?.label ?? fieldLabel(key);
      if (matches(terms, `${title} ${key}`))
        settings.push({ kind: "setting", page: page.id, key, title, context });
    }
  }
  return [...pages, ...settings];
}

export function foundLabel(count: number) {
  return count === 1 ? "1 result" : `${count} results`;
}
