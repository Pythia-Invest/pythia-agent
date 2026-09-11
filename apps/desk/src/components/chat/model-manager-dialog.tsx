"use client";

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  IconButton,
  Input,
  Switch,
  Tab,
  TabPanel,
  Tabs,
  TabsList,
} from "@pythia/ui";
import { RefreshCw, Search, X } from "lucide-react";
import { useState } from "react";
import type { ModelCatalog, ModelProvider } from "@/server/model-catalog";
import {
  type ModelFamily,
  type ModelVisibility,
  collapseModelFamilies,
  effectiveVisibleModels,
  modelKey,
  setProviderVisibility,
  toggleModelVisibility,
} from "./model-preferences";

function priceDescription(model: ModelProvider["models"][number]) {
  const { price } = model;
  if (!price) return "Pricing unavailable";
  if (price.free) return "Free";
  const values = [
    price.input ? `${price.input} input` : "",
    price.output ? `${price.output} output` : "",
  ].filter(Boolean);
  return values.length ? `${values.join(" · ")} per 1M tokens` : "Paid";
}

function modelMatches(
  provider: ModelProvider,
  family: ModelFamily,
  query: string,
) {
  return `${family.id} ${family.fastId ?? ""} ${provider.name} ${provider.slug}`
    .toLocaleLowerCase()
    .includes(query);
}

/**
 * Controls Hermes Desktop's default shortlist. Provider tabs keep the catalog
 * scannable while hidden models remain reachable through the main search.
 */
export function ModelManagerDialog({
  catalog,
  onOpenChange,
  onRefresh,
  onVisibilityChange,
  open,
  refreshing,
  visibility,
}: {
  catalog: ModelCatalog;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onVisibilityChange: (visibility: Set<string>) => void;
  open: boolean;
  refreshing: boolean;
  visibility: ModelVisibility;
}) {
  const providers = catalog.providers.filter(
    (provider) =>
      provider.slug !== "moa" &&
      provider.authenticated &&
      provider.models.length > 0,
  );
  const [query, setQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState(
    providers.find((provider) => provider.slug === catalog.provider)?.slug ??
      providers[0]?.slug ??
      "",
  );
  const visible = effectiveVisibleModels(visibility, providers);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredProviders = providers.filter((provider) => {
    if (!normalizedQuery) return true;
    return collapseModelFamilies(provider.models.map((model) => model.id)).some(
      (family) => modelMatches(provider, family, normalizedQuery),
    );
  });
  const activeProvider =
    filteredProviders.find((provider) => provider.slug === selectedSlug) ??
    filteredProviders[0] ??
    null;

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setQuery("");
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup className="grid h-[min(38rem,calc(100dvh-2rem))] w-[min(44rem,100%)] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden p-0">
            <header className="flex items-start justify-between gap-4 border-border border-b px-4 py-3">
              <div>
                <Dialog.Title className="text-sm">
                  Edit visible models
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs">
                  Choose what appears when the picker opens. Search still
                  reaches every configured Hermes model.
                </Dialog.Description>
              </div>
              <Dialog.Close
                render={
                  <IconButton label="Close model manager" size="sm">
                    <X />
                  </IconButton>
                }
              />
            </header>

            <div className="flex items-center gap-2 border-border border-b px-3 py-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground-secondary"
                />
                <Input
                  aria-label="Search providers and models"
                  className="h-8 w-full pl-8 text-xs"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Search providers and models…"
                  value={query}
                />
              </div>
              <Button
                aria-label="Refresh models"
                disabled={refreshing}
                onClick={onRefresh}
                size="sm"
                variant="ghost"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
                />
                <span className="sr-only">Refresh models</span>
              </Button>
            </div>

            {activeProvider ? (
              <Tabs
                className="flex min-h-0 flex-col"
                onValueChange={(value) => {
                  if (typeof value === "string") setSelectedSlug(value);
                }}
                value={activeProvider.slug}
              >
                <TabsList className="shrink-0 px-2 pt-1">
                  {filteredProviders.map((provider) => {
                    const families = collapseModelFamilies(
                      provider.models.map((model) => model.id),
                    );
                    const visibleCount = families.filter((family) =>
                      visible.has(modelKey(provider.slug, family.id)),
                    ).length;
                    return (
                      <Tab
                        className="min-w-max px-2.5 text-xs"
                        key={provider.slug}
                        value={provider.slug}
                      >
                        {provider.name}
                        <span className="ml-1 text-[10px] text-foreground-disabled">
                          {visibleCount}/{families.length}
                        </span>
                      </Tab>
                    );
                  })}
                </TabsList>

                {filteredProviders.map((provider) => {
                  const allFamilies = collapseModelFamilies(
                    provider.models.map((model) => model.id),
                  );
                  const families = allFamilies.filter(
                    (family) =>
                      !normalizedQuery ||
                      modelMatches(provider, family, normalizedQuery),
                  );
                  const visibleCount = allFamilies.filter((family) =>
                    visible.has(modelKey(provider.slug, family.id)),
                  ).length;
                  const providerChecked = visibleCount === allFamilies.length;
                  const providerIndeterminate =
                    visibleCount > 0 && visibleCount < allFamilies.length;

                  return (
                    <TabPanel
                      className="min-h-0 flex-1 overflow-y-auto py-0"
                      key={provider.slug}
                      value={provider.slug}
                    >
                      <div className="sticky top-0 z-10 flex items-center gap-3 border-border border-b bg-overlay px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="m-0 truncate font-medium text-sm">
                            {provider.name}
                          </p>
                          <p className="m-0 text-[11px] text-foreground-disabled">
                            {visibleCount} of {allFamilies.length} shown before
                            searching
                          </p>
                        </div>
                        <span className="text-foreground-secondary text-xs">
                          Show all
                        </span>
                        <Checkbox
                          aria-label={`Show all ${provider.name} models`}
                          checked={providerChecked}
                          indeterminate={providerIndeterminate}
                          onCheckedChange={(checked) =>
                            onVisibilityChange(
                              setProviderVisibility(
                                visibility,
                                providers,
                                provider.slug,
                                checked !== false,
                              ),
                            )
                          }
                        />
                      </div>

                      {provider.warning ? (
                        <p className="m-0 border-border border-b px-4 py-2 text-foreground-secondary text-xs">
                          {provider.warning}
                        </p>
                      ) : null}

                      <div className="divide-y divide-border">
                        {families.map((family) => {
                          const model = provider.models.find(
                            (candidate) => candidate.id === family.id,
                          );
                          if (!model) return null;
                          const key = modelKey(provider.slug, family.id);
                          const labelId = `model-visibility-${key.replaceAll(
                            /[^a-zA-Z0-9_-]/gu,
                            "-",
                          )}`;
                          return (
                            <div
                              className="flex items-center gap-3 px-4 py-2.5"
                              key={key}
                            >
                              <div className="min-w-0 flex-1">
                                <span
                                  className="flex min-w-0 items-center gap-1.5"
                                  id={labelId}
                                >
                                  <span className="truncate font-medium text-sm">
                                    {family.id}
                                  </span>
                                  {model.price?.free ? (
                                    <Badge className="min-h-4 px-1 text-[9px]">
                                      Free
                                    </Badge>
                                  ) : null}
                                  {model.unavailable ? (
                                    <Badge
                                      className="min-h-4 px-1 text-[9px]"
                                      tone="warning"
                                    >
                                      Unavailable
                                    </Badge>
                                  ) : null}
                                </span>
                                <span className="block truncate text-[11px] text-foreground-disabled">
                                  {priceDescription(model)}
                                </span>
                              </div>
                              <Switch
                                aria-labelledby={labelId}
                                checked={visible.has(key)}
                                disabled={model.unavailable}
                                onCheckedChange={() =>
                                  onVisibilityChange(
                                    toggleModelVisibility(
                                      visibility,
                                      providers,
                                      provider.slug,
                                      family.id,
                                    ),
                                  )
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    </TabPanel>
                  );
                })}
              </Tabs>
            ) : (
              <p className="m-0 px-4 py-8 text-center text-foreground-secondary text-xs">
                No configured models match your search.
              </p>
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
