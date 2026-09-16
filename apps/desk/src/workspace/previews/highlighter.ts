import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type TokensResult,
} from "shiki";
import type { CodeHighlighterPlugin } from "streamdown";
import { TEXT_RENDER_CHARS } from "./formats";

// Native grammars; only the cache policy is ours. Full-source keys avoid showing
// another file's tokens when equal-length files share a prefix and suffix.
const themes: ["github-light", "github-dark"] = ["github-light", "github-dark"];
const cache = new Map<string, TokensResult>();
let cachedCharacters = 0;
const pending = new Map<string, Promise<TokensResult>>();
let engine: ReturnType<typeof createHighlighter> | undefined;
export const code: CodeHighlighterPlugin = {
  name: "shiki",
  type: "code-highlighter",
  getThemes: () => themes,
  getSupportedLanguages: () =>
    Object.keys(bundledLanguages) as BundledLanguage[],
  supportsLanguage: (language) => language in bundledLanguages,
  highlight(options, callback) {
    if (options.code.length > TEXT_RENDER_CHARS) return null;
    const language =
      options.language in bundledLanguages
        ? (options.language as BundledLanguage)
        : "text";
    const key = `${language}\0${options.code}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    let job = pending.get(key);
    if (!job) {
      if (pending.size >= 16) return null;
      engine ??= createHighlighter({ themes, langs: [] });
      job = engine.then(async (highlighter) => {
        if (
          language !== "text" &&
          !highlighter.getLoadedLanguages().includes(language)
        )
          await highlighter.loadLanguage(language);
        return highlighter.codeToTokens(options.code, {
          lang: language,
          themes: { light: themes[0], dark: themes[1] },
        });
      });
      pending.set(key, job);
      void job
        .then((result) => {
          cache.set(key, result);
          cachedCharacters += key.length;
          while (cache.size > 16 || cachedCharacters > 200_000) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cachedCharacters -= oldest.length;
            cache.delete(oldest);
          }
        })
        .catch(() => {})
        .finally(() => pending.delete(key));
    }
    if (callback) void job.then(callback).catch(() => {});
    return null;
  },
};
