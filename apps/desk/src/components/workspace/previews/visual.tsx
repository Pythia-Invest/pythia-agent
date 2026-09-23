"use client";

import { Code2, ChartNoAxesCombined } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { WidgetToolbar } from "@pythia/widget-sdk";
import { Button } from "@pythia/ui";
import { useVisualArtifact, useVisualPresentation } from "@/client/queries";
import { DeskApiError } from "@/client/browser-request";
import { WidgetHost } from "@/components/widgets/widget-host";
import {
  visualModule,
  VISUAL_ARTIFACT_BYTES,
  type VisualArtifact,
} from "@/workspace/visual-artifact";
import type { WorkspaceEntry } from "@/workspace/types";
import { CodePreview } from "./code";

function VisualRenderer({ artifact }: { artifact: VisualArtifact }) {
  const native = useVisualPresentation(artifact.presentation.plugin);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const root = document.documentElement;
    const update = () =>
      setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  const selected = useMemo(() => {
    if (!native.data) return {};
    try {
      return { moduleUrl: visualModule(artifact, native.data) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Renderer unavailable.",
      };
    }
  }, [artifact, native.data]);
  // Do not keep mounting cached code when current native authority is denied.
  if (native.isError || selected.error)
    return (
      <div
        role="status"
        className="grid gap-2 text-body text-foreground-secondary"
      >
        <p>
          {selected.error ??
            (native.error instanceof DeskApiError &&
            [401, 403, 404].includes(native.error.status)
              ? "The visual's plugin is unavailable or disabled. You can still inspect or download its source."
              : "The renderer is temporarily unavailable. Retry shortly, or inspect or download its source.")}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void native.refetch()}
        >
          Retry renderer
        </Button>
      </div>
    );
  if (!native.isFetchedAfterMount || !selected.moduleUrl)
    return (
      <p role="status" className="text-body text-foreground-secondary">
        Loading visual renderer…
      </p>
    );
  return (
    <WidgetHost
      key={selected.moduleUrl}
      moduleUrl={selected.moduleUrl}
      name={artifact.title}
      data={artifact}
      options={{}}
      settings={{}}
      presentation={artifact.presentation.widget}
      appearance={{ theme, profile: "product" }}
      locale={navigator.language}
      timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
    />
  );
}

export default function VisualPreview({
  entry,
  onReady,
}: {
  entry: WorkspaceEntry;
  onReady?: (() => void) | undefined;
}) {
  const admitted =
    entry.kind === "text" &&
    entry.previewable &&
    entry.size <= VISUAL_ARTIFACT_BYTES;
  const visual = useVisualArtifact(entry.path, entry.revision, admitted);
  const [source, setSource] = useState(false);
  useEffect(() => {
    if (visual.isSuccess || visual.isError || !admitted) onReady?.();
  }, [visual.isSuccess, visual.isError, admitted, onReady]);
  return (
    <div data-slot="visual-preview" className="min-w-0 font-sans text-body">
      {!admitted ? (
        <p role="status">
          This visual is unavailable for preview or exceeds the 256 KiB limit.
          Download the original to inspect it.
        </p>
      ) : visual.isError ? (
        <div role="alert" className="grid gap-2">
          <p>{visual.error.message}</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void visual.refetch()}
          >
            Retry visual
          </Button>
        </div>
      ) : !visual.data ? (
        <p role="status">Loading visual…</p>
      ) : (
        <>
          <WidgetToolbar>
            <Button
              size="sm"
              variant="ghost"
              aria-label={source ? "Show visual" : "View source"}
              title={source ? "Show visual" : "View source"}
              aria-pressed={source}
              onClick={() => setSource(!source)}
            >
              {source ? (
                <ChartNoAxesCombined aria-hidden="true" className="size-4" />
              ) : (
                <Code2 aria-hidden="true" className="size-4" />
              )}
            </Button>
          </WidgetToolbar>
          {source && (
            <CodePreview
              name={entry.name}
              text={JSON.stringify(visual.data, null, 2)}
            />
          )}
          <div hidden={source}>
            <VisualRenderer artifact={visual.data} />
          </div>
        </>
      )}
    </div>
  );
}
