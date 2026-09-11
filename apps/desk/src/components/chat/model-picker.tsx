"use client";

import { Badge, Button, SearchSelect } from "@pythia/ui";
import { RefreshCw, Settings2 } from "lucide-react";
import { useRef, useState } from "react";
import {
  type ModelCatalog,
  type ModelProvider,
  type ModelSelection,
  normalizeModelSelection,
} from "@/server/model-catalog";
import { ReasoningPicker } from "./reasoning-picker";
import { ModelManagerDialog } from "./model-manager-dialog";
import {
  type ModelVisibility,
  effectiveVisibleModels,
  modelKey,
  readModelVisibility,
  writeModelVisibility,
} from "./model-preferences";

const STORAGE_KEY = "pythia-desk:model-selection";
const MOA_PROVIDER = "moa";

function storageKey(sessionId?: string) {
  return sessionId ? `${STORAGE_KEY}:${sessionId}` : STORAGE_KEY;
}

export function readModelPreference(
  sessionId?: string,
): ModelSelection | undefined {
  try {
    const value = JSON.parse(
      localStorage.getItem(storageKey(sessionId)) ??
        localStorage.getItem(STORAGE_KEY) ??
        "null",
    ) as unknown;
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    return typeof record.provider === "string" &&
      typeof record.model === "string"
      ? (record as ModelSelection)
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeModelPreference(
  selection: ModelSelection,
  sessionId?: string,
) {
  try {
    const serialized = JSON.stringify(selection);
    localStorage.setItem(STORAGE_KEY, serialized);
    if (sessionId) localStorage.setItem(storageKey(sessionId), serialized);
  } catch {
    // The native Hermes default remains usable when browser storage is unavailable.
  }
}

export function defaultSelection(
  catalog: ModelCatalog,
): ModelSelection | undefined {
  if (catalog.provider && catalog.model)
    return { provider: catalog.provider, model: catalog.model };
  const provider = catalog.providers.find(
    (entry) =>
      entry.slug !== MOA_PROVIDER &&
      entry.authenticated &&
      entry.models.some((model) => !model.unavailable),
  );
  const model = provider?.models.find((entry) => !entry.unavailable);
  return provider && model
    ? { provider: provider.slug, model: model.id }
    : undefined;
}

type ModelItem = {
  label: string;
  model: ModelProvider["models"][number];
  provider: ModelProvider;
  value: string;
};

type ProviderGroup = {
  items: ModelItem[];
  provider: ModelProvider;
};

function isCurrentProvider(provider: ModelProvider, current: string) {
  return provider.slug === current || provider.aliases.includes(current);
}

function groupsForCatalog(
  providers: ModelProvider[],
  query: string,
  selection: ModelSelection,
  visible: Set<string>,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searching = normalizedQuery.length > 0;
  const groups: ProviderGroup[] = [];

  for (const provider of providers) {
    // Desktop collapses siblings only because its edit submenu can select
    // variants. Desk keeps the compact shortlist, but search and the current
    // selection use exact catalog IDs so no native route becomes unreachable.
    const items = provider.models.flatMap((model) => {
      const current =
        isCurrentProvider(provider, selection.provider) &&
        model.id === selection.model;
      const matches = `${model.id} ${provider.name} ${provider.slug}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
      if (
        !matches ||
        (!searching &&
          !current &&
          !visible.has(modelKey(provider.slug, model.id)))
      )
        return [];
      return [
        {
          label: model.id,
          model,
          provider,
          value: modelKey(provider.slug, model.id),
        },
      ];
    });
    if (items.length) groups.push({ items, provider });
  }

  return groups.sort((left, right) =>
    left.provider.name.localeCompare(right.provider.name),
  );
}

/**
 * Compact Pythia presentation of Hermes Desktop's catalog rules: provider
 * groups are stable, native model order is preserved, the default shortlist
 * comes from Hermes, and search spans the complete configured catalog.
 */
export function ModelPicker({
  catalog,
  disabled,
  managerOpen,
  onChange,
  onManagerOpenChange,
  onPickerOpenChange,
  onRefresh,
  pickerOpen,
  refreshing,
  selection,
}: {
  catalog: ModelCatalog;
  disabled?: boolean;
  managerOpen: boolean;
  onChange: (selection: ModelSelection) => void;
  onManagerOpenChange: (open: boolean) => void;
  onPickerOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  pickerOpen: boolean;
  refreshing: boolean;
  selection: ModelSelection;
}) {
  const [visibility, setVisibility] =
    useState<ModelVisibility>(readModelVisibility);
  const [modelQuery, setModelQuery] = useState("");
  const modelListRef = useRef<HTMLDivElement>(null);
  const providers = catalog.providers.filter(
    (provider) =>
      provider.slug !== MOA_PROVIDER &&
      provider.authenticated &&
      provider.models.length > 0,
  );
  const visible = effectiveVisibleModels(visibility, providers);
  const groups = groupsForCatalog(providers, modelQuery, selection, visible);
  const modelItems = groups.flatMap((group) => group.items);
  const selectedProvider = catalog.providers.find((provider) =>
    isCurrentProvider(provider, selection.provider),
  );
  const selectedModel = selectedProvider?.models.find(
    (model) => model.id === selection.model,
  );
  const selectedValue =
    selectedProvider && selectedModel
      ? {
          label:
            selectedProvider.slug === MOA_PROVIDER
              ? `MoA: ${selectedModel.id}`
              : selectedModel.id,
          model: selectedModel,
          provider: selectedProvider,
          value: modelKey(selectedProvider.slug, selectedModel.id),
        }
      : null;

  const renderItem = (item: ModelItem) => (
    <SearchSelect.Item
      disabled={item.model.unavailable}
      key={item.value}
      value={item}
    >
      <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
      {item.model.price?.free ? (
        <Badge className="min-h-5 px-1.5 text-[10px]">Free</Badge>
      ) : null}
      {item.model.unavailable ? (
        <span className="shrink-0 text-[11px] text-foreground-disabled">
          Unavailable
        </span>
      ) : null}
      <span className="max-w-32 shrink-0 truncate text-[11px] text-foreground-disabled">
        {item.provider.name}
      </span>
    </SearchSelect.Item>
  );

  return (
    <div className="flex min-w-0 items-center gap-1" data-slot="model-picker">
      <SearchSelect.Root
        autoHighlight
        disabled={disabled}
        filter={() => true}
        isItemEqualToValue={(item, value) => item.value === value.value}
        itemToStringLabel={(item) => item.label}
        itemToStringValue={(item) => item.value}
        items={modelItems}
        inputValue={modelQuery}
        onInputValueChange={setModelQuery}
        onOpenChange={(open) => {
          if (!open) setModelQuery("");
          onPickerOpenChange(open);
        }}
        onOpenChangeComplete={(open) => {
          if (!open) return;
          const selectedItem =
            modelListRef.current?.querySelector('[data-selected=""]');
          if (selectedItem instanceof HTMLElement)
            selectedItem.scrollIntoView({ block: "nearest" });
          else if (modelListRef.current) modelListRef.current.scrollTop = 0;
        }}
        onValueChange={(item) => {
          if (!item?.provider.authenticated || item.model.unavailable) return;
          onChange(
            normalizeModelSelection(catalog, {
              provider: item.provider.slug,
              model: item.model.id,
              ...(item.model.reasoning ? { effort: selection.effort } : {}),
            }),
          );
        }}
        open={pickerOpen}
        value={selectedValue}
      >
        <SearchSelect.Trigger
          appearance="inline"
          aria-label="Model"
          className="w-52 max-w-[55vw]"
        >
          <SearchSelect.Value placeholder="Select model" />
        </SearchSelect.Trigger>
        <SearchSelect.Portal>
          <SearchSelect.Positioner align="start" side="top">
            <SearchSelect.Popup
              aria-label="Select model"
              className="flex w-[min(24rem,calc(100vw-2rem))] flex-col"
            >
              <SearchSelect.Input
                aria-label="Search models"
                placeholder="Search models…"
              />
              <SearchSelect.Empty className="py-3 text-xs">
                No matching models.
              </SearchSelect.Empty>
              <SearchSelect.List className="min-h-0 shrink" ref={modelListRef}>
                {modelItems.map(renderItem)}
              </SearchSelect.List>
              <div className="grid border-border border-t p-1">
                <Button
                  className="w-full justify-start px-2"
                  disabled={refreshing}
                  onClick={onRefresh}
                  size="sm"
                  variant="ghost"
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
                  />
                  Refresh models
                </Button>
                <Button
                  className="w-full justify-start px-2"
                  onClick={() => {
                    onPickerOpenChange(false);
                    onManagerOpenChange(true);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <Settings2 aria-hidden="true" className="size-3.5" />
                  Edit visible models
                </Button>
              </div>
            </SearchSelect.Popup>
          </SearchSelect.Positioner>
        </SearchSelect.Portal>
      </SearchSelect.Root>

      {selectedValue?.model.reasoning &&
      selectedValue.provider.slug !== MOA_PROVIDER ? (
        <ReasoningPicker
          disabled={disabled}
          selection={selection}
          onChange={onChange}
          canDisableReasoning={selectedValue.model.canDisableReasoning}
        />
      ) : null}
      <ModelManagerDialog
        catalog={catalog}
        onOpenChange={onManagerOpenChange}
        onRefresh={onRefresh}
        onVisibilityChange={(next) => {
          setVisibility(next);
          writeModelVisibility(next);
        }}
        open={managerOpen}
        refreshing={refreshing}
        visibility={visibility}
      />
    </div>
  );
}
