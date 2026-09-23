"use client";

import * as React from "react";
import * as ReactDom from "react-dom";
import * as JsxRuntime from "react/jsx-runtime";
import * as WidgetSdk from "@pythia/widget-sdk";
import type { WidgetHost as WidgetRuntime } from "@pythia/widget-sdk/runtime";
import {
  createWidgetModuleLoader,
  type LoadedWidget,
  widgetModuleUrl,
} from "@/client/widget-modules";

// These are Desk's webpack-resolved imports, including Next's React aliases.
// The author artifact receives these exact objects and contains no other React.
const runtime: WidgetRuntime = Object.freeze({
  react: React,
  reactDom: ReactDom,
  jsxRuntime: JsxRuntime,
  sdk: WidgetSdk,
});
const loadWidget = createWidgetModuleLoader(runtime);
const styles = new Map<string, { element: HTMLStyleElement; users: number }>();

function retainStyles(widget: LoadedWidget) {
  const key = widget.metadata.scope;
  let entry = styles.get(key);
  if (!entry) {
    const element = document.createElement("style");
    element.dataset.pythiaWidgetStyle = key;
    element.textContent = widget.css;
    document.head.append(element);
    entry = { element, users: 0 };
    styles.set(key, entry);
  }
  entry.users += 1;
  return () => {
    entry.users -= 1;
    if (entry.users === 0) {
      entry.element.remove();
      styles.delete(key);
    }
  };
}

class WidgetErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? (
      <p role="status" className="text-error text-xs">
        Widget could not be displayed. Update its renderer or restore the
        default.
      </p>
    ) : (
      this.props.children
    );
  }
}

function WidgetContent({
  widget,
  props,
}: {
  widget: LoadedWidget;
  props: WidgetSdk.WidgetProps<unknown>;
}) {
  React.useInsertionEffect(() => retainStyles(widget), [widget]);
  const Component = widget.Component;
  return (
    <div data-slot="widget-content" data-pythia-widget={widget.metadata.scope}>
      <WidgetSdk.WidgetScope scope={widget.metadata.scope}>
        <Component {...props} />
      </WidgetSdk.WidgetScope>
    </div>
  );
}

/**
 * A trusted module in the existing Desk React tree. The feature owns selection,
 * admitted data reads and removal when its current native descriptor disappears.
 */
export function useWidgetModule(moduleUrl: string) {
  const [attempt, setAttempt] = React.useState(0);
  const retry = React.useCallback(() => setAttempt((value) => value + 1), []);
  const [result, setResult] = React.useState<{
    url: string;
    attempt: number;
    widget?: LoadedWidget;
    error?: string;
  } | null>(null);
  React.useEffect(() => {
    let current = true;
    Promise.resolve()
      .then(() =>
        loadWidget(widgetModuleUrl(moduleUrl, window.location.origin)),
      )
      .then(
        (widget) => {
          if (current) setResult({ url: moduleUrl, attempt, widget });
        },
        (error: unknown) => {
          if (current) {
            setResult({
              url: moduleUrl,
              attempt,
              error:
                error instanceof Error
                  ? error.message
                  : "Widget could not be loaded.",
            });
          }
        },
      );
    return () => {
      current = false;
    };
  }, [moduleUrl, attempt]);

  return result?.url === moduleUrl && result.attempt === attempt
    ? { ...result, retry }
    : null;
}

export function LoadedWidgetHost({
  moduleUrl,
  name,
  widget,
  embedded = false,
  ...props
}: WidgetSdk.WidgetProps<unknown> & {
  moduleUrl: string;
  name: string;
  widget: LoadedWidget;
  embedded?: boolean;
}) {
  const Root = embedded ? "div" : "section";
  return (
    <Root
      aria-label={embedded ? undefined : name}
      data-slot="widget-host"
      className="min-w-0"
    >
      <WidgetErrorBoundary
        key={JSON.stringify([moduleUrl, props.presentation])}
      >
        <WidgetContent widget={widget} props={props} />
      </WidgetErrorBoundary>
    </Root>
  );
}

export function WidgetHost({
  moduleUrl,
  name,
  embedded = false,
  ...props
}: WidgetSdk.WidgetProps<unknown> & {
  moduleUrl: string;
  name: string;
  embedded?: boolean;
}) {
  const active = useWidgetModule(moduleUrl);
  if (active?.widget) {
    return (
      <LoadedWidgetHost
        moduleUrl={moduleUrl}
        name={name}
        widget={active.widget}
        embedded={embedded}
        {...props}
      />
    );
  }
  const Root = embedded ? "div" : "section";
  return (
    <Root
      aria-label={embedded ? undefined : name}
      data-slot="widget-host"
      className="min-w-0"
    >
      {active?.error ? (
        <div>
          <p role="status" className="text-error text-xs">
            {active.error}
          </p>
          <button
            type="button"
            className="text-foreground-secondary text-xs underline"
            onClick={active.retry}
          >
            Retry widget
          </button>
        </div>
      ) : (
        <p role="status" className="text-foreground-secondary text-xs">
          Loading widget…
        </p>
      )}
    </Root>
  );
}
