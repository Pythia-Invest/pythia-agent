"use client";

import { useThemePreference } from "@pythia/ui";
import { useDeviceSettings } from "@/client/settings-queries";
import type { FieldSchema, FieldSource } from "./fields";

/**
 * Pythia's own settings, described in the same schema as Hermes's and
 * rendered by the same rows. Values come from this browser and this device's
 * settings.
 */
export const pythiaSchema: Record<string, FieldSchema> = {
  "desk.theme": {
    type: "select",
    label: "Theme",
    description: "Follow this device, or keep Desk light or dark.",
    options: ["system", "light", "dark"],
    optionLabels: { system: "System", light: "Light", dark: "Dark" },
    segmented: true,
  },
  "folders.workspace": {
    type: "path",
    label: "Workspace folder",
    description: "Your research files, shown in Workspace.",
  },
  "folders.working": {
    type: "path",
    label: "Agent working folder",
    description: "Where Hermes's tools run.",
  },
};

export function usePythiaFields(): FieldSource {
  const theme = useThemePreference();
  const settings = useDeviceSettings();
  const data = settings.data;
  const workingFolder =
    data?.workspace.status === "matched"
      ? "Same as the workspace folder"
      : (data?.workspace.native_cwd ?? undefined);

  return {
    schema: pythiaSchema,
    values: {
      "desk.theme": theme.preference,
      "folders.workspace": data?.workspace.root ?? undefined,
      "folders.working": workingFolder,
    },
    status: settings.isPending
      ? "pending"
      : settings.isError
        ? "error"
        : "ready",
    error: settings.error,
    retry: () => void settings.refetch(),
    change(key, value) {
      if (
        key === "desk.theme" &&
        (value === "system" || value === "light" || value === "dark")
      )
        theme.setPreference(value);
    },
  };
}
