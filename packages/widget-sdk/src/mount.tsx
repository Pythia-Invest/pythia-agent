"use client";

import { Component, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { applyWidgetAppearance, isWidgetRenderMessage } from "./protocol";
import type { WidgetProps, WidgetSnapshot } from "./types";

let activeMount: { dispose(): void } | undefined;

function reportError() {
  window.parent.postMessage({ type: "pythia:error", version: 1 }, "*");
}

/** Reset a failed render on the next host update without remounting healthy
 * content. React state therefore survives ordinary quote/theme updates. */
class RenderBoundary extends Component<
  { revision: number; children: ReactNode },
  { failed: boolean; revision: number }
> {
  override state = { failed: false, revision: this.props.revision };
  static getDerivedStateFromProps(
    props: { revision: number },
    state: { revision: number },
  ) {
    return props.revision === state.revision
      ? null
      : { failed: false, revision: props.revision };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    reportError();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Called by the artifact builder. Receives display updates only; this creates
 * no timers, connections, financial requests or privileged message bridge. */
export function mountWidget<
  TData = WidgetSnapshot,
  TSettings = Record<string, unknown>,
>(Widget: ComponentType<WidgetProps<TData, TSettings>>): { dispose(): void } {
  activeMount?.dispose();
  const container = document.createElement("div");
  container.setAttribute("data-pythia-widget-root", "");
  document.body.appendChild(container);
  const root = createRoot(container, { onUncaughtError: reportError });
  let disposed = false;
  let revision = 0;
  const receive = (event: Event) => {
    if (!(event instanceof CustomEvent) || !isWidgetRenderMessage(event.detail))
      return;
    const message = event.detail;
    applyWidgetAppearance(document, message);
    const props = {
      data: message.data as TData,
      options: message.options,
      settings: message.settings as TSettings,
      theme: message.theme,
      timeZone: message.timeZone,
      locale: message.locale,
      appearance: message.appearance,
    };
    root.render(
      <RenderBoundary revision={++revision}>
        <Widget {...props} />
      </RenderBoundary>,
    );
  };
  const mounted = {
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("pythia:render", receive);
      window.removeEventListener("pagehide", mounted.dispose);
      root.unmount();
      container.remove();
      if (activeMount === mounted) activeMount = undefined;
    },
  };
  window.addEventListener("pythia:render", receive);
  window.addEventListener("pagehide", mounted.dispose, { once: true });
  activeMount = mounted;
  return mounted;
}
