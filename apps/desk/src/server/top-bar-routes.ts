import { admitBrowserRequest } from "./admission";
import { workspaceStore, type WorkspaceStore } from "./workspace/store";
import { readWidgetPresentation } from "./widget-routes";
import { result } from "./route-utils";
import {
  DEFAULT_TOP_BAR,
  TOP_BAR_CONFIG_PATH,
  TOP_BAR_INPUT_CONTRACT,
  topBarConfigSchema,
  type TopBarSelection,
} from "@/top-bar/config";

export function createTopBarRoutes(
  workspace: WorkspaceStore = workspaceStore,
  presentation = readWidgetPresentation,
  productDefault = DEFAULT_TOP_BAR,
) {
  return {
    async topBar(request: Request) {
      const denied = admitBrowserRequest(request, "read");
      if (denied) return denied;
      // Only a confirmed missing file selects the product default.
      let defaulted = false;
      try {
        let config = {
          version: 1 as const,
          renderer: productDefault,
          settings: {},
        };
        let entry: Awaited<ReturnType<WorkspaceStore["entry"]>> | undefined;
        try {
          entry = await workspace.entry(TOP_BAR_CONFIG_PATH);
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
          )
            throw error;
          defaulted = true;
        }
        if (entry) {
          if (entry.size > 65_536) throw Error("configuration too large");
          const url = new URL(request.url);
          url.search = new URLSearchParams({
            revision: entry.revision,
          }).toString();
          const response = await workspace.response(
            TOP_BAR_CONFIG_PATH,
            new Request(url, { signal: request.signal }),
          );
          if (!response.ok) throw Error("configuration unavailable");
          config = topBarConfigSchema.parse(await response.json());
        }
        if (!config.renderer)
          return result({
            renderer: null,
            settings: config.settings,
          } satisfies TopBarSelection);
        const selected = config.renderer;
        const native = await presentation(selected.plugin, request.signal);
        const widget = native.widgets.find(
          (item) =>
            item.id === selected.presentation &&
            item.input_contract === TOP_BAR_INPUT_CONTRACT,
        );
        const asset = native.assets.find((item) => item.id === widget?.asset);
        if (!widget || !asset) throw Error("presentation unavailable");
        return result({
          renderer: selected,
          settings: config.settings,
          moduleUrl: asset.moduleUrl,
        } satisfies TopBarSelection);
      } catch {
        // The investor chose nothing: an unavailable product default (a
        // disabled feature) is not a configuration problem, so the core bar
        // appears without a warning.
        if (defaulted) return result({ renderer: null, settings: {} });
        // Never replace or repair user configuration on a failed read.
        return result({
          renderer: null,
          settings: {},
          issue:
            "The selected top bar is unavailable. Using the core header; check desk/top-bar.json and the plugin's native availability.",
        } satisfies TopBarSelection);
      }
    },
  };
}
