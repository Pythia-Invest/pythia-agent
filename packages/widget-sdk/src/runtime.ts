export { WidgetStyleScope } from "./scope";
import type { ComponentType } from "react";
import {
  MAX_WIDGET_ARTIFACT_BYTES,
  WIDGET_RUNTIME_VERSION,
} from "./artifact.mjs";
import type { WidgetProps } from "./types";
import type { WidgetBinding } from "./binding";

export {
  MAX_WIDGET_ARTIFACT_BYTES,
  WIDGET_MODULE_MARKER,
  WIDGET_RUNTIME_VERSION,
  WIDGET_SDK_VERSION,
} from "./artifact.mjs";
export type {
  TimestampFormatter,
  WidgetBinding,
  WidgetBindingContext,
  WidgetDataResource,
  WidgetQuery,
  WidgetQueryResult,
} from "./binding";

/** The real browser imports from Desk's React tree, never separately bundled
 * copies. This object supplies dependencies, not a tool or provider bridge. */
export type WidgetHost = {
  react: typeof import("react");
  jsxRuntime: typeof import("react/jsx-runtime");
  reactDom: typeof import("react-dom");
  sdk: typeof import("./index");
};

export type WidgetModule = {
  metadata: {
    format: "pythia-widget-module";
    version: 1;
    runtimeVersion: 1;
    reactMajor: 19;
    sdkVersion: string;
    scope: string;
    imports: Partial<Record<keyof WidgetHost, string[]>>;
  };
  css: string;
  createWidget(host: WidgetHost): WidgetInstance;
};

export type WidgetInstance = {
  Component: ComponentType<WidgetProps<unknown>>;
  binding?: WidgetBinding | undefined;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate before running createWidget: generated module imports execute no
 * author code, while its factory does. Trusted installed code is not sandboxed. */
export function assertWidgetModule(
  value: unknown,
  host: WidgetHost,
): asserts value is WidgetModule {
  if (!record(value) || !record(value.metadata))
    throw new Error("This file is not a compiled Pythia widget module.");
  const metadata = value.metadata;
  if (
    metadata.format !== "pythia-widget-module" ||
    metadata.version !== 1 ||
    metadata.runtimeVersion !== WIDGET_RUNTIME_VERSION ||
    metadata.reactMajor !== 19 ||
    Number(host.react.version.split(".")[0]) !== metadata.reactMajor
  )
    throw new Error(
      "Widget runtime is incompatible. Rebuild with this Pythia checkout.",
    );
  if (
    typeof metadata.sdkVersion !== "string" ||
    metadata.sdkVersion.length > 100 ||
    typeof metadata.scope !== "string" ||
    !/^pyw-[a-f0-9]{24}$/.test(metadata.scope) ||
    !record(metadata.imports) ||
    typeof value.css !== "string" ||
    new TextEncoder().encode(value.css).length > MAX_WIDGET_ARTIFACT_BYTES ||
    typeof value.createWidget !== "function"
  )
    throw new Error("Widget module metadata or exports are invalid.");
  for (const [dependency, names] of Object.entries(metadata.imports)) {
    if (
      !["react", "jsxRuntime", "reactDom", "sdk"].includes(dependency) ||
      !Array.isArray(names) ||
      names.length > 100 ||
      names.some((name) => typeof name !== "string" || name.length > 100)
    )
      throw new Error("Widget dependency declarations are invalid.");
    const supplied = host[dependency as keyof WidgetHost];
    for (const name of names)
      if (
        !Object.hasOwn(supplied, name) ||
        Reflect.get(supplied, name) === undefined
      )
        throw new Error(
          `Widget requires unavailable ${dependency}.${name}. Rebuild with this Pythia checkout.`,
        );
  }
}
