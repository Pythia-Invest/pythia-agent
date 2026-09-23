import { useRef, useState } from "react";
import type { View } from "vega";
import { Button, WidgetToolbar, type WidgetProps } from "@pythia/widget-sdk";
import {
  isVisual,
  parameterDefaults,
  safeSourceUrl,
  scenarioContext,
  serializeScenario,
  type Scalar,
  type Visual,
} from "./visual";
import { Plot } from "./plot";
import { VisualActions } from "./controls";
import { exportVisual } from "./export";
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ResearchVisual({
  visual,
  theme,
}: {
  visual: Visual;
  theme: string | undefined;
}) {
  const section = useRef<HTMLElement>(null);
  const currentView = useRef<View | null>(null);
  const [parameters, setParameters] = useState<Record<string, Scalar>>({
    ...parameterDefaults(visual.data.spec),
    ...visual.data.parameters,
  });
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const reset = () => {
    setReady(false);
    setNotice("");
    setRevision((value) => value + 1);
  };
  const snapshot = async (format: "png" | "svg") => {
    if (!ready || !section.current) return;
    setBusy(true);
    try {
      const styles = getComputedStyle(section.current);
      const token = (name: string) => styles.getPropertyValue(name).trim();
      const blob = await exportVisual(
        visual,
        parameters,
        {
          background: token("--py-surface-canvas"),
          foreground: token("--py-text-primary"),
          secondary: token("--py-text-secondary"),
          border: token("--py-border-default"),
          series: [
            token("--py-artifact-document"),
            token("--py-artifact-folder"),
            token("--py-text-secondary"),
          ],
        },
        format,
        currentView.current ?? undefined,
      );
      download(blob, `research-visual.${format}`);
      setNotice(`${format.toUpperCase()} downloaded.`);
    } catch (error) {
      setNotice(
        error instanceof Error &&
          error.message === "This SVG contains unsupported resource references."
          ? "SVG export blocked: the visual contains unsupported resource references."
          : "Export failed. Retry the visual or reduce its dimensions.",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    try {
      download(
        new Blob([serializeScenario(visual, parameters)], {
          type: "application/json",
        }),
        "research-scenario.pythia-vega-lite.json",
      );
      setNotice("Scenario downloaded with current parameters.");
    } catch {
      setNotice(
        "Scenario exceeds the supported file limits. Reduce its data or parameter text.",
      );
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(scenarioContext(visual, parameters));
      setNotice("Scenario context copied.");
    } catch {
      setNotice(
        "Copy unavailable. Download the scenario to keep these parameters.",
      );
    }
  };
  const plot = (
    <Plot
      key={revision}
      visual={visual}
      theme={theme}
      onParameters={setParameters}
      onView={(view) => {
        currentView.current = view;
        setReady(!!view);
      }}
      onError={setFailure}
    />
  );
  return (
    <section
      ref={section}
      data-slot="research-visual"
      className="min-w-0 space-y-3 p-4 text-foreground"
    >
      <WidgetToolbar>
        <VisualActions
          ready={ready}
          busy={busy}
          onExport={(format) => void snapshot(format)}
          onSave={save}
          onCopy={() => void copy()}
          onReset={reset}
        />
      </WidgetToolbar>
      <header className="space-y-1">
        <h2 className="font-semibold text-sm">{visual.title}</h2>
        <p className="text-foreground-secondary text-sm leading-relaxed">
          {visual.summary}
        </p>
      </header>
      <div className="py-2">
        {plot}
        {failure && (
          <Button variant="ghost" size="sm" onClick={reset}>
            Retry visual
          </Button>
        )}
      </div>
      <footer className="space-y-2 border-border border-t pt-3 text-foreground-secondary text-xs leading-relaxed">
        <p className="flex flex-wrap gap-x-3 gap-y-1">
          <span>As of {visual.data.asOf}</span>
          {visual.data.sources.map((source, i) => (
            <span key={`${i}-${source.label}`}>
              {source.url && safeSourceUrl(source.url) ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {source.label}
                </a>
              ) : (
                source.label
              )}
              {source.date ? ` · ${source.date}` : ""}
            </span>
          ))}
        </p>
        {visual.data.assumptions.length > 0 && (
          <p>
            <span className="font-medium">Assumptions: </span>
            {visual.data.assumptions.join(" ")}
          </p>
        )}
      </footer>
      {notice && (
        <p role="status" className="text-foreground-secondary text-xs">
          {notice}
        </p>
      )}
    </section>
  );
}
export default function ResearchVisualWidget({
  data,
  appearance,
}: WidgetProps<unknown>) {
  if (!isVisual(data))
    return (
      <p role="alert" className="p-4 text-error text-sm">
        This research visual is invalid or exceeds the supported limits. Open
        the source file to inspect it.
      </p>
    );
  return (
    <ResearchVisual
      key={JSON.stringify(data)}
      visual={data}
      theme={appearance?.theme}
    />
  );
}
