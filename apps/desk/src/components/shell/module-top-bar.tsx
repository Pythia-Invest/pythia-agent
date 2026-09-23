"use client";
import {
  Button,
  type PluginTransport,
  type TopBarContext,
} from "@pythia/widget-sdk";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useDeskApi } from "@/client/providers";
import { useTopBarSelection } from "@/client/top-bar-queries";
import { WidgetHost } from "@/components/widgets/widget-host";
import type { TopBarSelection } from "@/top-bar/config";
import { TopBar } from "./top-bar";

type Context = Omit<TopBarContext, "transport">;
function SelectedTopBar({
  context,
  selection,
}: {
  context: Context;
  selection: TopBarSelection & { moduleUrl: string };
}) {
  const api = useDeskApi();
  const lifetime = useRef(new AbortController());
  useLayoutEffect(() => {
    lifetime.current = new AbortController();
    return () => lifetime.current.abort();
  }, []);
  const withdraw = useCallback(() => lifetime.current.abort(), []);
  const transport = useMemo<PluginTransport>(() => {
    const signalFor = (signal?: AbortSignal) =>
      signal
        ? AbortSignal.any([lifetime.current.signal, signal])
        : lifetime.current.signal;
    return {
      read: (request, signal) => api.pluginRead(request, signalFor(signal)),
      invoke: (request, signal) => api.pluginInvoke(request, signalFor(signal)),
      updates: (resources, signal) =>
        api.dataUpdates(resources, signalFor(signal)),
    };
  }, [api]);
  const fallback = (retry?: () => void) => (
    <>
      <TopBar {...context} />
      <p role="status" className="px-4 text-error text-xs">
        Custom top bar could not be displayed. Using the default header.
      </p>
      {retry ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            lifetime.current.abort();
            lifetime.current = new AbortController();
            retry();
          }}
        >
          Retry top bar
        </Button>
      ) : null}
    </>
  );
  return (
    <WidgetHost
      moduleUrl={selection.moduleUrl}
      name="Desk top bar"
      embedded
      fallback={fallback}
      onError={withdraw}
      loadingFallback={<TopBar {...context} />}
      data={{ ...context, transport }}
      options={{}}
      settings={selection.settings}
      presentation={selection.renderer?.presentation}
      locale={navigator.language}
      timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
    />
  );
}

/** The whole bar is the one replaceable native contribution. Core navigation
 * remains usable while configuration, native access or author code is unavailable. */
export function ModuleTopBar(context: Context) {
  const query = useTopBarSelection();
  const selection = query.isError ? undefined : query.data;
  if (selection?.renderer && selection.moduleUrl)
    return (
      <SelectedTopBar
        key={JSON.stringify([
          selection.moduleUrl,
          selection.renderer,
          selection.settings,
        ])}
        context={context}
        selection={{ ...selection, moduleUrl: selection.moduleUrl }}
      />
    );
  return (
    <>
      <TopBar {...context} />
      {selection?.issue || query.isError ? (
        <p role="status" className="px-4 text-error text-xs">
          {selection?.issue ??
            "Custom top bar is unavailable. Using the default header."}
        </p>
      ) : null}
    </>
  );
}
