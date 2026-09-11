import { SearchSelect } from "@pythia/ui";

const benchmarks = [
  "No benchmark",
  "Broad European index",
  "European utilities index",
  "Custom peer set",
] as const;

type Benchmark = (typeof benchmarks)[number];

const models = [
  "Balanced — local",
  "Deep research — local",
  "Fast summary — local",
] as const;

type Model = (typeof models)[number];

/**
 * The search field lives inside the popup, which portals to `document.body`,
 * so every story shows the trigger in its closed state.
 */
export function Default() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-2">
      <span className="font-medium text-foreground-secondary text-xs">
        Benchmark
      </span>
      <SearchSelect.Root
        defaultValue="European utilities index"
        items={benchmarks}
      >
        <SearchSelect.Trigger aria-label="Benchmark">
          <SearchSelect.Value placeholder="Select a benchmark" />
        </SearchSelect.Trigger>
        <SearchSelect.Portal>
          <SearchSelect.Positioner>
            <SearchSelect.Popup aria-label="Select a benchmark">
              <SearchSelect.Input
                aria-label="Search benchmarks"
                placeholder="Search benchmarks…"
              />
              <SearchSelect.Empty>No matching benchmark.</SearchSelect.Empty>
              <SearchSelect.List>
                {(benchmark: Benchmark) => (
                  <SearchSelect.Item key={benchmark} value={benchmark}>
                    {benchmark}
                  </SearchSelect.Item>
                )}
              </SearchSelect.List>
            </SearchSelect.Popup>
          </SearchSelect.Positioner>
        </SearchSelect.Portal>
      </SearchSelect.Root>
    </div>
  );
}

export function Placeholder() {
  return (
    <div className="w-full max-w-xs">
      <SearchSelect.Root items={benchmarks}>
        <SearchSelect.Trigger aria-label="Benchmark">
          <SearchSelect.Value placeholder="Select a benchmark" />
        </SearchSelect.Trigger>
        <SearchSelect.Portal>
          <SearchSelect.Positioner>
            <SearchSelect.Popup aria-label="Select a benchmark">
              <SearchSelect.Input
                aria-label="Search benchmarks"
                placeholder="Search benchmarks…"
              />
              <SearchSelect.Empty>No matching benchmark.</SearchSelect.Empty>
              <SearchSelect.List>
                {(benchmark: Benchmark) => (
                  <SearchSelect.Item key={benchmark} value={benchmark}>
                    {benchmark}
                  </SearchSelect.Item>
                )}
              </SearchSelect.List>
            </SearchSelect.Popup>
          </SearchSelect.Positioner>
        </SearchSelect.Portal>
      </SearchSelect.Root>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="w-full max-w-xs">
      <SearchSelect.Root defaultValue="Custom peer set" disabled items={benchmarks}>
        <SearchSelect.Trigger aria-label="Benchmark">
          <SearchSelect.Value placeholder="Select a benchmark" />
        </SearchSelect.Trigger>
        <SearchSelect.Portal>
          <SearchSelect.Positioner>
            <SearchSelect.Popup aria-label="Select a benchmark">
              <SearchSelect.Input aria-label="Search benchmarks" />
              <SearchSelect.List>
                {(benchmark: Benchmark) => (
                  <SearchSelect.Item key={benchmark} value={benchmark}>
                    {benchmark}
                  </SearchSelect.Item>
                )}
              </SearchSelect.List>
            </SearchSelect.Popup>
          </SearchSelect.Positioner>
        </SearchSelect.Portal>
      </SearchSelect.Root>
    </div>
  );
}

/** The quiet `inline` trigger, sized for a toolbar beside other controls. */
export function InlineToolbar() {
  return (
    <div className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-border bg-canvas px-3 py-2">
      <span className="shrink-0 font-medium text-foreground-secondary text-xs">
        Model
      </span>
      <SearchSelect.Root defaultValue="Balanced — local" items={models}>
        <SearchSelect.Trigger appearance="inline" aria-label="Model">
          <SearchSelect.Value placeholder="Select model" />
        </SearchSelect.Trigger>
        <SearchSelect.Portal>
          <SearchSelect.Positioner align="start">
            <SearchSelect.Popup aria-label="Select model">
              <SearchSelect.Input
                aria-label="Search models"
                placeholder="Search models…"
              />
              <SearchSelect.Empty>No matching model.</SearchSelect.Empty>
              <SearchSelect.List>
                {(model: Model) => (
                  <SearchSelect.Item key={model} value={model}>
                    {model}
                  </SearchSelect.Item>
                )}
              </SearchSelect.List>
            </SearchSelect.Popup>
          </SearchSelect.Positioner>
        </SearchSelect.Portal>
      </SearchSelect.Root>
      <span className="ml-auto shrink-0 text-foreground-secondary text-xs tabular-nums">
        FY 2028
      </span>
    </div>
  );
}
