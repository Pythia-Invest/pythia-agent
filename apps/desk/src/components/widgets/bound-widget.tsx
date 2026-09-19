"use client";
import { Component, useEffect, useState, type ReactNode } from "react";
import { Button } from "@pythia/ui";
import type {
  WidgetBinding,
  WidgetProps,
  WidgetQuery,
} from "@pythia/widget-sdk";
import { useDataQueries } from "@/client/data-queries";
import { useDeskApi } from "@/client/providers";
import { useLocalTime } from "@/client/local-time";
import type { LoadedWidget } from "@/client/widget-modules";
import { LoadedWidgetHost, useWidgetModule } from "./widget-host";

type Props = {
  moduleUrl: string;
  name: string;
  presentation?: string | undefined;
  data?: unknown;
  input?: unknown;
  options?: WidgetProps["options"] | undefined;
  settings?: WidgetProps["settings"] | undefined;
};

class BindingBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidUpdate(previous: { resetKey: string }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }
  override render() {
    return this.state.failed ? (
      <p role="status" className="text-error text-xs">
        Widget data could not be displayed. Check its configuration or restore
        the default.
      </p>
    ) : (
      this.props.children
    );
  }
}

/** Same portable runtime for contributed standard, specialist and user modules.
 * Code defines meaning; the existing Desk coordinator owns every data request. */
export function BoundWidget(props: Props) {
  const loaded = useWidgetModule(props.moduleUrl);
  if (!loaded?.widget)
    return (
      <div>
        <p
          role="status"
          className={
            loaded?.error
              ? "text-error text-xs"
              : "text-foreground-secondary text-xs"
          }
        >
          {loaded?.error ?? "Loading widget…"}
        </p>
        {loaded?.error && (
          <Button size="sm" variant="ghost" onClick={loaded.retry}>
            Retry widget
          </Button>
        )}
      </div>
    );
  return (
    <BindingBoundary
      key={props.moduleUrl}
      resetKey={JSON.stringify([
        props.input,
        props.settings,
        props.options,
        props.presentation,
      ])}
    >
      <BoundContent {...props} widget={loaded.widget} />
    </BindingBoundary>
  );
}

function BoundContent({
  widget,
  moduleUrl,
  name,
  presentation,
  data,
  input,
  options = {},
  settings = {},
}: Props & { widget: LoadedWidget }) {
  const api = useDeskApi();
  const formatTimestamp = useLocalTime();
  const binding =
    input === undefined
      ? undefined
      : (widget.binding as WidgetBinding | undefined);
  if (
    input !== undefined &&
    (!binding ||
      typeof binding.queries !== "function" ||
      typeof binding.render !== "function" ||
      (binding.deferred !== undefined &&
        typeof binding.deferred !== "function"))
  )
    throw Error("This widget has no supported data binding.");
  const coordinated = (spec: WidgetQuery) => ({
    ...spec,
    ...(spec.readResource
      ? {
          read: (signal: AbortSignal) =>
            api.pluginRead(spec.readResource?.() ?? spec.resource, signal),
        }
      : {}),
  });
  const primarySpecs = binding?.queries(input) ?? [];
  const primary = useDataQueries(primarySpecs.map(coordinated));
  const deferredSpecs = binding?.deferred?.(input, primary) ?? [];
  const deferred = useDataQueries(deferredSpecs.map(coordinated));
  const snapshot = binding?.render(input, primary, deferred, {
    formatTimestamp,
  });
  const [environment, setEnvironment] = useState<
    Pick<WidgetProps, "appearance" | "locale" | "timeZone">
  >({
    locale: "en",
    timeZone: "UTC",
    appearance: { theme: "light", profile: "product" },
  });
  useEffect(() => {
    const refresh = () => {
      const root = document.documentElement;
      setEnvironment({
        locale: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        appearance: {
          theme: root.dataset.theme === "dark" ? "dark" : "light",
          profile:
            root.dataset.pythiaProfile === "public" ? "public" : "product",
        },
      });
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-pythia-profile"],
    });
    window.addEventListener("focus", refresh);
    return () => {
      observer.disconnect();
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return (
    <>
      <LoadedWidgetHost
        embedded
        widget={widget}
        moduleUrl={moduleUrl}
        name={name}
        presentation={presentation}
        data={snapshot ? snapshot.data : data}
        options={options}
        settings={settings}
        {...environment}
      />
      {snapshot?.message && (
        <p role="alert" className="mt-2 max-w-prose text-error text-xs">
          {snapshot.message}
        </p>
      )}
      {(snapshot?.state === "error" || snapshot?.message) && (
        <Button
          className="mt-2"
          size="sm"
          variant="ghost"
          onClick={() => {
            primary.forEach((query, index) => {
              if (primarySpecs[index]?.enabled) void query.refetch();
            });
            deferred.forEach((query, index) => {
              if (deferredSpecs[index]?.enabled) void query.refetch();
            });
          }}
        >
          Retry
        </Button>
      )}
    </>
  );
}
