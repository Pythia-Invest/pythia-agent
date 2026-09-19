import type { ComponentType } from "react";
import type { WidgetProps } from "@pythia/widget-sdk";
import {
  assertWidgetModule,
  type WidgetHost,
  type WidgetModule,
} from "@pythia/widget-sdk/runtime";

export type LoadedWidget = {
  Component: ComponentType<WidgetProps<unknown>>;
  metadata: WidgetModule["metadata"];
  css: string;
  binding?: unknown;
};

/** URLs come from an admitted, currently enabled presentation descriptor. */
export function widgetModuleUrl(value: string, origin: string): string {
  const url = new URL(value, origin);
  if (
    url.origin !== origin ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Widget modules must use a same-origin asset URL.");
  }
  return url.href;
}

/**
 * Browser modules and their component definitions are shared across instances.
 * A new artifact revision needs a new URL; data updates never rebuild a factory.
 * This caches code only, never native enablement, data, or operation authority.
 */
export function createWidgetModuleLoader(
  host: WidgetHost,
  importModule: (url: string) => Promise<unknown> = (url) =>
    import(/* webpackIgnore: true */ url),
) {
  const loaded = new Map<
    string,
    { attempts: number; promise: Promise<LoadedWidget> | undefined }
  >();
  return (url: string): Promise<LoadedWidget> => {
    let entry = loaded.get(url);
    if (entry?.promise) return entry.promise;
    // Native module records also live until page unload. Bound the admitted set
    // instead of pretending that evicting this map can unload executable code.
    if (!entry && loaded.size >= 128) {
      return Promise.reject(
        new Error("Reload Desk before loading more widget revisions."),
      );
    }
    if (!entry) {
      entry = { attempts: 0, promise: undefined };
      loaded.set(url, entry);
    }
    if (entry.attempts >= 3) {
      return Promise.reject(
        new Error(
          "Widget could not be loaded after three attempts. Reload Desk or update its renderer.",
        ),
      );
    }
    // Browsers retain failed import records too. A bounded new identity allows
    // recovery while the asset route still validates the same pinned revision.
    const importUrl = new URL(url);
    if (entry.attempts > 0) {
      importUrl.searchParams.set(
        "pythia-widget-attempt",
        String(entry.attempts),
      );
    }
    entry.attempts += 1;
    const attempt = entry;
    const promise = importModule(importUrl.href)
      .then((module) => {
        assertWidgetModule(module, host);
        const { Component, binding } = module.createWidget(host);
        if (typeof Component !== "function" && typeof Component !== "object") {
          throw new Error(
            "The widget module did not provide a React component.",
          );
        }
        if (Component === null) {
          throw new Error(
            "The widget module did not provide a React component.",
          );
        }
        return {
          Component,
          binding,
          metadata: module.metadata,
          css: module.css,
        };
      })
      .catch((error: unknown) => {
        if (attempt.promise === promise) attempt.promise = undefined;
        throw error;
      });
    attempt.promise = promise;
    return promise;
  };
}
